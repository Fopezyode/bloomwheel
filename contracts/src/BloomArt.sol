// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Pure on-chain renderer for Bloomwheel plants. 400x400 SVG, no external assets.
library BloomArt {
    using Strings for uint256;

    struct Look {
        uint8 stage; // 0 Seed .. 5 Radiant
        uint8 tier; // 0 none, 1 Common .. 5 Legendary
        uint8 species; // 0 Daisy, 1 Poppy, 2 Star Lily, 3 Sunflower, 4 Lotus, 5 Wheelbloom
        uint8 palette; // 0..2 within the tier
        uint8 petals;
        bool wilted;
    }

    // c1 petal, c2 outer ring / wheel, c3 centre — 15 palettes x 3 colours x 6 hex chars
    bytes internal constant PALETTES = "FFFFFFF3E6C8F2C14E" "F8C8D4F3A6B8F6D365" "FFF1A8F7DC6FC98B2B"
        "FF8A65FFB1997A3E1D" "7EC8E3B5E2F2F4D35E" "C3A6F0E0D0FAF7C948" "D7263DF460361B1B1E" "2E5EAA5B8DEFF2E94E"
        "1B998B7DE2D1FDE74C" "FF2E9700E5FFFFF200" "9D4EDDFF9E00FFFFFF" "00F5A000D9F5FF006E" "FFD166FFB703FFF3B0"
        "F7B2A1E8A87CFFF0E0" "E5E5E5BFC9D9FFFFFF";

    // ------------------------------------------------------------- naming

    function speciesName(uint8 s) internal pure returns (string memory) {
        if (s == 0) return "Daisy";
        if (s == 1) return "Poppy";
        if (s == 2) return "Star Lily";
        if (s == 3) return "Sunflower";
        if (s == 4) return "Lotus";
        return "Wheelbloom";
    }

    function stageName(uint8 s) internal pure returns (string memory) {
        if (s == 0) return "Seed";
        if (s == 1) return "Sprout";
        if (s == 2) return "Seedling";
        if (s == 3) return "Bud";
        if (s == 4) return "Bloom";
        return "Radiant";
    }

    function tierName(uint8 t) internal pure returns (string memory) {
        if (t == 1) return "Common";
        if (t == 2) return "Uncommon";
        if (t == 3) return "Rare";
        if (t == 4) return "Epic";
        if (t == 5) return "Legendary";
        return "None";
    }

    function basePetals(uint8 species) internal pure returns (uint8) {
        if (species == 0) return 12;
        if (species == 1) return 5;
        if (species == 2) return 6;
        if (species == 3) return 16;
        return 8;
    }

    function points(Look memory l) internal pure returns (uint16) {
        if (l.wilted) return 0;
        if (l.tier == 1) return 1;
        if (l.tier == 2) return 3;
        if (l.tier == 3) return 8;
        if (l.tier == 4) return 25;
        if (l.tier == 5) return 100;
        return 0;
    }

    function title(Look memory l) internal pure returns (string memory) {
        if (l.wilted) return string.concat("Wilted ", speciesName(l.species));
        if (l.stage < 3) return string.concat(speciesName(l.species), " ", stageName(l.stage));
        return string.concat(tierName(l.tier), " ", speciesName(l.species));
    }

    function attributes(Look memory l, uint64 growth, uint32 lifespan, bool harvested, uint8 floor)
        internal
        pure
        returns (string memory)
    {
        string memory status = l.wilted ? "Wilted" : (harvested ? "Picked" : "Growing");
        string memory origin = floor >= 4 ? "Champion seed" : floor == 3 ? "Boss seed" : "Garden";
        return string.concat(
            '[{"trait_type":"Origin","value":"',
            origin,
            '"},{"trait_type":"Species","value":"',
            speciesName(l.species),
            '"},{"trait_type":"Stage","value":"',
            stageName(l.stage),
            '"},{"trait_type":"Rarity","value":"',
            tierName(l.tier),
            '"},{"trait_type":"Status","value":"',
            status,
            '"},{"display_type":"number","trait_type":"Growth","value":',
            uint256(growth).toString(),
            '},{"display_type":"number","trait_type":"Lifespan","value":',
            uint256(lifespan).toString(),
            '},{"display_type":"number","trait_type":"Points","value":',
            uint256(points(l)).toString(),
            "}]"
        );
    }

    // ---------------------------------------------------------------- svg

    /// @param plantSvg The plant itself (stem, leaves, flower), drawn by BloomPetals.
    function svg(uint256 id, Look memory l, uint64 growth, uint32 lifespan, bool harvested, string memory plantSvg)
        internal
        pure
        returns (string memory)
    {
        uint256 top = stemTop(l.stage);
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400"><rect width="400" height="400" fill="',
            bg(l),
            '"/>',
            aura(l, top),
            '<path d="M146 330H254L242 386H158Z" fill="#C8744A"/><rect x="136" y="316" width="128" height="18" rx="6" fill="#B25F3A"/><ellipse cx="200" cy="320" rx="56" ry="6" fill="#5A3D2B"/>',
            plantSvg,
            label(id, l, growth, lifespan, harvested),
            "</svg>"
        );
    }

    function stemTop(uint8 stage) internal pure returns (uint256) {
        if (stage == 0) return 314;
        if (stage == 1) return 280;
        if (stage == 2) return 240;
        if (stage == 3) return 200;
        if (stage == 4) return 172;
        return 150;
    }

    function bg(Look memory l) internal pure returns (string memory) {
        if (l.wilted) return "#EDE4D3";
        if (l.tier == 1) return "#F6F2E7";
        if (l.tier == 2) return "#E9F2FB";
        if (l.tier == 3) return "#F4EAF7";
        if (l.tier == 4) return "#1E1A38";
        if (l.tier == 5) return "#231C0E";
        return "#EEF5EA";
    }

    function ink(Look memory l) internal pure returns (string memory) {
        if (l.wilted) return "#5C4A32";
        if (l.tier == 1) return "#3B3A30";
        if (l.tier == 2) return "#24384F";
        if (l.tier == 3) return "#3D2547";
        if (l.tier == 4) return "#F4F1FF";
        if (l.tier == 5) return "#FFE9A8";
        return "#2F4A2A";
    }

    function aura(Look memory l, uint256 top) internal pure returns (string memory) {
        if (l.wilted || l.tier < 4) return "";
        string memory glow = l.tier == 5
            ? string.concat(
                '<defs><radialGradient id="g"><stop offset="0" stop-color="#FFD166" stop-opacity=".6"/><stop offset="1" stop-color="#FFD166" stop-opacity="0"/></radialGradient></defs><circle cx="200" cy="',
                top.toString(),
                '" r="150" fill="url(#g)"/>'
            )
            : "";
        return string.concat(
            glow,
            '<path fill="',
            l.tier == 5 ? "#FFE08A" : "#FFFFFF",
            '" d="M70 91L72 98L79 100L72 102L70 109L68 102L61 100L68 98ZM330 111L332 118L339 120L332 122L330 129L328 122L321 120L328 118ZM86 241L88 248L95 250L88 252L86 259L84 252L77 250L84 248ZM316 227L318 234L325 236L318 238L316 245L314 238L307 236L314 234Z"/>'
        );
    }

    /// Everything between the pot and the label: seed, stem, leaves, flower head or wilted stalk.
    function plant(Look memory l) internal pure returns (string memory) {
        uint256 top = stemTop(l.stage);
        return l.wilted ? wilted(top) : growing(l, top);
    }

    function growing(Look memory l, uint256 top) internal pure returns (string memory) {
        if (l.stage == 0) {
            return
            '<ellipse cx="200" cy="314" rx="9" ry="6" fill="#8A6A3E"/><path d="M195 312Q200 308 205 312" stroke="#5A3D2B" stroke-width="1.5" fill="none"/>';
        }
        return string.concat(stem(top, "#4F8A3E"), leaves(l.stage, top), head(l, top));
    }

    function stem(uint256 top, string memory color) internal pure returns (string memory) {
        return string.concat(
            '<path d="M200 320Q192 ',
            ((320 + top) / 2).toString(),
            " 200 ",
            top.toString(),
            '" stroke="',
            color,
            '" stroke-width="7" fill="none" stroke-linecap="round"/>'
        );
    }

    function leaves(uint8 stage, uint256 top) internal pure returns (string memory) {
        uint256 y = 320 - ((320 - top) * 45) / 100;
        string memory left = string.concat(
            '<path fill="#6FAE52" d="M198 ',
            y.toString(),
            "C180 ",
            (y - 22).toString(),
            " 158 ",
            (y - 14).toString(),
            " 146 ",
            (y - 4).toString(),
            "C164 ",
            (y + 8).toString(),
            " 184 ",
            (y + 6).toString(),
            " 198 ",
            y.toString(),
            'Z"/>'
        );
        if (stage < 2) return left;
        uint256 z = y - 24;
        return string.concat(
            left,
            '<path fill="#6FAE52" d="M202 ',
            z.toString(),
            "C220 ",
            (z - 22).toString(),
            " 242 ",
            (z - 14).toString(),
            " 254 ",
            (z - 4).toString(),
            "C236 ",
            (z + 8).toString(),
            " 216 ",
            (z + 6).toString(),
            " 202 ",
            z.toString(),
            'Z"/>'
        );
    }

    function head(Look memory l, uint256 top) internal pure returns (string memory) {
        if (l.stage < 3) return "";
        (string memory c1, string memory c2, string memory c3) = palette(l.tier, l.palette);
        string memory t = top.toString();
        if (l.stage == 3) {
            return string.concat(
                '<ellipse cx="200" cy="',
                (top - 18).toString(),
                '" rx="15" ry="22" fill="',
                c1,
                '" stroke="#000" stroke-opacity=".12"/><path fill="#4F8A3E" d="M200 ',
                t,
                "L185 ",
                (top - 20).toString(),
                "Q194 ",
                (top - 10).toString(),
                " 200 ",
                (top - 8).toString(),
                "Q206 ",
                (top - 10).toString(),
                " 215 ",
                (top - 20).toString(),
                'Z"/>'
            );
        }
        if (l.species == 5) return wheel(top, l.petals, c1, c2, c3);

        (uint256 len, uint256 w, uint256 r) = shape(l.species);
        bool pointed = l.species == 2;
        string memory petalsSvg = l.stage == 5 ? ring(top, l.petals, len + 12, len + 12, w + 2, c2, 1800 / l.petals, pointed) : "";
        return string.concat(
            petalsSvg,
            ring(top, l.petals, len, len, w, c1, 0, pointed),
            '<circle cx="200" cy="',
            t,
            '" r="',
            r.toString(),
            '" fill="',
            c3,
            '"/><circle cx="200" cy="',
            t,
            '" r="',
            (r - 5).toString(),
            '" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="3" stroke-dasharray="2 4"/>'
        );
    }

    /// (petal length, petal half-width, centre radius)
    function shape(uint8 species) internal pure returns (uint256, uint256, uint256) {
        if (species == 0) return (30, 7, 12);
        if (species == 1) return (28, 22, 13);
        if (species == 2) return (24, 12, 9);
        if (species == 3) return (32, 9, 24);
        return (34, 13, 11);
    }

    /// `n` petals whose centres sit `dist` from the flower centre, each `len` long.
    function ring(
        uint256 top,
        uint256 n,
        uint256 dist,
        uint256 len,
        uint256 w,
        string memory color,
        uint256 offsetTenths,
        bool pointed
    ) internal pure returns (string memory out) {
        string memory t = top.toString();
        string memory petal = pointed
            ? string.concat(
                '<path d="M200 ',
                (top - dist + len).toString(),
                "L",
                (200 - w).toString(),
                " ",
                (top - dist).toString(),
                "L200 ",
                (top - dist - len).toString(),
                "L",
                (200 + w).toString(),
                " ",
                (top - dist).toString(),
                'Z"'
            )
            : string.concat(
                '<ellipse cx="200" cy="', (top - dist).toString(), '" rx="', w.toString(), '" ry="', len.toString(), '"'
            );
        out = string.concat('<g fill="', color, '" stroke="#000" stroke-opacity=".12">');
        for (uint256 i; i < n; ++i) {
            out = string.concat(out, petal, ' transform="rotate(', deg(offsetTenths + (i * 3600) / n), " 200 ", t, ')"/>');
        }
        out = string.concat(out, "</g>");
    }

    /// Legendary: a hamster wheel in bloom.
    function wheel(uint256 top, uint8 n, string memory c1, string memory c2, string memory c3)
        internal
        pure
        returns (string memory out)
    {
        string memory t = top.toString();
        out = string.concat(
            ring(top, n, 62, 13, 8, c1, 0, false),
            '<circle cx="200" cy="',
            t,
            '" r="48" fill="none" stroke="',
            c2,
            '" stroke-width="8"/><g fill="',
            c2,
            '">'
        );
        string memory y = (top - 46).toString();
        for (uint256 i; i < 8; ++i) {
            out = string.concat(
                out, '<rect x="198" y="', y, '" width="4" height="46" transform="rotate(', (i * 45).toString(), " 200 ", t, ')"/>'
            );
        }
        out = string.concat(
            out, '</g><circle cx="200" cy="', t, '" r="12" fill="', c3, '" stroke="', c2, '" stroke-width="3"/>'
        );
    }

    function wilted(uint256 top) internal pure returns (string memory) {
        string memory hx = "236";
        string memory hy = (top + 34).toString();
        return string.concat(
            '<path d="M200 320Q196 ',
            ((320 + top) / 2).toString(),
            " 214 ",
            top.toString(),
            "Q228 ",
            (top + 6).toString(),
            " ",
            hx,
            " ",
            (top + 22).toString(),
            '" stroke="#9C8456" stroke-width="7" fill="none" stroke-linecap="round"/><g fill="#B49A7A" stroke="#5C4A32" stroke-opacity=".25"><ellipse cx="226" cy="',
            (top + 52).toString(),
            '" rx="7" ry="18" transform="rotate(20 ',
            hx,
            " ",
            hy,
            ')"/><ellipse cx="246" cy="',
            (top + 52).toString(),
            '" rx="7" ry="18" transform="rotate(-20 ',
            hx,
            " ",
            hy,
            ')"/><ellipse cx="168" cy="314" rx="10" ry="4" transform="rotate(-12 168 314)"/><ellipse cx="236" cy="316" rx="9" ry="4" transform="rotate(14 236 316)"/></g><circle cx="',
            hx,
            '" cy="',
            hy,
            '" r="11" fill="#7A5C3E"/>'
        );
    }

    function label(uint256 id, Look memory l, uint64 growth, uint32 lifespan, bool harvested)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            '<g font-family="ui-monospace,Menlo,Consolas,monospace" fill="',
            ink(l),
            '"><text x="20" y="34" font-size="16" font-weight="700">#',
            id.toString(),
            '</text><text x="20" y="56" font-size="13">',
            title(l),
            '</text><text x="380" y="34" font-size="12" text-anchor="end">',
            l.wilted ? "WILTED" : (harvested ? "PICKED" : "GROWING"),
            '</text><text x="380" y="56" font-size="12" text-anchor="end">',
            uint256(growth).toString(),
            "/",
            uint256(lifespan).toString(),
            " work</text></g>"
        );
    }

    // ------------------------------------------------------------ helpers

    function palette(uint8 tier, uint8 i) internal pure returns (string memory, string memory, string memory) {
        uint256 off = ((uint256(tier) - 1) * 3 + i) * 18;
        return (hex6(off), hex6(off + 6), hex6(off + 12));
    }

    function hex6(uint256 off) internal pure returns (string memory) {
        bytes memory b = new bytes(7);
        b[0] = "#";
        for (uint256 i; i < 6; ++i) {
            b[i + 1] = PALETTES[off + i];
        }
        return string(b);
    }

    /// Tenths of a degree -> "12.5"
    function deg(uint256 tenths) internal pure returns (string memory) {
        return string.concat((tenths / 10).toString(), ".", (tenths % 10).toString());
    }
}
