// With `npm run chain` running: deploy a mock hamster (60-second rounds) + the full game to
// localhost and write web/local.json.
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";

const rpc = "http://127.0.0.1:8545";
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS ?? 60);
const art = (n) => JSON.parse(readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url)));
const pub = createPublicClient({ transport: http(rpc) });
const [account] = await pub.request({ method: "eth_accounts" });
const wallet = createWalletClient({ account, transport: http(rpc) });

async function deploy(name, args = []) {
  const { abi, bytecode } = art(name);
  const hash = await wallet.deployContract({ abi, bytecode, args, chain: null });
  const rc = await pub.waitForTransactionReceipt({ hash });
  return { address: rc.contractAddress, abi, block: rc.blockNumber };
}

// Keep chain time in step with the wall clock (earlier test runs may have pushed it ahead).
const latest = await pub.getBlock();
if (Number(latest.timestamp) < Date.now() / 1000) {
  await pub.request({ method: "evm_setNextBlockTimestamp", params: [Math.floor(Date.now() / 1000)] });
  await pub.request({ method: "evm_mine", params: [] });
}

const core = await deploy("MockSqueekCore", [11030n, BigInt(ROUND_SECONDS)]);
const petals = await deploy("BloomPetals");
const renderer = await deploy("BloomRenderer", [petals.address]);
const bloom = await deploy("Bloomwheel", [core.address, renderer.address]);
const raid = await deploy("BloomRaid", [core.address, bloom.address]);
// Local stand-in for the Squeek collection: Gardener 1 holds a Squeek, so the holder perk shows.
const nft = await deploy("MockSqueekNFT");
const guard = await deploy("BloomGuard", [bloom.address, nft.address, "0x0000000000000000000000000000000000000000"]);
const tx = async (c, functionName, args) =>
  pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ ...c, functionName, args, chain: null }) });
const pvp = await deploy("BloomPvP", [core.address, bloom.address]);
const view = await deploy("BloomRaidView", [raid.address]);
await tx(bloom, "setLinks", [raid.address, guard.address, pvp.address]);
await tx(nft, "mint", [account]);

const out = {
  chainId: await pub.getChainId(),
  rpc,
  rpcs: [rpc],
  bloomwheel: bloom.address,
  raid: raid.address,
  guard: guard.address,
  pvp: pvp.address,
  view: view.address,
  mockCore: core.address,
  deployBlock: String(bloom.block),
};
writeFileSync(new URL("../../web/local.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(`local garden (${ROUND_SECONDS}s rounds):`, out);
