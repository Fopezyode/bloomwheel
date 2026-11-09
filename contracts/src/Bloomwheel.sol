// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ISqueekCore} from "./ISqueekCore.sol";
import {BloomArt} from "./BloomArt.sol";
import {BloomRenderer} from "./BloomRenderer.sol";
import {IBloomGarden, IBloomRaid, IBloomGuard} from "./IBloom.sol";

/// @title Bloomwheel
/// @notice A garden that only grows when Squeektoshi runs.
///  - `plant()` mints a seed (free, gas only). 3 growing plants per wallet, 4 for Squeek holders.
///  - Growth = SqueekCore settled `cumulativeWork` minus the work at planting.
///  - From Bud on, the bloom re-rolls from keccak(seed, cumulativeWork, cumulativeBlockUnits).
///  - The raid boss bites growing plants while the hamster sleeps (shields in BloomGuard).
///    A plant wilts when growth + bites reach its lifespan.
///  - `harvest()` freezes the bloom you saw; picked flowers fight (BloomRaid) or guard (BloomGuard).
contract Bloomwheel is ERC721, IBloomGarden {
    uint256 public constant MAX_GROWING = 3;
    uint32 internal constant MIN_LIFESPAN = 2000;
    uint32 internal constant LIFESPAN_SPREAD = 2001; // lifespan in [2000, 4000] work
    uint64 internal constant SPROUT = 30;
    uint64 internal constant SEEDLING = 150;
    uint64 internal constant BUD = 400;
    uint64 internal constant BLOOM = 800;
    uint64 internal constant RADIANT = 1600;

    struct Plant {
        bytes32 seed;
        uint64 plantedWork;
        uint64 endWork;
        uint64 biteSnap; // gardener's taken bites at planting
        uint64 endBitten;
        uint32 lifespan;
        bool harvested;
        uint8 floor; // minimum bloom tier (boss loot)
        BloomArt.Look look; // frozen at harvest
    }

    struct PlantView {
        uint256 id;
        address owner;
        uint64 plantedWork;
        uint64 growth;
        uint64 bitten;
        uint32 lifespan;
        bool harvested;
        uint8 floor;
        BloomArt.Look look;
        uint16 points;
    }

    ISqueekCore public immutable core;
    BloomRenderer public immutable renderer;
    address private immutable _deployer;
    address public raid;
    address public guard;
    address public pvp;

    uint256 public totalPlanted;
    mapping(uint256 => Plant) private _plants;
    mapping(address => uint256) internal growingOf;

    event Planted(uint256 indexed id, address indexed gardener, uint64 plantedWork, uint8 species, uint32 lifespan, uint8 floor);
    event Harvested(uint256 indexed id, address indexed gardener, uint64 growth, uint8 stage, uint8 tier, uint8 species, bool wilted, uint16 points);

    error PlotsFull();
    error NotYourPlant();
    error AlreadyHarvested();
    error GardenChanged();
    error StillRooted();
    error Guarding();
    error NotRaid();

    constructor(ISqueekCore core_, BloomRenderer renderer_) ERC721("Bloomwheel", "BLOOM") {
        core = core_;
        renderer = renderer_;
        _deployer = msg.sender;
    }

    /// One-time link to the raid (loot, bite index), guard (shields) and PvP (heists, duels) contracts.
    function setLinks(address raid_, address guard_, address pvp_) external {
        if (msg.sender != _deployer || raid != address(0)) revert NotRaid();
        raid = raid_;
        guard = guard_;
        pvp = pvp_;
    }

    // ============================================================== garden

    function _plots(address a) internal view returns (uint256) {
        return MAX_GROWING + (guard != address(0) && IBloomGuard(guard).isHolder(a) ? 1 : 0);
    }

    function plant() external returns (uint256 id) {
        if (growingOf[msg.sender] >= _plots(msg.sender)) revert PlotsFull();
        id = _plantFor(msg.sender, 0);
    }

    /// @param expectedWork The SqueekCore cumulativeWork the player was looking at.
    function harvest(uint256 id, uint64 expectedWork) external returns (BloomArt.Look memory look) {
        if (_ownerOf(id) != msg.sender) revert NotYourPlant();
        Plant storage p = _plants[id];
        if (p.harvested) revert AlreadyHarvested();
        ISqueekCore.CoreState memory s = core.state();
        if (s.cumulativeWork != expectedWork) revert GardenChanged();

        uint64 bitten = _bitten(p, msg.sender, _biteIdx());
        look = _roll(p, s.cumulativeWork, s.cumulativeBlockUnits, bitten);
        p.harvested = true;
        p.endWork = s.cumulativeWork;
        p.endBitten = bitten;
        p.look = look;
        uint16 pts = BloomArt.points(look);
        unchecked {
            growingOf[msg.sender]--;
        }
        emit Harvested(id, msg.sender, s.cumulativeWork - p.plantedWork, look.stage, look.tier, look.species, look.wilted, pts);
    }

    // ===================================================== raid + guard hooks

    function fighter(uint256 id) external view returns (address owner, uint16 points, uint8 species, uint8 tier) {
        owner = _ownerOf(id);
        Plant storage p = _plants[id];
        if (!p.harvested) return (owner, 0, 0, 0);
        return (owner, BloomArt.points(p.look), p.look.species, p.look.tier);
    }

    /// Boss loot (from BloomGuard.claimLoot). Like any seed it needs a free plot.
    function mintLoot(address to, uint8 floor) external returns (uint256 seedId) {
        if (msg.sender != guard) revert NotRaid();
        if (growingOf[to] >= _plots(to)) revert PlotsFull();
        seedId = _plantFor(to, floor);
    }

    function plantState(uint256 id) external view returns (address owner, bool growing, uint64 growth) {
        Plant storage p = _plants[id];
        owner = _ownerOf(id);
        growing = owner != address(0) && !p.harvested;
        if (growing) growth = core.state().cumulativeWork - p.plantedWork;
    }

    /// Heist loot: `amount` growth leaves one growing plant and lands in another.
    function shiftGrowth(uint256 from, uint256 to, uint64 amount) external {
        if (msg.sender != pvp) revert NotRaid();
        Plant storage a = _plants[from];
        Plant storage b = _plants[to];
        if (a.harvested || b.harvested) revert AlreadyHarvested();
        a.plantedWork += amount;
        b.plantedWork = b.plantedWork > amount ? b.plantedWork - amount : 0;
    }

    /// The PvP contract escrows duel flowers without a separate approval transaction.
    function isApprovedForAll(address owner, address operator) public view override returns (bool) {
        return (operator == pvp && pvp != address(0)) || super.isApprovedForAll(owner, operator);
    }

    // =============================================================== views

    function plantViews(uint256 fromId, uint256 count)
        external
        view
        returns (PlantView[] memory plants, uint64 work, uint64 settledThroughRound)
    {
        ISqueekCore.CoreState memory s = core.state();
        work = s.cumulativeWork;
        settledThroughRound = s.settledThroughRound;
        uint64 idx = _biteIdx();
        if (fromId == 0) fromId = 1;
        uint256 last = totalPlanted;
        uint256 n = fromId > last ? 0 : last - fromId + 1;
        if (n > count) n = count;
        plants = new PlantView[](n);
        for (uint256 i; i < n; ++i) {
            plants[i] = _view(fromId + i, s.cumulativeWork, s.cumulativeBlockUnits, idx);
        }
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        ISqueekCore.CoreState memory s = core.state();
        PlantView memory v = _view(id, s.cumulativeWork, s.cumulativeBlockUnits, _biteIdx());
        return renderer.tokenURI(id, v.look, v.growth, v.lifespan, v.harvested, v.floor);
    }

    // ============================================================ internal

    function _biteIdx() internal view returns (uint64) {
        return raid == address(0) ? 0 : IBloomRaid(raid).bitesNow();
    }

    function _bitesOf(address owner, uint64 idx) internal view returns (uint64) {
        return guard == address(0) ? 0 : IBloomGuard(guard).ownerBitesAt(owner, idx);
    }

    function _bitten(Plant storage p, address owner, uint64 idx) internal view returns (uint64) {
        uint64 b = _bitesOf(owner, idx);
        return b > p.biteSnap ? b - p.biteSnap : 0;
    }

    function _plantFor(address to, uint8 floor) internal returns (uint256 id) {
        ISqueekCore.CoreState memory s = core.state();
        id = ++totalPlanted;
        bytes32 seed = keccak256(abi.encode(id, to, block.prevrandao, s.cumulativeBlockUnits));
        uint32 lifespan = MIN_LIFESPAN + uint32(uint256(seed) % LIFESPAN_SPREAD);
        Plant storage p = _plants[id];
        p.seed = seed;
        p.plantedWork = s.cumulativeWork;
        p.lifespan = lifespan;
        p.floor = floor;
        p.biteSnap = _bitesOf(to, _biteIdx());
        unchecked {
            growingOf[to]++;
        }
        _mint(to, id);
        emit Planted(id, to, s.cumulativeWork, _species(seed), lifespan, floor);
    }

    function _view(uint256 id, uint64 work, uint96 units, uint64 idx) internal view returns (PlantView memory v) {
        Plant storage p = _plants[id];
        v.id = id;
        v.owner = _ownerOf(id);
        v.plantedWork = p.plantedWork;
        v.lifespan = p.lifespan;
        v.harvested = p.harvested;
        v.floor = p.floor;
        if (p.harvested) {
            v.look = p.look;
            v.growth = p.endWork - p.plantedWork;
            v.bitten = p.endBitten;
        } else {
            v.bitten = _bitten(p, v.owner, idx);
            v.look = _roll(p, work, units, v.bitten);
            v.growth = work - p.plantedWork;
        }
        v.points = BloomArt.points(v.look);
    }

    function _roll(Plant storage p, uint64 work, uint96 units, uint64 bitten)
        internal
        view
        returns (BloomArt.Look memory l)
    {
        uint64 growth = work - p.plantedWork;
        l.species = _species(p.seed);
        l.stage = _stage(growth);
        if (growth + bitten >= p.lifespan) {
            l.wilted = true;
            return l;
        }
        if (l.stage < 3) return l;

        uint256 r = uint256(keccak256(abi.encode(p.seed, work, units)));
        l.tier = _tier(l.stage, r % 10_000);
        if (l.tier < p.floor) l.tier = p.floor;
        l.palette = uint8((r >> 32) % 3);
        l.petals = BloomArt.basePetals(l.species) + uint8((r >> 40) % 4);
        if (l.tier == 5) l.species = 5; // every legendary is a Wheelbloom
    }

    function _species(bytes32 seed) internal pure returns (uint8) {
        return uint8(uint256(seed) >> 248) % 5;
    }

    function _stage(uint64 g) internal pure returns (uint8) {
        if (g >= RADIANT) return 5;
        if (g >= BLOOM) return 4;
        if (g >= BUD) return 3;
        if (g >= SEEDLING) return 2;
        if (g >= SPROUT) return 1;
        return 0;
    }

    /// Odds per roll (bp): Bud 0/50/400/2000, Bloom 50/300/1200/3000, Radiant 300/900/2000/3000
    /// for Legendary/Epic/Rare/Uncommon; the rest Common.
    function _tier(uint8 stage, uint256 x) internal pure returns (uint8) {
        if (stage == 3) {
            if (x < 50) return 4;
            if (x < 450) return 3;
            if (x < 2450) return 2;
            return 1;
        }
        if (stage == 4) {
            if (x < 50) return 5;
            if (x < 350) return 4;
            if (x < 1550) return 3;
            if (x < 4550) return 2;
            return 1;
        }
        if (x < 300) return 5;
        if (x < 1200) return 4;
        if (x < 3200) return 3;
        if (x < 6200) return 2;
        return 1;
    }

    /// Growing plants stay in the ground; guards stay at their post.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            if (!_plants[tokenId].harvested) revert StillRooted();
            if (guard != address(0) && IBloomGuard(guard).isGuarding(tokenId)) revert Guarding();
        }
        return super._update(to, tokenId, auth);
    }
}
