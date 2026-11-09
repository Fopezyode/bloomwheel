// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {BloomArt} from "./BloomArt.sol";
import {BloomPetals} from "./BloomPetals.sol";

/// @notice Stateless art + metadata renderer (background, pot, labels, JSON). The plant itself
///         comes from BloomPetals.
contract BloomRenderer {
    using Strings for uint256;

    BloomPetals public immutable petals;

    constructor(BloomPetals petals_) {
        petals = petals_;
    }

    function svg(uint256 id, BloomArt.Look memory l, uint64 growth, uint32 lifespan, bool harvested)
        public
        view
        returns (string memory)
    {
        return BloomArt.svg(id, l, growth, lifespan, harvested, petals.plant(l));
    }

    function tokenURI(uint256 id, BloomArt.Look memory l, uint64 growth, uint32 lifespan, bool harvested, uint8 floor)
        external
        view
        returns (string memory)
    {
        string memory json = string.concat(
            '{"name":"Bloomwheel #',
            id.toString(),
            ": ",
            BloomArt.title(l),
            '","description":"A garden that only grows when Squeektoshi runs, and fights the pests that raid it at night. Growth and battles are read live from SqueekCore.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg(id, l, growth, lifespan, harvested))),
            '","attributes":',
            BloomArt.attributes(l, growth, lifespan, harvested, floor),
            "}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
