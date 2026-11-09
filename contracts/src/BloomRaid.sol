// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISqueekCore} from "./ISqueekCore.sol";
import {IBloomGarden, IBloomGuard} from "./IBloom.sol";

/// @title BloomRaid
/// @notice A pest boss is always attacking the garden, and it fights back.
///
///  ARMIES  `attack(flowers)` arms an army from the next round on. It STANDS until the first
///          round in which Squeektoshi works, then fights once. One army per gardener at a time.
///  DAMAGE  per working round (SqueekCore.roundPage): work * (100 + armed power in tenths) / 100
///          x1.5 Rally (3+ heads; each Daisy counts double) · +10% per back-to-back working round
///          (max +50%) · x2 Crit (10% per Poppy, max 50%, rolled from the round's data hash)
///  POWER   points (1, 3, 8, 25, 100) x10; Sunflower x1.5; species the boss is weak to x2
///          (Wheelbloom always); bare paws 10; Squeek holders +50
///  BACK    Bites: every sleeping round the boss bites gardens for (4 + boss#) lifespan, x2 enraged.
///          Swipes: each fighter may be knocked out for 36 rounds:
///          (10 + 3*boss#)% (x2 enraged, max 60) - 5% per tier. Star Lily and Wheelbloom dodge.
///  BOSSES  next HP = max(HP x 1.25, 6 x the killing blow), so each boss lasts ~6 working rounds
///          however strong the gardeners get.
///  LOOT    claimed through BloomGuard: armies that fought the killing round with at least one
///          flower and >= 5% of its power get a Boss Seed (Rare+); the biggest a Champion Seed (Epic+).
contract BloomRaid {
    uint256 internal constant FIRST_BOSS_HP = 2500;
    uint256 internal constant MAX_FIGHTERS = 10;
    uint64 internal constant KO_ROUNDS = 36;
    uint256 internal constant BARE = 10;
    uint256 internal constant HOLDER_BONUS = 50;

    struct Boss {
        uint256 hp;
        uint256 damage;
        uint64 slainRound;
        uint64 killFrom; // earliest army round that fought the killing blow
        uint256 killPower; // armed power in the killing round
        address top;
    }

    struct Strike {
        uint64 round;
        uint64 work;
        uint256 damage;
        uint256 bossId;
        uint256 power;
        bool crit;
        bool rally;
        uint8 combo;
        uint8 swipe;
        bytes32 seed;
        uint32 armFrom; // armedRounds index range this strike consumed
        uint32 armTo;
    }

    struct Kill {
        uint256 bossId;
        uint64 round;
        address top;
        uint64 from;
        uint256 power;
        uint256 nextHp;
    }

    /// The raid with settled-but-unwritten rounds applied. BloomRaidView turns it into the page's view.
    struct Summary {
        uint64 through;
        uint256 bossId;
        uint256 hp;
        uint256 damage;
        uint64 lastActive;
        uint8 combo;
        uint64 bites;
        uint32 ptr;
        uint256 pendingKills;
    }

    struct Outcome {
        uint64 through;
        uint256 bossId;
        uint256 hp;
        uint256 damage;
        uint64 lastActive;
        uint8 combo;
        uint64 bites;
        uint32 ptr;
        uint256 nStrikes;
        uint256 nKills;
        Strike[16] strikes;
        Kill[16] kills;
    }

    ISqueekCore public immutable core;
    IBloomGarden public immutable garden;
    uint64 public immutable genesis;
    uint64 public immutable roundDuration;

    uint256 public currentBoss;
    uint64 public processedThrough;
    uint64 internal lastActive;
    uint8 internal combo;
    uint64 internal biteIndex;
    uint32 internal armedPtr;
    uint64[] internal armedRounds; // ascending rounds with at least one army
    mapping(uint256 => Boss) private _bosses;

    struct Army {
        uint128 power; // tenths
        uint32 heads;
        uint32 poppies;
        uint64 topPower;
        address top;
    }

    mapping(uint64 => Army) public armies; // by army round
    mapping(uint64 => mapping(address => uint256)) public attackPower;
    mapping(uint64 => mapping(address => bool)) public fielded;
    mapping(uint64 => uint64) internal fightRound; // army round -> working round it fought in
    mapping(uint64 => bytes32) internal roundSeed; // by working round
    mapping(uint64 => uint8) internal roundSwipe;
    mapping(uint256 => uint64) internal foughtRound; // flower -> army round
    mapping(address => uint64) public myArmy;

    event Attacked(address indexed gardener, uint64 indexed round, uint256 power, uint256[] flowers);
    event Struck(uint256 indexed bossId, uint64 indexed round, uint64 work, uint256 damage, uint256 power, bool crit, bool rally, uint8 combo, uint8 swipe);
    event BossSlain(uint256 indexed bossId, uint64 round, address top);
    event BossSpawned(uint256 indexed bossId, uint256 hp);

    error NotYourPlant();
    error AlreadyAttacking();
    error TooManyFighters();
    error NotAFighter();
    error AlreadyFighting();
    error Guarding();
    error KnockedOut();

    constructor(ISqueekCore core_, IBloomGarden garden_) {
        core = core_;
        garden = garden_;
        ISqueekCore.Configuration memory c = core_.configuration();
        genesis = c.genesisTimestamp;
        roundDuration = c.roundDuration;
        uint64 settled = core_.state().settledThroughRound;
        processedThrough = settled;
        lastActive = settled;
        _bosses[0].hp = FIRST_BOSS_HP;
        emit BossSpawned(0, FIRST_BOSS_HP);
    }

    // ================================================================ play

    /// @notice Arm an army (picked flowers, or bare paws) that fights the hamster's next working round.
    function attack(uint256[] calldata flowers) external returns (uint64 round) {
        _advance(1);
        uint64 open = openRound();
        round = open + 1;
        if (_waiting(myArmy[msg.sender], lastActive)) revert AlreadyAttacking();
        if (flowers.length > MAX_FIGHTERS) revert TooManyFighters();
        IBloomGuard g = IBloomGuard(garden.guard());
        uint8 weak = weakSpecies(currentBoss);

        uint256 power = BARE + (address(g) != address(0) && g.isHolder(msg.sender) ? HOLDER_BONUS : 0);
        uint256 heads = 1;
        uint256 poppies;
        for (uint256 i; i < flowers.length; ++i) {
            uint256 id = flowers[i];
            (address owner, uint16 pts, uint8 species,) = garden.fighter(id);
            if (owner != msg.sender) revert NotYourPlant();
            if (pts == 0) revert NotAFighter();
            uint64 prevRound = foughtRound[id];
            if (prevRound != 0 && fightRound[prevRound] == 0) revert AlreadyFighting();
            if (address(g) != address(0) && !g.canFight(id)) revert Guarding(); // guarding, raiding or dueling
            uint64 ko = koUntil(id);
            if (ko >= open) revert KnockedOut();
            foughtRound[id] = round;
            uint256 p = uint256(pts) * 10;
            if (species == 3) p = (p * 3) / 2;
            if (species == weak || species == 5) p *= 2;
            power += p;
            if (species == 0) heads += 1;
            if (species == 1) poppies += 1;
        }
        Army storage a = armies[round];
        if (a.power == 0) armedRounds.push(round);
        myArmy[msg.sender] = round;
        attackPower[round][msg.sender] = power;
        fielded[round][msg.sender] = flowers.length > 0;
        a.power += uint128(power);
        a.heads += uint32(heads);
        a.poppies += uint32(poppies);
        if (power > a.topPower) (a.topPower, a.top) = (uint64(power), msg.sender);
        emit Attacked(msg.sender, round, power, flowers);
    }

    /// @notice Apply settled rounds, up to `pages` x 16 working rounds. Anyone may call it.
    function advance(uint256 pages) external {
        _advance(pages == 0 ? 1 : pages);
    }

    // =============================================================== rules

    function weakSpecies(uint256 bossId) public pure returns (uint8) {
        return uint8(0x0002040103 >> (8 * (bossId % 5))); // Sunflower, Poppy, Lotus, Star Lily, Daisy
    }

    /// Round when a knocked-out flower can act again (0 if it never got knocked out).
    function koUntil(uint256 id) public view returns (uint64) {
        uint64 t = foughtRound[id];
        if (t == 0) return 0;
        uint64 r = fightRound[t];
        if (r == 0) return 0; // not fought yet, or the result isn't written yet (isBusy covers both)
        (bytes32 seed, uint8 swipe) = (roundSeed[r], roundSwipe[r]);
        (,, uint8 species, uint8 tier) = garden.fighter(id);
        if (species == 2 || species == 5) return 0; // Star Lily and Wheelbloom dodge
        uint256 resist = uint256(tier) * 5;
        if (swipe <= resist) return 0;
        if (uint256(keccak256(abi.encode(seed, id))) % 100 < swipe - resist) return r + KO_ROUNDS;
        return 0;
    }

    /// Armed and waiting, fought but not yet written, or knocked out.
    function isBusy(uint256 id) external view returns (bool) {
        uint64 t = foughtRound[id];
        if (t != 0 && fightRound[t] == 0) return true;
        return koUntil(id) >= openRound();
    }

    function bitesNow() external view returns (uint64) {
        return _process().bites;
    }

    function openRound() public view returns (uint64) {
        return (uint64(block.timestamp) - genesis) / roundDuration + 1;
    }

    function targetRound() public view returns (uint64) {
        return openRound() + 1;
    }

    function boss(uint256 id) external view returns (Boss memory) {
        return _bosses[id];
    }

    function preview() external view returns (Summary memory) {
        Outcome memory o = _process();
        return Summary(o.through, o.bossId, o.hp, o.damage, o.lastActive, o.combo, o.bites, o.ptr, o.nKills);
    }

    function armedCount() external view returns (uint256) {
        return armedRounds.length;
    }

    function armedRound(uint256 i) external view returns (uint64) {
        return armedRounds[i];
    }

    // ============================================================ internal

    /// An army armed for round `t` has fought once he has worked a round >= t.
    function _waiting(uint64 t, uint64 lastWorked) internal pure returns (bool) {
        return t != 0 && lastWorked < t;
    }

    function _enraged(Outcome memory o) internal pure returns (bool) {
        return o.damage * 2 >= o.hp;
    }

    function _biteRate(Outcome memory o) internal pure returns (uint64) {
        return uint64((4 + o.bossId) * (_enraged(o) ? 2 : 1));
    }

    function _swipe(Outcome memory o) internal pure returns (uint8) {
        uint256 s = (10 + 3 * o.bossId) * (_enraged(o) ? 2 : 1);
        return uint8(s > 60 ? 60 : s);
    }

    /// Simulate the raid over settled rounds not yet processed (one page of up to 16 working rounds).
    function _process() internal view returns (Outcome memory o) {
        o.through = processedThrough;
        o.bossId = currentBoss;
        o.hp = _bosses[o.bossId].hp;
        o.damage = _bosses[o.bossId].damage;
        o.lastActive = lastActive;
        o.combo = combo;
        o.bites = biteIndex;
        o.ptr = armedPtr;
        uint64 settled = core.state().settledThroughRound;
        if (settled <= o.through) return o;

        ISqueekCore.RoundPage memory pg = core.roundPage(o.through, settled, 16);
        uint64 seen = o.through;
        uint64 prev = pg.start.cumulativeWork;
        for (uint256 i; i < pg.rounds.length; ++i) {
            ISqueekCore.RoundCheckpoint memory r = pg.rounds[i];
            o.bites += (r.roundId - seen - 1) * _biteRate(o); // he slept through the gap
            seen = r.roundId;
            uint64 work = r.cumulativeWork - prev;
            prev = r.cumulativeWork;
            if (r.roundId != o.lastActive + 1) o.combo = 1;
            else if (o.combo < 255) o.combo += 1;
            o.lastActive = r.roundId;
            _strike(o, r, work);
        }
        o.bites += (pg.certifiedThroughRound - seen) * _biteRate(o);
        o.through = pg.certifiedThroughRound;
    }

    function _strike(Outcome memory o, ISqueekCore.RoundCheckpoint memory r, uint64 work) internal view {
        Strike memory st = o.strikes[o.nStrikes++];
        (st.round, st.work, st.bossId, st.combo, st.seed) = (r.roundId, work, o.bossId, o.combo, r.dataHash);

        // every standing army armed for this round or earlier fights now
        uint256 heads;
        uint256 poppies;
        uint256 topPower;
        address top;
        st.armFrom = o.ptr;
        while (o.ptr < armedRounds.length && armedRounds[o.ptr] <= r.roundId) {
            Army storage a = armies[armedRounds[o.ptr++]];
            st.power += a.power;
            heads += a.heads;
            poppies += a.poppies;
            if (a.topPower > topPower) (topPower, top) = (a.topPower, a.top);
        }
        st.armTo = o.ptr;

        uint256 dmg = (uint256(work) * (100 + st.power)) / 100;
        if (heads >= 3) {
            dmg = (dmg * 3) / 2;
            st.rally = true;
        }
        dmg = (dmg * (10 + (o.combo > 6 ? 5 : o.combo - 1))) / 10;
        uint256 crit = poppies * 10;
        if (crit > 0 && uint256(keccak256(abi.encode(r.dataHash, r.roundId))) % 100 < (crit > 50 ? 50 : crit)) {
            dmg *= 2;
            st.crit = true;
        }
        if (st.power > 0) st.swipe = _swipe(o);
        st.damage = dmg;
        o.damage += dmg;
        if (o.damage >= o.hp) {
            uint256 next = (o.hp * 5) / 4;
            if (dmg * 6 > next) next = dmg * 6;
            o.kills[o.nKills++] = Kill(
                o.bossId, r.roundId, top, st.armFrom < st.armTo ? armedRounds[st.armFrom] : r.roundId, st.power, next
            );
            o.bossId += 1;
            o.hp = next;
            o.damage = 0;
        }
    }

    function _advance(uint256 pages) internal {
        for (uint256 p; p < pages; ++p) {
            Outcome memory o = _process();
            if (o.through == processedThrough) return;
            processedThrough = o.through;
            lastActive = o.lastActive;
            combo = o.combo;
            biteIndex = o.bites;
            armedPtr = o.ptr;
            for (uint256 i; i < o.nStrikes; ++i) {
                Strike memory st = o.strikes[i];
                for (uint256 j = st.armFrom; j < st.armTo; ++j) fightRound[armedRounds[j]] = st.round;
                if (st.power > 0) (roundSeed[st.round], roundSwipe[st.round]) = (st.seed, st.swipe);
                emit Struck(st.bossId, st.round, st.work, st.damage, st.power, st.crit, st.rally, st.combo, st.swipe);
            }
            for (uint256 i; i < o.nKills; ++i) {
                Kill memory k = o.kills[i];
                Boss storage b = _bosses[k.bossId];
                (b.damage, b.slainRound, b.top, b.killFrom, b.killPower) = (b.hp, k.round, k.top, k.from, k.power);
                emit BossSlain(k.bossId, k.round, k.top);
                _bosses[k.bossId + 1].hp = k.nextHp;
                emit BossSpawned(k.bossId + 1, k.nextHp);
            }
            currentBoss = o.bossId;
            _bosses[o.bossId].damage = o.damage;
        }
    }
}
