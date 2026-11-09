// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISqueekCore} from "./ISqueekCore.sol";
import {IBloomGarden, IBloomRaid, IBloomGuard} from "./IBloom.sol";

interface IFlowerNFT {
    function transferFrom(address from, address to, uint256 id) external;
}

/// @title BloomPvP: Garden Heists and the Duel Arena
/// @notice Both settle on the first round at or after their round in which Squeektoshi actually
///         works, using that round's reporter-signed data hash (unknown when you commit).
///
///  HEISTS  Send up to 5 picked flowers to rob a rival's growing plant (Bud or bigger).
///          Chance and loot are fixed when the heist starts (so guards posted later don't change it):
///          chance = raid power / (raid power + their shield x 10 + 50), in tenths (Sunflowers x1.5);
///          loot = 25% of the plant's growth then, max 400 (and never more than it has left).
///          Fail: raiders are jailed for 36 rounds (Star Lilies slip away). One heist per plant per 36 rounds.
///  ARENA   Enter a flower for the next round's arena (max 16). When he runs, entrants are shuffled
///          with that round's data hash and paired at random, so nobody can pick a matchup.
///          Score = points x2 if its species beats the other's
///          (Sunflower > Lotus > Poppy > Star Lily > Daisy > Sunflower) x luck (50..149).
///          The winner takes both flowers; an odd one out gets its flower back.
///          Leave any time before the round starts, or if he hasn't run 36 rounds after it.
contract BloomPvP {
    uint256 internal constant MAX_RAIDERS = 5;
    uint256 internal constant ARENA_SIZE = 16;
    uint64 internal constant JAIL_ROUNDS = 36;
    uint64 internal constant COOLDOWN = 36;
    uint64 internal constant MIN_TARGET_GROWTH = 400;
    uint64 internal constant MAX_LOOT = 400;

    enum State { None, Pending, Done }

    struct Heist {
        address thief;
        address victim;
        uint256 target;
        uint256 receiver;
        uint64 round;
        uint64 chance; // % fixed at the start
        uint64 loot; // planned loot, fixed at the start
        State state;
        bool success;
        uint256[] raiders;
    }

    struct Entry {
        address owner;
        uint256 flower;
    }

    ISqueekCore public immutable core;
    IBloomGarden public immutable garden;

    uint256 public heistCount;
    mapping(uint256 => Heist) private _heists;
    mapping(uint256 => uint64) public busyUntil; // raiders: pending round, or jailed until
    mapping(uint256 => uint64) public targetedAt; // plant cooldown
    mapping(uint64 => Entry[]) private _arena;
    mapping(uint64 => bool) public arenaDone;
    mapping(uint256 => uint64) public arenaRound; // flower -> arena round (0 = not entered)

    event HeistPlanned(uint256 indexed id, address indexed thief, address indexed victim, uint256 target, uint64 round, uint64 chance, uint64 loot);
    event HeistResolved(uint256 indexed id, bool success, uint64 loot, uint64 round);
    event ArenaEntered(uint64 indexed round, address indexed gardener, uint256 flower);
    event ArenaLeft(uint64 indexed round, address indexed gardener, uint256 flower);
    event DuelResolved(uint64 indexed round, address indexed winner, address indexed loser, uint256 winFlower, uint256 loseFlower, uint256 winScore, uint256 loseScore);

    error NotYours();
    error NotAFighter();
    error Busy();
    error BadTarget();
    error Cooldown();
    error TooManyRaiders();
    error BadState();
    error NotYet();
    error ArenaFull();

    constructor(ISqueekCore core_, IBloomGarden garden_) {
        core = core_;
        garden = garden_;
    }

    // ================================================================ heists

    function heist(uint256 target, uint256 receiver, uint256[] calldata raiders) external returns (uint256 id) {
        if (raiders.length == 0 || raiders.length > MAX_RAIDERS) revert TooManyRaiders();
        (address victim, bool growing, uint64 growth) = garden.plantState(target);
        if (!growing || victim == msg.sender || growth < MIN_TARGET_GROWTH) revert BadTarget();
        (address rOwner, bool rGrowing,) = garden.plantState(receiver);
        if (rOwner != msg.sender || !rGrowing) revert BadTarget();
        uint64 round = _raid().targetRound();
        if (targetedAt[target] != 0 && targetedAt[target] + COOLDOWN >= round) revert Cooldown();
        targetedAt[target] = round;

        uint256 power;
        for (uint256 i; i < raiders.length; ++i) {
            uint256 f = raiders[i];
            (address o, uint16 pts, uint8 species,) = garden.fighter(f);
            if (o != msg.sender) revert NotYours();
            if (pts == 0) revert NotAFighter();
            _requireFree(f);
            busyUntil[f] = round;
            power += uint256(pts) * (species == 3 ? 15 : 10); // Sunflowers hit harder here too
        }
        id = ++heistCount;
        Heist storage h = _heists[id];
        uint64 loot = growth / 4 > MAX_LOOT ? MAX_LOOT : growth / 4;
        uint64 chance = heistChance(power, victim);
        (h.thief, h.victim, h.target, h.receiver, h.round, h.chance, h.loot, h.state) =
            (msg.sender, victim, target, receiver, round, chance, loot, State.Pending);
        h.raiders = raiders;
        emit HeistPlanned(id, msg.sender, victim, target, round, chance, loot);
    }

    /// Anyone may resolve once the hamster has worked a round at or after the heist's round.
    function resolveHeist(uint256 id) external {
        Heist storage h = _heists[id];
        if (h.state != State.Pending) revert BadState();
        (bool found, uint64 at, bytes32 seed) = _firstWorkingRound(h.round);
        if (!found) revert NotYet();
        h.state = State.Done;

        uint64 loot;
        if (uint256(keccak256(abi.encode(seed, "heist", id))) % 100 < h.chance) {
            (address vOwner, bool vGrowing, uint64 growth) = garden.plantState(h.target);
            (address rOwner, bool rGrowing,) = garden.plantState(h.receiver);
            if (vOwner == h.victim && vGrowing && rOwner == h.thief && rGrowing) {
                loot = h.loot > growth ? growth : h.loot;
                garden.shiftGrowth(h.target, h.receiver, loot);
                h.success = true;
            }
        } else {
            for (uint256 i; i < h.raiders.length; ++i) {
                (,, uint8 species,) = garden.fighter(h.raiders[i]);
                if (species != 2) busyUntil[h.raiders[i]] = at + JAIL_ROUNDS; // Star Lilies slip away
            }
        }
        h.loot = loot;
        emit HeistResolved(id, h.success, loot, at);
    }

    /// Success % for a raid of `power` (tenths) against `victim`'s guards right now.
    function heistChance(uint256 power, address victim) public view returns (uint64) {
        address g = garden.guard();
        uint256 defense = (g == address(0) ? 0 : IBloomGuard(g).shield(victim)) * 10 + 50;
        return uint64((power * 100) / (power + defense));
    }

    // ================================================================= arena

    function enterArena(uint256 flower) external returns (uint64 round) {
        (address o, uint16 pts,,) = garden.fighter(flower);
        if (o != msg.sender) revert NotYours();
        if (pts == 0) revert NotAFighter();
        _requireFree(flower);
        round = _raid().targetRound();
        Entry[] storage e = _arena[round];
        if (e.length >= ARENA_SIZE) revert ArenaFull();
        IFlowerNFT(address(garden)).transferFrom(msg.sender, address(this), flower);
        e.push(Entry(msg.sender, flower));
        arenaRound[flower] = round;
        emit ArenaEntered(round, msg.sender, flower);
    }

    /// Before the round starts, or if he still hasn't run 36 rounds after it.
    function leaveArena(uint256 flower) external {
        uint64 round = arenaRound[flower];
        if (round == 0) revert BadState();
        uint64 open = _raid().openRound();
        if (open >= round) {
            (bool found,,) = _firstWorkingRound(round);
            if (found || open <= round + COOLDOWN) revert NotYet();
        }
        Entry[] storage e = _arena[round];
        uint256 i;
        while (e[i].flower != flower) ++i;
        if (e[i].owner != msg.sender) revert NotYours();
        e[i] = e[e.length - 1];
        e.pop();
        arenaRound[flower] = 0;
        IFlowerNFT(address(garden)).transferFrom(address(this), msg.sender, flower);
        emit ArenaLeft(round, msg.sender, flower);
    }

    /// Anyone may run the arena once he has worked a round at or after it.
    function resolveArena(uint64 round) external {
        if (arenaDone[round]) revert BadState();
        (bool found, uint64 at, bytes32 seed) = _firstWorkingRound(round);
        if (!found) revert NotYet();
        arenaDone[round] = true;
        Entry[] memory e = _arena[round];
        uint256 n = e.length;
        for (uint256 i = n; i > 1; --i) {
            uint256 j = uint256(keccak256(abi.encode(seed, round, i))) % i;
            (e[i - 1], e[j]) = (e[j], e[i - 1]);
        }
        for (uint256 i; i < n; ++i) arenaRound[e[i].flower] = 0;
        for (uint256 i; i + 1 < n; i += 2) _duel(e[i], e[i + 1], seed, at);
        if (n % 2 == 1) {
            IFlowerNFT(address(garden)).transferFrom(address(this), e[n - 1].owner, e[n - 1].flower);
            emit ArenaLeft(round, e[n - 1].owner, e[n - 1].flower);
        }
    }

    function _duel(Entry memory a, Entry memory b, bytes32 seed, uint64 at) internal {
        (, uint16 pa, uint8 sa,) = garden.fighter(a.flower);
        (, uint16 pb, uint8 sb,) = garden.fighter(b.flower);
        uint256 ra = uint256(keccak256(abi.encode(seed, "duel", a.flower))) % 100;
        uint256 rb = uint256(keccak256(abi.encode(seed, "duel", b.flower))) % 100;
        uint256 scoreA = uint256(pa) * (beats(sa, sb) ? 2 : 1) * (50 + ra);
        uint256 scoreB = uint256(pb) * (beats(sb, sa) ? 2 : 1) * (50 + rb);
        (Entry memory w, Entry memory l, uint256 ws, uint256 ls) =
            scoreA > scoreB || (scoreA == scoreB && ra >= rb) ? (a, b, scoreA, scoreB) : (b, a, scoreB, scoreA);
        IFlowerNFT(address(garden)).transferFrom(address(this), w.owner, w.flower);
        IFlowerNFT(address(garden)).transferFrom(address(this), w.owner, l.flower);
        emit DuelResolved(at, w.owner, l.owner, w.flower, l.flower, ws, ls);
    }

    /// Sunflower(3) > Lotus(4) > Poppy(1) > Star Lily(2) > Daisy(0) > Sunflower(3). Wheelbloom is neutral.
    function beats(uint8 a, uint8 b) public pure returns (bool) {
        if (a > 4 || b > 4) return false;
        // byte a = the species a beats: Daisy->Sunflower, Poppy->Star Lily, Star Lily->Daisy,
        // Sunflower->Lotus, Lotus->Poppy
        return uint8(0x0104000203 >> (8 * a)) == b;
    }

    function arena(uint64 round) external view returns (Entry[] memory) {
        return _arena[round];
    }

    // ================================================================ shared

    function isBusy(uint256 id) public view returns (bool) {
        return arenaRound[id] != 0 || busyUntil[id] >= _raid().openRound();
    }

    function _requireFree(uint256 f) internal view {
        address g = garden.guard();
        if (isBusy(f) || _raid().isBusy(f) || (g != address(0) && IBloomGuard(g).isGuarding(f))) revert Busy();
    }

    function _raid() internal view returns (IBloomRaid) {
        return IBloomRaid(garden.raid());
    }

    /// The first round >= `r` in which the hamster worked, and its data hash.
    function _firstWorkingRound(uint64 r) internal view returns (bool found, uint64 round, bytes32 seed) {
        uint64 settled = core.state().settledThroughRound;
        if (settled < r) return (false, 0, 0);
        ISqueekCore.RoundPage memory pg = core.roundPage(r - 1, settled, 1);
        if (pg.rounds.length == 0) return (false, 0, 0);
        return (true, pg.rounds[0].roundId, pg.rounds[0].dataHash);
    }
}
