import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, custom, decodeErrorResult } from "viem";

export const artifact = (name) => JSON.parse(readFileSync(new URL(`../artifacts/${name}.json`, import.meta.url)));

export async function chain() {
  const hre = (await import("hardhat")).default;
  const transport = custom(hre.network.provider);
  const pub = createPublicClient({ transport });
  const accounts = await hre.network.provider.request({ method: "eth_accounts" });
  const wallet = (account) => createWalletClient({ account, transport });
  return { hre, pub, accounts, wallet };
}

export async function deploy(c, name, args = [], from = c.accounts[0]) {
  const { abi, bytecode } = artifact(name);
  const hash = await c.wallet(from).deployContract({ abi, bytecode, args, chain: null });
  const r = await c.pub.waitForTransactionReceipt({ hash });
  return { address: r.contractAddress, abi };
}

export async function send(c, contract, functionName, args = [], from = c.accounts[0]) {
  await c.pub.simulateContract({ ...contract, functionName, args, account: from }); // decodes custom errors
  const hash = await c.wallet(from).writeContract({ ...contract, functionName, args, chain: null });
  const r = await c.pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted`);
  return r;
}

export const read = (c, contract, functionName, args = []) => c.pub.readContract({ ...contract, functionName, args });

export function decodeTokenURI(uri) {
  const json = JSON.parse(Buffer.from(uri.replace("data:application/json;base64,", ""), "base64").toString("utf8"));
  const svg = Buffer.from(json.image.replace("data:image/svg+xml;base64,", ""), "base64").toString("utf8");
  return { json, svg };
}

/** Tiny well-formedness check: every opened tag is closed in order. */
export function assertWellFormedSvg(svg) {
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, , self] = m;
    if (self) continue;
    if (close) {
      const top = stack.pop();
      if (top !== tag) throw new Error(`mismatched </${tag}> (open: ${top})`);
    } else stack.push(tag);
  }
  if (stack.length) throw new Error("unclosed tags: " + stack.join(","));
  if (!svg.startsWith("<svg") || !svg.endsWith("</svg>")) throw new Error("not an svg");
}

/** Deploy the full game the way deploy.html does: 6 contracts + one link. */
export async function deployGame(c, coreAddress, { nft = "0x0000000000000000000000000000000000000000", staking = "0x0000000000000000000000000000000000000000" } = {}) {
  const petals = await deploy(c, "BloomPetals");
  const renderer = await deploy(c, "BloomRenderer", [petals.address]);
  const bloom = await deploy(c, "Bloomwheel", [coreAddress, renderer.address]);
  const raid = await deploy(c, "BloomRaid", [coreAddress, bloom.address]);
  const guard = await deploy(c, "BloomGuard", [bloom.address, nft, staking]);
  const pvp = await deploy(c, "BloomPvP", [coreAddress, bloom.address]);
  const view = await deploy(c, "BloomRaidView", [raid.address]);
  await send(c, bloom, "setLinks", [raid.address, guard.address, pvp.address]);
  return { bloom, raid, guard, pvp, renderer, view };
}

// ------------------------------------------------------------- test worlds
export const DUR = 600n;
const errAbi = () => ["Bloomwheel", "BloomRaid", "BloomGuard", "BloomPvP", "MockSqueekCore"].flatMap((n) => artifact(n).abi);

export async function expectRevert(promise, name) {
  await assert.rejects(promise, (e) => {
    let x = e;
    while (x && !(typeof x.data === "string" && x.data.startsWith("0x"))) x = x.cause;
    assert.ok(x, `no revert data (${e?.shortMessage})`);
    assert.equal(decodeErrorResult({ abi: errAbi(), data: x.data }).errorName, name);
    return true;
  });
}

/** Mock hamster + clock. `settle(round, work)` settles exactly that round (earlier ones as naps). */
export async function hamster(c, startWork = 11030n) {
  const core = await deploy(c, "MockSqueekCore", [startWork, DUR]);
  const genesis = await read(c, core, "genesis");
  const p = c.hre.network.provider;
  const now = async () => (await c.pub.getBlock()).timestamp;
  const settle = async (round, work) => {
    const t = genesis + round * DUR + 1n;
    if (t > (await now())) {
      await p.request({ method: "evm_setNextBlockTimestamp", params: [Number(t)] });
      await p.request({ method: "evm_mine", params: [] }); // so the pre-send simulation sees the new time
    }
    await send(c, core, "run", [BigInt(work)]);
  };
  const state = () => read(c, core, "state");
  const run = async (work) => settle((await state()).settledThroughRound + 1n, work);
  const work = async () => (await state()).cumulativeWork;
  return { core, genesis, settle, run, work, state };
}
