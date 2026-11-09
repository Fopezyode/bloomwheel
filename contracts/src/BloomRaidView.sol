// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BloomRaid} from "./BloomRaid.sol";

/// @notice Read-only helper: everything the page shows about the raid in one call.
///         Split from BloomRaid so the raid fits Sepolia's per-transaction gas cap.
contract BloomRaidView {
    BloomRaid public immutable raid;

    struct RaidView {
        uint256 bossId;
        uint256 hp;
        uint256 damage;
        bool enraged;
        uint8 weakSpecies;
        uint8 swipe;
        uint64 biteRate;
        uint64 bites;
        uint8 combo;
        uint64 processedThrough;
        uint64 openRound;
        uint64 targetRound;
        uint64 roundEndsAt;
        uint256 armedPower; // armies waiting for his next working round (tenths)
        uint256 armedHeads;
        uint256 armedPoppies;
        uint64 myArmy; // my waiting army's round (0 = none)
        uint256 myPower;
        uint256 pendingKills;
    }

    constructor(BloomRaid raid_) {
        raid = raid_;
    }

    function raidState(address me) external view returns (RaidView memory v) {
        BloomRaid.Summary memory o = raid.preview();
        v.bossId = o.bossId;
        v.hp = o.hp;
        v.damage = o.damage;
        v.enraged = o.damage * 2 >= o.hp;
        v.weakSpecies = raid.weakSpecies(o.bossId);
        uint256 sw = (10 + 3 * o.bossId) * (v.enraged ? 2 : 1);
        v.swipe = uint8(sw > 60 ? 60 : sw);
        v.biteRate = uint64((4 + o.bossId) * (v.enraged ? 2 : 1));
        v.bites = o.bites;
        v.combo = o.combo;
        v.processedThrough = o.through;
        v.openRound = raid.openRound();
        v.targetRound = v.openRound + 1;
        v.roundEndsAt = raid.genesis() + v.openRound * raid.roundDuration();
        uint256 n = raid.armedCount();
        for (uint256 i = o.ptr; i < n; ++i) {
            (uint128 power, uint32 heads, uint32 poppies,,) = raid.armies(raid.armedRound(i));
            v.armedPower += power;
            v.armedHeads += heads;
            v.armedPoppies += poppies;
        }
        uint64 mine = raid.myArmy(me);
        if (mine != 0 && o.lastActive < mine) (v.myArmy, v.myPower) = (mine, raid.attackPower(mine, me));
        v.pendingKills = o.pendingKills;
    }
}
