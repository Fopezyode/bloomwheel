// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IBloomGarden} from "../IBloom.sol";

/// @notice Test-only garden: serves fighters with chosen species/tier so raid rules can be checked exactly.
contract MockGarden is IBloomGarden {
    struct F {
        address owner;
        uint16 points;
        uint8 species;
        uint8 tier;
    }

    mapping(uint256 => F) public fighters;
    address public raid;
    address public guard;
    address public pvp;
    uint256 public minted;

    function setFighter(uint256 id, address owner, uint16 points, uint8 species, uint8 tier) external {
        fighters[id] = F(owner, points, species, tier);
    }

    function setLinks(address raid_, address guard_) external {
        raid = raid_;
        guard = guard_;
    }

    function fighter(uint256 id) external view returns (address, uint16, uint8, uint8) {
        F memory f = fighters[id];
        return (f.owner, f.points, f.species, f.tier);
    }

    function plantState(uint256 id) external view returns (address, bool, uint64) {
        return (fighters[id].owner, false, 0);
    }

    function mintLoot(address, uint8) external returns (uint256) {
        return ++minted;
    }

    function shiftGrowth(uint256, uint256, uint64) external pure {}

}
