// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Local stand-in for SqueekNFT's balanceOf, for the holder perk.
contract MockSqueekNFT {
    mapping(address => uint256) public balanceOf;

    function mint(address to) external {
        balanceOf[to] += 1;
    }
}
