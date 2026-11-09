// FORK_RPC=<sepolia archive rpc> node test/sepolia-fork.mjs
// Deploys the full v3 game on a local fork of live Sepolia, against the REAL SqueekCore,
// SqueekNFT and SqueekStaking, then plants, attacks, guards and reads the raid.
// (Hardhat's gas schedule, so this checks behaviour; test/deploy-gas-check.mjs checks the real gas.)
import assert from "node:assert/strict";
import { chain, deployGame, send, read } from "./helpers.mjs";

const CORE = "0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4";
const NFT = "0xc4c7982657f00509548f3a3a41db7fa439a6856b";
const STAKING = "0x50fd1780526c3186a0c037c7622203bc4fb611ca";
if (!process.env.FORK_RPC) throw new Error("set FORK_RPC");

const c = await chain();
assert.equal(await c.pub.getChainId(), 11155111);
const g = await deployGame(c, CORE, { nft: NFT, staking: STAKING });
const [me] = c.accounts;
const coreState = await c.pub.readContract({
  address: CORE,
  abi: [{ type: "function", name: "state", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [
    { name: "settledThroughRound", type: "uint64" }, { name: "cumulativeWork", type: "uint64" }, { name: "cumulativeBlockUnits", type: "uint96" },
    { name: "blockHeight", type: "uint64" }, { name: "blockProgress", type: "uint96" }, { name: "workPerThousandBlocks", type: "uint32" },
    { name: "authorizationNonce", type: "uint256" }, { name: "paused", type: "bool" } ] }] }],
  functionName: "state",
});

await send(c, g.bloom, "plant");
const [plants] = await read(c, g.bloom, "plantViews", [1n, 1n]);
assert.equal(plants[0].plantedWork, coreState.cumulativeWork);
console.log("planted on the real hamster at work", plants[0].plantedWork, "bitten", plants[0].bitten);

await send(c, g.raid, "attack", [[]]);
const r = await read(c, g.view, "raidState", [me]);
assert.equal(r.myPower, 10n);
assert.equal(r.targetRound, r.openRound + 1n);
assert.equal(r.weakSpecies, 3);
console.log("raid:", { open: r.openRound, target: r.targetRound, hp: r.hp, swipe: r.swipe, biteRate: r.biteRate, bites: r.bites });

// Holder perk against the real collection: whoever owns Squeek #1 gets 4 plots.
const owner1 = await c.pub.readContract({ address: NFT, abi: [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] }], functionName: "ownerOf", args: [1n] });
assert.equal(await read(c, g.guard, "isHolder", [owner1]), true);
assert.equal(await read(c, g.guard, "isHolder", [me]), false);
console.log("holder perk ok for", owner1);

// Replay real history: rewind nothing, but prove the raid walks real roundPage data end to end.
await send(c, g.raid, "advance", [2n]);
await send(c, g.guard, "station", [[]]);
console.log("sepolia fork check ok");
process.exit(0);
