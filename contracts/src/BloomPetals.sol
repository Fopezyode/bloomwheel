// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BloomArt} from "./BloomArt.sol";

/// @notice Draws the plant itself (seed, stem, leaves, petal rings, Wheelbloom, wilted stalk).
///         Split from BloomRenderer so every contract fits Sepolia's per-transaction gas cap
///         at 1,542 gas per byte of deployed code.
contract BloomPetals {
    function plant(BloomArt.Look memory l) external pure returns (string memory) {
        return BloomArt.plant(l);
    }
}
