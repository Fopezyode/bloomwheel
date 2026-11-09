// Wallet-free demo: runs the REAL Bloomwheel contracts on a private Ethereum node inside this
// browser tab (tevm), with a fast simulated hamster and a few bot gardeners. Nothing touches
// Sepolia, nothing needs a wallet. The game UI is the normal app.js.
import { createWalletClient, createPublicClient, custom, zeroAddress } from "https://cdn.jsdelivr.net/npm/viem@2.21.54/+esm";
import { createDemoNode } from "./vendor/tevm-memory.js";
import { CONTRACTS } from "./contract.js";
import { MOCKS } from "./demo-contracts.js";

const ROUND_SECONDS = 20; // demo rounds are 20 s instead of 10 min
const SPEED = 6; // the demo hamster runs ~6x faster than the local test hamster

const banner = document.querySelector("#banner");
banner.hidden = false;
banner.innerHTML = "⏳ Starting a private test chain in your browser and deploying the real Bloomwheel contracts…";

const node = createDemoNode().provider; // in-tab node + 10 pre-funded test accounts
// The in-tab node's gas estimate is the gas used AFTER storage refunds, which is too little to
// run calls that clear storage (e.g. resolveArena). Pad every estimate like a real node would.
const pad = (g) => (BigInt(g) * 13n) / 10n + 30_000n;
const provider = {
  async request({ method, params }) {
    if (method === "eth_estimateGas") return "0x" + pad(await node.request({ method, params })).toString(16);
    if (method === "eth_sendTransaction" && !params[0].gas) {
      const est = await node.request({ method: "eth_estimateGas", params: [params[0]] });
      params = [{ ...params[0], gas: "0x" + pad(est).toString(16) }];
    }
    return node.request({ method, params });
  },
};
const transport = custom(provider);
// The in-tab node only stamps time when a block is mined, and gas estimates run at the last
// block's time. Mine an empty block every 2 s so rounds open and close on the wall clock.
const heartbeat = () => provider.request({ method: "anvil_mine", params: ["0x1"] }).catch(() => {});
await heartbeat();
setInterval(heartbeat, 2000);
const pub = createPublicClient({ transport, pollingInterval: 50 });
const accts = await provider.request({ method: "eth_accounts" });
const wallet = (i) => createWalletClient({ account: accts[i], transport });
const wait = (hash) => pub.waitForTransactionReceipt({ hash, pollingInterval: 50 });
const deployer = wallet(0);
const deploy = async (c, args = []) => (await wait(await deployer.deployContract({ ...c, args, chain: null }))).contractAddress;
const send = async (who, c, functionName, args = []) => wait(await wallet(who).writeContract({ ...c, functionName, args, chain: null }));

const core = await deploy(MOCKS.MockSqueekCore, [11030n, BigInt(ROUND_SECONDS)]);
const petals = await deploy(CONTRACTS.BloomPetals);
const renderer = await deploy(CONTRACTS.BloomRenderer, [petals]);
const bloomwheel = await deploy(CONTRACTS.Bloomwheel, [core, renderer]);
const raid = await deploy(CONTRACTS.BloomRaid, [core, bloomwheel]);
const nft = await deploy(MOCKS.MockSqueekNFT);
const guard = await deploy(CONTRACTS.BloomGuard, [bloomwheel, nft, zeroAddress]);
const pvp = await deploy(CONTRACTS.BloomPvP, [core, bloomwheel]);
const view = await deploy(CONTRACTS.BloomRaidView, [raid]);
const G = { address: bloomwheel, abi: CONTRACTS.Bloomwheel.abi };
const R = { address: raid, abi: CONTRACTS.BloomRaid.abi };
const P = { address: pvp, abi: CONTRACTS.BloomPvP.abi };
const V = { address: view, abi: CONTRACTS.BloomRaidView.abi };
await send(0, G, "setLinks", [raid, guard, pvp]);
await send(0, { address: nft, abi: MOCKS.MockSqueekNFT.abi }, "mint", [accts[0]]); // you hold a Squeek

// ------------------------------------------------------------------ bots
const BOTS = [1, 2, 3]; // Gardeners 2-4 play on their own
const plants = async () => (await pub.readContract({ ...G, functionName: "plantViews", args: [1n, 300n] }))[0];
const owned = (all, i) => all.filter((p) => p.owner.toLowerCase() === accts[i].toLowerCase());
const tryIt = (p) => p.catch(() => null);

async function botTurn() {
  const all = await plants();
  const work = (await pub.readContract({ address: core, abi: MOCKS.MockSqueekCore.abi, functionName: "state" })).cumulativeWork;
  for (const i of BOTS) {
    const mine = owned(all, i);
    const growing = mine.filter((p) => !p.harvested);
    const flowers = mine.filter((p) => p.harvested && p.points > 0);
    // pick rare blooms, or anything about to wilt
    for (const p of growing) {
      const left = Number(p.lifespan) - Number(p.growth) - Number(p.bitten);
      if (p.look.wilted || (p.look.stage >= 3 && (p.look.tier >= 3 || left < 500 || Math.random() < 0.25))) await tryIt(send(i, G, "harvest", [p.id, work]));
    }
    if (growing.length < 3) await tryIt(send(i, G, "plant"));
    const rs = await pub.readContract({ ...V, functionName: "raidState", args: [accts[i]] });
    if (!rs.myArmy && flowers.length && Math.random() < 0.8) {
      const army = flowers.sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 3)).map((p) => p.id);
      await tryIt(send(i, R, "attack", [army]));
    }
    if (flowers.length > 1 && Math.random() < 0.3) await tryIt(send(i, P, "enterArena", [flowers[flowers.length - 1].id]));
    // now and then, rob the biggest rival plant
    const target = all.filter((p) => !p.harvested && !p.look.wilted && p.growth >= 400n && p.owner.toLowerCase() !== accts[i].toLowerCase()).sort((a, b) => Number(b.growth - a.growth))[0];
    const receiver = growing.find((p) => !p.look.wilted);
    if (target && receiver && flowers.length && Math.random() < 0.25) await tryIt(send(i, P, "heist", [target.id, receiver.id, [flowers[0].id]]));
  }
}

window.__bloomDemo = {
  cfg: { chainId: await pub.getChainId(), rpc: "demo", rpcs: [], bloomwheel, raid, guard, pvp, view, mockCore: core, deployBlock: "0" },
  provider,
  speed: SPEED,
  afterSettle: () => botTurn().catch((e) => console.warn("bot", e)),
  onReady: async ({ connect, S }) => {
    await connect();
    S.sim.awake = true;
    const wake = document.querySelector("#devWake");
    if (wake) wake.textContent = "Put him to sleep";
    banner.innerHTML = `🎮 <b>Demo</b>: a private chain in your browser running the real contracts, ${ROUND_SECONDS}-second rounds and a fast hamster. You're Gardener 1 (a Squeek holder); Gardeners 2–4 are bots. Plant, pick, arm an army, enter the arena, rob a bot. <a href="./">Play the real game on Sepolia</a>`;
    botTurn().catch(() => {});
  },
};
await import("./app.js");
