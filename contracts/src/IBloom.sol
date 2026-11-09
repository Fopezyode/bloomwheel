// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice How the Bloomwheel contracts see each other.
interface IBloomGarden {
    /// Owner of a flower plus what it brings to a fight. points = 0 unless picked and not wilted.
    function fighter(uint256 id) external view returns (address owner, uint16 points, uint8 species, uint8 tier);
    /// Owner, whether it is still growing (not picked), and its growth in work.
    function plantState(uint256 id) external view returns (address owner, bool growing, uint64 growth);
    function mintLoot(address to, uint8 floor) external returns (uint256 seedId);
    /// Heists: move `amount` growth from one growing plant to another (PvP contract only).
    function shiftGrowth(uint256 from, uint256 to, uint64 amount) external;
    function raid() external view returns (address);
    function guard() external view returns (address);
    function pvp() external view returns (address);
}

interface IBloomRaid {
    /// Cumulative sleeping-round bites, including settled rounds not yet written.
    function bitesNow() external view returns (uint64);
    /// Fighting this round or the next, or knocked out.
    function isBusy(uint256 id) external view returns (bool);
    function openRound() external view returns (uint64);
    function targetRound() external view returns (uint64);
}

interface IBloomGuard {
    function isGuarding(uint256 id) external view returns (bool);
    /// Not guarding and not tied up in a heist or duel.
    function canFight(uint256 id) external view returns (bool);
    /// Bites an owner's garden has taken (after shields) at bite index `idx`.
    function ownerBitesAt(address owner, uint64 idx) external view returns (uint64);
    /// Holds a Squeek in the wallet or has Squeeks staked.
    function isHolder(address a) external view returns (bool);
    function shield(address a) external view returns (uint256);
}

interface IBloomPvP {
    /// Raiding, jailed, or held in a duel.
    function isBusy(uint256 id) external view returns (bool);
}

/// Squeekchain's own collection + staking, for the holder perk.
interface ISqueekNFT {
    function balanceOf(address owner) external view returns (uint256);
}

interface ISqueekStaking {
    function accountPower(address account) external view returns (uint256 nftPower, uint256 sqkPower);
}
