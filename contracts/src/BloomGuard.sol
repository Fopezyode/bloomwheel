// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IBloomGarden, IBloomRaid, IBloomPvP, ISqueekNFT, ISqueekStaking} from "./IBloom.sol";

interface IRaidLoot {
    struct Boss {
        uint256 hp;
        uint256 damage;
        uint64 slainRound;
        uint64 killFrom;
        uint256 killPower;
        address top;
    }

    function advance(uint256 pages) external;
    function boss(uint256 id) external view returns (Boss memory);
    function attackPower(uint64 round, address a) external view returns (uint256);
    function fielded(uint64 round, address a) external view returns (bool);
}

/// @title BloomGuard
/// @notice Station up to 3 picked flowers at home to shield your growing plants from the
///         boss's bites. Shield % = sum of guard points (Lotus counts double), max 90%.
///         Guards can't fight, so every flower is a choice: attack or defend.
///
///  Bites are tracked per gardener in O(1): the raid keeps a global bite index (bites per
///  sleeping round, summed), and each gardener's taken bites grow with it at (100 - shield)%.
///  A plant's bites = its gardener's taken bites now - at planting.
contract BloomGuard {
    uint256 public constant MAX_GUARDS = 3;
    uint256 public constant MAX_SHIELD = 90;

    IBloomGarden public immutable garden;
    ISqueekNFT public immutable squeekNft;
    ISqueekStaking public immutable squeekStaking;

    mapping(address => uint256[]) private _guards;
    mapping(uint256 => address) public guardOf;
    mapping(address => uint256) public shield;
    mapping(address => uint64) private _taken; // bites taken up to _lastIdx
    mapping(address => uint64) private _lastIdx;

    mapping(uint256 => mapping(address => bool)) public lootClaimed;

    event Stationed(address indexed gardener, uint256[] flowers, uint256 shield);
    event LootClaimed(uint256 indexed bossId, address indexed gardener, uint256 seedId, uint8 floor);

    error TooManyGuards();
    error NotYourPlant();
    error NotAFighter(uint256 id);
    error Busy(uint256 id);
    error Duplicate(uint256 id);
    error BossAlive();
    error NoLoot();
    error LootTaken();

    constructor(IBloomGarden garden_, ISqueekNFT nft_, ISqueekStaking staking_) {
        garden = garden_;
        squeekNft = nft_;
        squeekStaking = staking_;
    }

    /// Squeek holder perk (+1 plot, +5 bare-paw power): a Squeek in the wallet or staked.
    function isHolder(address a) external view returns (bool) {
        if (address(squeekNft) != address(0)) {
            try squeekNft.balanceOf(a) returns (uint256 b) {
                if (b > 0) return true;
            } catch {}
        }
        if (address(squeekStaking) != address(0)) {
            try squeekStaking.accountPower(a) returns (uint256 nftPower, uint256) {
                if (nftPower > 0) return true;
            } catch {}
        }
        return false;
    }

    /// @notice Replace your guards with `ids` (empty to bring everyone home).
    function station(uint256[] calldata ids) external {
        if (ids.length > MAX_GUARDS) revert TooManyGuards();
        IBloomRaid raid = IBloomRaid(garden.raid());
        _checkpoint(msg.sender, raid.bitesNow());

        uint256[] storage old = _guards[msg.sender];
        for (uint256 i; i < old.length; ++i) delete guardOf[old[i]];
        delete _guards[msg.sender];

        uint256 s;
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            (address owner, uint16 pts, uint8 species,) = garden.fighter(id);
            if (owner != msg.sender) revert NotYourPlant();
            if (pts == 0) revert NotAFighter(id);
            if (guardOf[id] != address(0)) revert Duplicate(id);
            if (raid.isBusy(id)) revert Busy(id);
            address p = garden.pvp();
            if (p != address(0) && IBloomPvP(p).isBusy(id)) revert Busy(id);
            guardOf[id] = msg.sender;
            _guards[msg.sender].push(id);
            s += species == 4 ? uint256(pts) * 2 : pts;
        }
        shield[msg.sender] = s > MAX_SHIELD ? MAX_SHIELD : s;
        emit Stationed(msg.sender, ids, shield[msg.sender]);
    }

    /// @notice Boss loot. `armyRound` is the round your army was armed for (your Attacked event).
    ///         Needs: the army fought the killing round, fielded at least one flower, and brought
    ///         >= 5% of that round's power. Biggest army: Champion Seed (Epic+); others Boss Seed (Rare+).
    ///         The seed needs a free plot: if yours are full, pick something and claim later.
    function claimLoot(uint256 bossId, uint64 armyRound) external returns (uint256 seedId) {
        IRaidLoot raid = IRaidLoot(garden.raid());
        raid.advance(1);
        IRaidLoot.Boss memory b = raid.boss(bossId);
        if (b.slainRound == 0) revert BossAlive();
        if (
            armyRound < b.killFrom || armyRound > b.slainRound || !raid.fielded(armyRound, msg.sender)
                || raid.attackPower(armyRound, msg.sender) * 20 < b.killPower
        ) revert NoLoot();
        if (lootClaimed[bossId][msg.sender]) revert LootTaken();
        lootClaimed[bossId][msg.sender] = true;
        uint8 floor = msg.sender == b.top ? 4 : 3;
        seedId = garden.mintLoot(msg.sender, floor);
        emit LootClaimed(bossId, msg.sender, seedId, floor);
    }

    function guardsOf(address a) external view returns (uint256[] memory) {
        return _guards[a];
    }

    function isGuarding(uint256 id) external view returns (bool) {
        return guardOf[id] != address(0);
    }

    function canFight(uint256 id) external view returns (bool) {
        if (guardOf[id] != address(0)) return false;
        address p = garden.pvp();
        return p == address(0) || !IBloomPvP(p).isBusy(id);
    }

    function ownerBitesAt(address a, uint64 idx) public view returns (uint64) {
        uint64 last = _lastIdx[a];
        if (idx < last) idx = last;
        return _taken[a] + uint64((uint256(idx - last) * (100 - shield[a])) / 100);
    }

    function ownerBites(address a) external view returns (uint64) {
        return ownerBitesAt(a, IBloomRaid(garden.raid()).bitesNow());
    }

    function _checkpoint(address a, uint64 idx) internal {
        _taken[a] = ownerBitesAt(a, idx);
        if (idx > _lastIdx[a]) _lastIdx[a] = idx;
    }
}
