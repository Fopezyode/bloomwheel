import { createPublicClient, createWalletClient, custom, http, fallback, defineChain, zeroAddress } from "https://cdn.jsdelivr.net/npm/viem@2.21.54/+esm";
import { ABI, RAID_ABI, GUARD_ABI, PVP_ABI, RENDERER_ABI, VIEW_ABI } from "./contract.js";
import { CONFIG } from "./config.js";
import { describeError, ensureChain, addWorkingRpc } from "./wallet.js";
import { bossInfo, bossSvg } from "./boss.js";

// =================================================================== setup
const $ = (s) => document.querySelector(s);
const STAGES = ["Seed", "Sprout", "Seedling", "Bud", "Bloom", "Radiant"];
const STAGE_AT = [0, 30, 150, 400, 800, 1600];
const TIERS = ["", "Common", "Uncommon", "Rare", "Epic", "Legendary"];
const SPECIES = ["Daisy", "Poppy", "Star Lily", "Sunflower", "Lotus", "Wheelbloom"];
const ERRORS = {
  PlotsFull: "All 3 plots are growing. Pick one to free a plot.",
  GardenChanged: "Squeektoshi just re-rolled the garden. Take another look before you pick.",
  NotYourPlant: "That flower isn't yours.",
  AlreadyHarvested: "Already picked.",
  StillRooted: "Growing plants can't be moved.",
  AlreadyAttacking: "Your army is still waiting for Squeektoshi to run. One army at a time.",
  TooManyFighters: "At most 10 fighters per round.",
  NotAFighter: "Only picked flowers with points can fight.",
  AlreadyFighting: "That flower is already in an army that hasn't fought yet.",
  BossAlive: "That boss is still alive.",
  NoLoot: "No loot: your army needs at least one flower and 5% of the killing round's power.",
  LootTaken: "Loot already claimed.",
  Guarding: "That flower is guarding, on a heist or in the arena.",
  KnockedOut: "That flower is knocked out. It can fight again after it recovers.",
  Busy: "That flower is fighting or knocked out, so it can't guard right now.",
  Duplicate: "Pick each guard once.",
  BadTarget: "Pick a rival's growing plant of Bud size or bigger, and one of your own growing plants for the loot.",
  Cooldown: "That plant was raided recently. It's safe for 36 rounds.",
  TooManyRaiders: "Send 1 to 5 raiders.",
  NotYours: "That flower isn't yours.",
  BadState: "That's already been settled.",
  ArenaFull: "This round's arena is full (16). Try the next round.",
  NotYet: "Squeektoshi hasn't run since then. It resolves on his next working round.",
  TooManyGuards: "At most 3 guards.",
};
const ICON = ["🌼", "🌺", "✦", "🌻", "✿", "☸"];
const ROLE = [
  "Rally: counts double",
  "Crit: +10% crit chance",
  "Swift: dodges swipes",
  "Heavy: x1.5 power",
  "Guardian: double shield",
  "Legend: always x2, never knocked out",
];
/** Attack power in tenths, as BloomRaid computes it. */
const flowerPower = (p, weak) => {
  let x = p.points * 10;
  if (p.look.species === 3) x = Math.floor((x * 3) / 2);
  if (p.look.species === weak || p.look.species === 5) x *= 2;
  return x;
};
/** Knock-out risk % for a fighter this round. */
const koRisk = (p, swipe) => (p.look.species === 2 || p.look.species === 5 ? 0 : Math.max(0, swipe - p.look.tier * 5));

// The wallet-free demo (demo.html) injects an in-browser chain; ?local=1 uses a local Hardhat node.
const demo = window.__bloomDemo ?? null;
const local = !!demo || new URLSearchParams(location.search).has("local");
const cfg = { ...CONFIG };
if (demo) Object.assign(cfg, demo.cfg);
else if (local) Object.assign(cfg, await (await fetch("./local.json", { cache: "no-store" })).json());
const localTransport = () => (demo ? custom(demo.provider) : http(cfg.rpc));
// Just deployed from deploy.html in this browser but config.js not updated yet: use those addresses.
if (!local && !cfg.bloomwheel) {
  try {
    const live = JSON.parse(localStorage.getItem("bloomwheel-live") ?? "null");
    if (live?.bloomwheel) Object.assign(cfg, live);
  } catch {}
}

const chain = defineChain({
  id: cfg.chainId,
  name: local ? "Localhost" : "Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
  ...(local ? {} : { contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } } }),
});
const pub = createPublicClient({
  chain,
  pollingInterval: 1_000, // see receipts within a second of the block
  batch: local ? undefined : { multicall: { wait: 16 } }, // parallel reads become one call
  transport: local ? localTransport() : fallback((cfg.rpcs ?? [cfg.rpc]).map((u) => http(u, { timeout: 8000 })), { rank: false }),
});
const bloom = cfg.bloomwheel ? { address: cfg.bloomwheel, abi: ABI } : null;
const raidC = cfg.raid ? { address: cfg.raid, abi: RAID_ABI } : null;
const guardC = cfg.guard ? { address: cfg.guard, abi: GUARD_ABI } : null;
const pvpC = cfg.pvp ? { address: cfg.pvp, abi: PVP_ABI } : null;
const viewC = cfg.view ? { address: cfg.view, abi: VIEW_ABI } : null;
const rendererC = bloom ? { address: await pub.readContract({ ...bloom, functionName: "renderer" }), abi: RENDERER_ABI } : null;
const mockCore = local && cfg.mockCore
  ? { address: cfg.mockCore, abi: [{ type: "function", name: "run", stateMutability: "nonpayable", inputs: [{ name: "work", type: "uint64" }], outputs: [] }] }
  : null;

const S = {
  account: null, wallet: null,
  work: null, settled: null, plants: [], svg: new Map(),
  raid: null, events: { raid: [], harvests: [], guards: [], loot: [], pvp: [] }, evFrom: null, snapshot: null, bossData: new Map(), arenaDone: new Map(),
  live: { rpm: 0, work: null, fresh: false, last: null },
  sim: { awake: false, work: null, settling: false, genesis: null, duration: null },
  army: new Set(), guards: new Set(), busy: new Set(), shownBoss: null, dying: false,
  my: { ko: new Map(), armed: new Map(), pvp: new Map(), guards: new Set(), shield: 0, holder: false, plots: 3 },
  pick: { heist: null, duel: null, raiders: new Set(), flower: null }, seenPvp: null,
};

// ================================================================= helpers
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const fmt = (n) => Math.round(Number(n)).toLocaleString("en-US");
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const who = (a) => (same(a, S.account) ? "You" : short(a));
const title = (l) =>
  l.wilted ? `Wilted ${SPECIES[l.species]}` : l.stage < 3 ? `${SPECIES[l.species]} ${STAGES[l.stage]}` : `${TIERS[l.tier]} ${SPECIES[l.species]}`;
const imgSrc = (svg) => (svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : "");
const svgKey = (p, work = S.work) => (p.harvested ? `h${p.id}` : `${p.id}@${work}`);
const mult = (power10) => (100 + Number(power10)) / 100;
const multText = (power) => `×${mult(power).toFixed(mult(power) < 10 ? 1 : 0)}`;
const explain = (e) => describeError(e, ERRORS);
const incoming = () => (S.live.work !== null && S.work !== null && S.live.work > S.work ? Number(S.live.work - S.work) : 0);
const mine = (p) => same(p.owner, S.account);

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), kind === "gold" ? 10000 : 6500);
}

// =================================================================== chain
async function loadChain() {
  const raidP = pub.readContract({ ...viewC, functionName: "raidState", args: [S.account ?? zeroAddress] });
  const plants = [];
  let work, settled;
  for (let from = 1n; ; from += 200n) {
    const [page, w, r] = await pub.readContract({ ...bloom, functionName: "plantViews", args: [from, 200n] });
    plants.push(...page);
    work = w;
    settled = r;
    if (page.length < 200) break;
  }
  const [raid, my] = await Promise.all([raidP, loadMine(plants)]);
  return { plants, work, settled, raid, my };
}

/** My flowers' raid/guard state: knocked out, fighting, guarding; my shield and holder perk. */
async function loadMine(plants) {
  const my = { ko: new Map(), armed: new Map(), pvp: new Map(), guards: new Set(), shield: 0, holder: false, plots: 3 };
  if (!S.account) return my;
  const flowers = plants.filter((p) => same(p.owner, S.account) && p.harvested && p.points > 0);
  const calls = [
    ...flowers.map((p) => ({ ...raidC, functionName: "koUntil", args: [p.id] })),
    ...flowers.map((p) => ({ ...raidC, functionName: "isBusy", args: [p.id] })),
    ...(pvpC ? flowers.map((p) => ({ ...pvpC, functionName: "busyUntil", args: [p.id] })) : []),
    ...(guardC
      ? [
          { ...guardC, functionName: "guardsOf", args: [S.account] },
          { ...guardC, functionName: "shield", args: [S.account] },
          { ...guardC, functionName: "isHolder", args: [S.account] },
        ]
      : []),
  ];
  const res = local
    ? await Promise.all(calls.map((c) => pub.readContract(c).catch(() => null)))
    : (await pub.multicall({ contracts: calls, allowFailure: true })).map((r) => r.result ?? null);
  flowers.forEach((p, i) => {
    my.ko.set(p.id, res[i] ?? 0n);
    my.armed.set(p.id, !!res[flowers.length + i]);
    if (pvpC) my.pvp.set(p.id, res[flowers.length * 2 + i] ?? 0n);
  });
  if (guardC) {
    const [g, sh, h] = res.slice(flowers.length * (pvpC ? 3 : 2));
    my.guards = new Set(g ?? []);
    my.shield = Number(sh ?? 0n);
    my.holder = !!h;
    my.plots = my.holder ? 4 : 3;
  }
  return my;
}

/** Only fetch logs since the last look, in chunks public nodes accept. */
async function loadEvents() {
  const latest = await pub.getBlockNumber();
  let from = S.evFrom ?? BigInt(cfg.deployBlock || 0);
  if (from > latest) return;
  const add = { raid: [], harvests: [], guards: [], loot: [], pvp: [] };
  const STEP = 2000n;
  for (; from <= latest; from += STEP) {
    const toBlock = from + STEP - 1n > latest ? latest : from + STEP - 1n;
    const range = { fromBlock: from, toBlock };
    const [raid, harvests, guards, pvp] = await Promise.all([
      pub.getContractEvents({ ...raidC, ...range }),
      pub.getContractEvents({ ...bloom, eventName: "Harvested", ...range }),
      guardC ? pub.getContractEvents({ ...guardC, ...range }) : [],
      pvpC ? pub.getContractEvents({ ...pvpC, ...range }) : [],
    ]);
    add.raid.push(...raid);
    add.harvests.push(...harvests);
    add.guards.push(...guards.filter((e) => e.eventName === "Stationed"));
    add.loot.push(...guards.filter((e) => e.eventName === "LootClaimed"));
    add.pvp.push(...pvp);
  }
  for (const k of Object.keys(add)) S.events[k] = [...(S.events[k] ?? []), ...add[k]];
  S.evFrom = latest + 1n;
  await loadBossData();
  await loadArenaDone();
  announcePvp();
}

/** Kill details for slain bosses (who can claim loot), fetched once each. */
async function loadBossData() {
  const ids = S.events.raid.filter((e) => e.eventName === "BossSlain" && !S.bossData.has(e.args.bossId)).map((e) => e.args.bossId);
  const res = await Promise.all(ids.map((id) => pub.readContract({ ...raidC, functionName: "boss", args: [id] }).catch(() => null)));
  ids.forEach((id, i) => res[i] && S.bossData.set(id, res[i]));
}

async function loadArenaDone() {
  if (!pvpC) return;
  const rounds = [...new Set((S.events.pvp ?? []).filter((e) => e.eventName === "ArenaEntered").map((e) => e.args.round))].filter((r) => !S.arenaDone.get(r));
  const res = await Promise.all(rounds.map((r) => pub.readContract({ ...pvpC, functionName: "arenaDone", args: [r] }).catch(() => false)));
  rounds.forEach((r, i) => S.arenaDone.set(r, !!res[i]));
}

async function loadSvgs(extra = []) {
  const mineGrowing = S.plants.filter((p) => mine(p));
  const want = [...mineGrowing, ...gardenPlants(), ...extra].filter((p, i, a) => a.indexOf(p) === i && !S.svg.has(svgKey(p)));
  for (let i = 0; i < want.length; i += 8) {
    const chunk = want.slice(i, i + 8);
    const calls = chunk.map((p) => ({ ...rendererC, functionName: "svg", args: [p.id, p.look, p.growth, p.lifespan, p.harvested] }));
    const res = local
      ? await Promise.all(calls.map((c) => pub.readContract(c).catch(() => null)))
      : (await pub.multicall({ contracts: calls, allowFailure: true })).map((r) => r.result ?? null);
    chunk.forEach((p, j) => res[j] && S.svg.set(svgKey(p), res[j]));
  }
}

const gardenPlants = () => S.plants.filter((p) => !p.harvested).slice(-36).reverse();
const fighters = () => S.plants.filter((p) => mine(p) && p.harvested && p.points > 0).sort((a, b) => b.points - a.points);

async function refresh() {
  if (!bloom || !raidC || !viewC) return render();
  if (S.refreshing) return (S.refreshAgain = true);
  S.refreshing = true;
  try {
    const next = await loadChain();
    const prev = S.snapshot;
    S.plants = next.plants;
    S.work = next.work;
    S.settled = next.settled;
    S.raid = next.raid;
    S.my = next.my;
    if (S.sim.work === null || S.sim.work < next.work) S.sim.work = next.work;
    render(); // fast: numbers and buttons right away
    await Promise.all([loadEvents().catch((e) => console.warn("events", e)), loadSvgs()]);
    if (prev && (next.work > prev.work || next.raid.bossId > prev.raid.bossId)) showReveal(prev, next);
    S.snapshot = {
      work: next.work,
      settled: next.settled,
      raid: next.raid,
      looks: new Map(next.plants.map((p) => [p.id, p.look])),
      bitten: new Map(next.plants.map((p) => [p.id, p.bitten])),
      ko: new Map(next.my.ko),
    };
  } catch (e) {
    console.error(e);
  } finally {
    S.refreshing = false;
  }
  render();
  if (S.refreshAgain) {
    S.refreshAgain = false;
    refresh();
  }
}

// ==================================================================== raid
function allKills() {
  return S.events.raid
    .filter((e) => e.eventName === "BossSlain")
    .map((e) => ({ bossId: e.args.bossId, round: e.args.round, top: e.args.top }))
    .sort((a, b) => Number(a.bossId - b.bossId));
}

/** Slain bosses I can claim loot for: my army fought the kill with a flower and >= 5% of its power. */
function claimables() {
  if (!S.account) return [];
  const claimed = new Set(S.events.loot.filter((e) => mine({ owner: e.args.gardener })).map((e) => e.args.bossId));
  const myArmies = S.events.raid.filter((e) => e.eventName === "Attacked" && mine({ owner: e.args.gardener }) && e.args.flowers.length > 0);
  const out = [];
  for (const k of allKills()) {
    const b = S.bossData.get(k.bossId);
    if (!b || claimed.has(k.bossId)) continue;
    const army = myArmies.find((e) => e.args.round >= b.killFrom && e.args.round <= b.slainRound && e.args.power * 20n >= b.killPower);
    if (army) out.push({ ...k, armyRound: army.args.round });
  }
  return out;
}

/** The working round an army armed for round t fought in (first Struck at or after t with armies). */
const strikeFor = (t) =>
  S.events.raid.filter((e) => e.eventName === "Struck" && e.args.round >= t && e.args.power > 0n).sort((a, b) => Number(a.args.round - b.args.round))[0]?.args;

/** Damage each gardener's army added: its share of the army part of each strike it fought. */
function slayerTotals() {
  const t = new Map();
  for (const e of S.events.raid) {
    if (e.eventName !== "Attacked") continue;
    const st = strikeFor(e.args.round);
    if (!st) continue;
    const k = e.args.gardener.toLowerCase();
    t.set(k, (t.get(k) ?? 0) + (Number(st.damage) * Number(e.args.power)) / (100 + Number(st.power)));
  }
  return [...t].sort((a, b) => b[1] - a[1]).slice(0, 8);
}

// ==================================================================== live
async function pollLive() {
  if (local) {
    if (S.sim.awake && S.sim.work !== null) S.sim.work += BigInt(Math.round((3 + Math.random() * 5) * (demo?.speed ?? 1)));
    S.live = { ...S.live, rpm: S.sim.awake ? 58 + Math.random() * 18 : 0, work: S.sim.work, fresh: true };
    await maybeSettleLocal();
  } else {
    try {
      const m = (await (await fetch(`${cfg.api}/v1/status`, { cache: "no-store" })).json()).measurement ?? {};
      S.live = { ...S.live, rpm: (m.rpmMilli ?? 0) / 1000, work: m.cumulativeWorkUnits ? BigInt(m.cumulativeWorkUnits) : null, fresh: m.freshness === "online" };
    } catch {
      S.live.fresh = false;
    }
  }
  const lw = S.live.work;
  if (S.live.last !== null && lw !== null && lw > S.live.last) onLiveSteps(Number(lw - S.live.last));
  S.live.last = lw;
  renderPill();
  renderArena();
  renderPlotsLive();
}

/** Local only: when a mock round closes, settle the simulated wheel work into it. */
async function maybeSettleLocal() {
  if (!mockCore || S.sim.settling || S.settled === null || !raidC) return;
  if (S.sim.genesis === null) {
    S.sim.genesis = Number(await pub.readContract({ ...raidC, functionName: "genesis" }));
    S.sim.duration = Number(await pub.readContract({ ...raidC, functionName: "roundDuration" }));
  }
  const closed = Math.floor((Date.now() / 1000 - S.sim.genesis) / S.sim.duration);
  if (closed <= Number(S.settled)) return;
  S.sim.settling = true;
  try {
    const [, , , , , , , , , settler] = await pub.request({ method: "eth_accounts" });
    const w = createWalletClient({ chain, transport: localTransport() });
    const hash = await w.writeContract({ ...mockCore, functionName: "run", args: [S.sim.work - S.work], account: settler });
    await pub.waitForTransactionReceipt({ hash });
    demo?.afterSettle?.();
    await refresh();
    for (const x of pvpState().resolvable) {
      try {
        await pub.waitForTransactionReceipt({ hash: await w.writeContract({ ...pvpC, functionName: x.fn, args: [x.arg], account: settler }) });
      } catch {}
    }
    await refresh();
  } catch (e) {
    console.warn("local settle", e);
  } finally {
    S.sim.settling = false;
  }
}

function onLiveSteps(n) {
  const arena = $("#arena");
  const from = $(".wheel").getBoundingClientRect();
  const to = $("#boss").getBoundingClientRect();
  const base = arena.getBoundingClientRect();
  const per = S.raid ? mult(S.raid.armedPower) : 1;
  const shots = Math.min(n, 6);
  for (let i = 0; i < shots; i++) {
    setTimeout(() => {
      const x0 = from.left - base.left + from.width * 0.62;
      const y0 = from.top - base.top + from.height * 0.55;
      const x1 = to.left - base.left + to.width * (0.35 + Math.random() * 0.3);
      const y1 = to.top - base.top + to.height * (0.35 + Math.random() * 0.25);
      const shot = document.createElement("i");
      shot.className = "shot";
      shot.style.cssText = `left:${x0}px;top:${y0}px;--dx:${x1 - x0}px;--dy:${y1 - y0}px;--t:${0.55 + Math.random() * 0.25}s`;
      arena.append(shot);
      let landed = false;
      const land = () => {
        if (landed) return;
        landed = true;
        shot.remove();
        if (document.hidden) return; // no pile-ups while the tab is in the background
        const d = document.createElement("span");
        const hit = (n / shots) * per;
        d.className = `dmg ${per >= 3 ? "crit" : ""}`;
        d.textContent = `-${hit >= 10 ? Math.round(hit) : hit.toFixed(1)}`;
        d.style.cssText = `left:${x1 - 10}px;top:${y1 - 20}px`;
        arena.append(d);
        setTimeout(() => d.remove(), 1100);
        const b = $("#boss");
        if (!S.dying) {
          b.classList.remove("hit");
          void b.offsetWidth;
          b.classList.add("hit");
          clearTimeout(S.hitTimer);
          S.hitTimer = setTimeout(() => b.classList.remove("hit"), 400);
        }
      };
      shot.addEventListener("animationend", land);
      setTimeout(land, 1200); // animationend never fires in background tabs
    }, i * 140);
  }
  // the garden feels it too
  const cards = [...document.querySelectorAll(".alive .art-wrap")];
  for (let i = 0; i < Math.min(3, cards.length); i++) {
    const c = cards[Math.floor(Math.random() * cards.length)];
    const s = document.createElement("i");
    s.className = "sparkle";
    s.style.cssText = `left:${15 + Math.random() * 70}%;top:${20 + Math.random() * 50}%`;
    c.append(s);
    setTimeout(() => s.remove(), 900);
  }
}

// ================================================================== wallet
async function connect() {
  if (local) {
    const accts = await pub.request({ method: "eth_accounts" });
    const sel = $("#devAccount");
    sel.innerHTML = accts.slice(0, 5).map((a, i) => `<option value="${a}">Gardener ${i + 1} · ${short(a)}</option>`).join("");
    sel.hidden = false;
    sel.onchange = () => { S.account = sel.value; refresh(); };
    S.account = accts[0];
    S.wallet = createWalletClient({ chain, transport: localTransport() });
    $("#connect").hidden = true;
    $("#devTools").hidden = false;
    return refresh();
  }
  if (!window.ethereum) return toast("No browser wallet found. Install MetaMask or Rabby to play.", "warn");
  S.wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [a] = await S.wallet.requestAddresses();
  S.account = a;
  try { await ensureChain(S.wallet, chain); } catch (e) { toast(explain(e), "warn"); }
  window.ethereum.on?.("accountsChanged", (accts) => { S.account = accts[0] ?? null; refresh(); });
  $("#connect").textContent = short(a);
  refresh();
}

async function send(label, contract, functionName, args, key) {
  if (!S.account) return connect();
  S.busy.add(key);
  render();
  try {
    if (!local) await ensureChain(S.wallet, chain);
    const { request } = await pub.simulateContract({ ...contract, functionName, args, account: S.account });
    const hash = await S.wallet.writeContract(request);
    toast(`${label}… confirming${local ? "" : ` <a href="${cfg.explorer}/tx/${hash}" target="_blank" rel="noopener">view tx</a>`}`);
    const rc = await pub.waitForTransactionReceipt({ hash, pollingInterval: 1_000 });
    if (rc.status !== "success") throw new Error("Transaction reverted");
    return rc;
  } catch (e) {
    toast(explain(e), "warn");
  } finally {
    S.busy.delete(key);
    await refresh();
  }
}

const plant = () => send("Planting a seed", bloom, "plant", [], "plant").then((rc) => rc && toast("Seed planted. It grows only when Squeektoshi runs."));

async function harvest(id) {
  const p = S.plants.find((x) => x.id === id);
  const seen = title(p.look);
  const rc = await send(`Picking #${id}`, bloom, "harvest", [id, S.work], `h${id}`);
  if (rc) toast(p.points ? `Picked <b>${seen}</b>: a power ${p.points} fighter joins your army.` : `Cleared #${id}.`, p.look.tier >= 4 ? "gold" : "");
}

async function claim(bossId) {
  const k = claimables().find((x) => x.bossId === bossId);
  if (!k) return;
  const rc = await send("Claiming loot", guardC, "claimLoot", [bossId, k.armyRound], `loot${bossId}`);
  if (rc) toast(`Loot claimed! A special seed is in your plots. It is guaranteed to bloom ${same(k.top, S.account) ? "Epic" : "Rare"} or better.`, "gold");
}

// ============================================================= army sheet
/** Why a flower can't fight right now, or "" if it can. */
function unavailable(p) {
  const open = S.raid ? S.raid.openRound : 0n;
  if (S.my.guards.has(p.id)) return "guarding";
  const ko = S.my.ko.get(p.id) ?? 0n;
  if (ko >= open && ko > 0n) return `KO till r${ko}`;
  if (S.my.armed.get(p.id)) return "in your army";
  const busy = S.my.pvp.get(p.id) ?? 0n;
  if (busy >= open) return busy > (S.raid?.targetRound ?? 0n) ? `jailed till r${busy}` : "on a heist";
  return "";
}

async function openArmy() {
  if (!S.account) return connect();
  const f = fighters();
  const weak = S.raid.weakSpecies;
  for (const id of [...S.army]) if (!f.find((p) => p.id === id && !unavailable(p))) S.army.delete(id);
  if (!S.army.size) f.filter((p) => !unavailable(p)).slice(0, 10).forEach((p) => S.army.add(p.id));
  await loadSvgs(f);
  $("#sheetRound").textContent = "his next run";
  $("#armyGrid").innerHTML = f.length
    ? f
        .map((p) => {
          const why = unavailable(p);
          const risk = koRisk(p, S.raid.swipe);
          const isWeak = p.look.species === weak || p.look.species === 5;
          return `<button type="button" class="pick ${S.army.has(p.id) ? "on" : ""} ${isWeak ? "weak" : ""}" data-pick="${p.id}" ${why ? "disabled" : ""} title="#${p.id} ${title(p.look)} · ${ROLE[p.look.species]}">
            <img alt="" src="${imgSrc(S.svg.get(svgKey(p)))}"><span>${ICON[p.look.species]} +${fmt(flowerPower(p, weak) / 10)}</span>
            ${why ? `<em class="why">${why}</em>` : `<em class="risk">${risk ? `${risk}% KO` : "safe"}</em>`}</button>`;
        })
        .join("")
    : `<div class="empty-note">No fighters yet. You can still go in with <b>bare paws</b> and steal the last hit. Pick a Bud or better to grow your army.</div>`;
  const tips = [`${bossInfo(S.raid.bossId).name} is weak to <b>${ICON[weak]} ${SPECIES[weak]}</b> (x2, gold border).`];
  if (S.raid.enraged) tips.push(`<b style="color:var(--warn)">Enraged: swipes doubled to ${S.raid.swipe}%.</b>`);
  tips.push(`Rally: ${S.raid.armedHeads}/3 heads waiting so far.`);
  $("#sheetTips").innerHTML = tips.join(" ");
  updateArmyPower();
  $("#armySheet").showModal();
}

function armyPower10() {
  const weak = S.raid.weakSpecies;
  return 10 + (S.my.holder ? 50 : 0) + fighters().filter((p) => S.army.has(p.id)).reduce((s, p) => s + flowerPower(p, weak), 0);
}

function updateArmyPower() {
  const power = armyPower10();
  const total = Number(S.raid.armedPower) + power;
  const heads = Number(S.raid.armedHeads) + 1 + fighters().filter((p) => S.army.has(p.id) && p.look.species === 0).length;
  $("#armyPower").textContent = `Power ${fmt(power / 10)}${S.my.holder ? " (incl. holder +5)" : ""}`;
  $("#armyMult").textContent = `With the armies waiting, his next run would hit ${multText(total)}${heads >= 3 ? " · RALLY x1.5" : ""}`;
  $("#armyGo").textContent = S.army.size ? `Send ${S.army.size} fighter${S.army.size > 1 ? "s" : ""}` : "Go in with bare paws";
}

// ============================================================= guard sheet
async function openGuards() {
  if (!S.account) return connect();
  const f = fighters();
  S.guards = new Set([...S.my.guards]);
  await loadSvgs(f);
  $("#guardGrid").innerHTML = f.length
    ? f
        .map((p) => {
          const why = S.my.guards.has(p.id) ? "" : unavailable(p);
          const val = Math.min(90, p.look.species === 4 ? p.points * 2 : p.points);
          return `<button type="button" class="pick ${S.guards.has(p.id) ? "on" : ""}" data-gpick="${p.id}" ${why ? "disabled" : ""} title="#${p.id} ${title(p.look)}">
            <img alt="" src="${imgSrc(S.svg.get(svgKey(p)))}"><span>🛡 ${val}%</span>${why ? `<em class="why">${why}</em>` : ""}</button>`;
        })
        .join("")
    : `<div class="empty-note">Pick a flower first. Any picked flower can guard.</div>`;
  updateGuardShield();
  $("#guardSheet").showModal();
}

function updateGuardShield() {
  const s = fighters().filter((p) => S.guards.has(p.id)).reduce((t, p) => t + (p.look.species === 4 ? p.points * 2 : p.points), 0);
  $("#guardShield").textContent = `Shield ${Math.min(90, s)}%`;
  $("#guardGo").textContent = S.guards.size ? `Station ${S.guards.size} guard${S.guards.size > 1 ? "s" : ""}` : "Bring everyone home";
}

async function sendGuards() {
  $("#guardSheet").close();
  const ids = fighters().filter((p) => S.guards.has(p.id)).map((p) => p.id).slice(0, 3);
  const rc = await send(ids.length ? "Stationing guards" : "Bringing guards home", guardC, "station", [ids], "guard");
  if (rc) toast(ids.length ? `Guards posted. Your growing plants now take ${100 - S.my.shield}% of the boss's bites.` : "Guards are home and free to fight.");
}

async function sendArmy() {
  $("#armySheet").close();
  const ids = fighters().filter((p) => S.army.has(p.id)).map((p) => p.id).slice(0, 10);
  const rc = await send("Arming your army", raidC, "attack", [ids], "attack");
  if (rc) toast("Your army stands ready. It fights the next round Squeektoshi runs, however long he sleeps.", "gold");
}

// ================================================================== reveal
function showReveal(prev, next) {
  const workDelta = Number(next.work - prev.work);
  const killed = Number(next.raid.bossId - prev.raid.bossId);
  let dealt = Number(next.raid.damage) - Number(prev.raid.damage);
  if (killed > 0) {
    dealt = Number(prev.raid.hp - prev.raid.damage) + Number(next.raid.damage);
    for (let k = 1, hp = Number(prev.raid.hp); k < killed; k++) dealt += hp = Math.floor((hp * 5) / 4);
  }
  const kills = allKills().filter((k) => k.bossId >= prev.raid.bossId && k.bossId < next.raid.bossId);
  const iFought = prev.raid.myArmy > 0n && next.raid.myArmy === 0n;
  const iKilled = killed > 0 && iFought;
  const rolls = next.plants.filter((p) => mine(p) && !p.harvested && p.look.stage >= 3).map((p) => ({ p, before: prev.looks.get(p.id) }));
  const strikes = S.events.raid.filter((e) => e.eventName === "Struck" && e.args.round > prev.settled).map((e) => e.args);
  const knocked = next.plants.filter((p) => mine(p) && (next.my.ko.get(p.id) ?? 0n) > 0n && !(prev.ko.get(p.id) > 0n));
  const eaten = next.plants
    .filter((p) => mine(p) && !p.harvested)
    .reduce((t, p) => t + Number(p.bitten - (prev.bitten.get(p.id) ?? p.bitten)), 0);

  let d = 0;
  const line = (html, cls = "") => `<div class="line ${cls}" style="animation-delay:${(d += 0.35)}s">${html}</div>`;
  let html = line(`<span class="muted small">Round ${next.settled} settled on-chain</span>`);
  if (workDelta > 0) html += line(`<h3>Squeektoshi ran</h3><div class="big">+${fmt(workDelta)} work</div>`);
  if (dealt > 0) html += line(`The raid dealt <b>${fmt(dealt)}</b> damage to ${bossInfo(prev.raid.bossId).name}.`);
  const flags = [];
  if (strikes.some((x) => x.crit)) flags.push("💥 CRIT x2");
  if (strikes.some((x) => x.rally)) flags.push("🤝 RALLY x1.5");
  const bestCombo = Math.max(0, ...strikes.map((x) => Number(x.combo)));
  if (bestCombo > 1) flags.push(`🔥 COMBO +${Math.min(5, bestCombo - 1) * 10}%`);
  if (flags.length) html += line(`<b style="color:#ffdf7a">${flags.join(" · ")}</b>`);
  if (next.raid.enraged && !prev.raid.enraged && next.raid.bossId === prev.raid.bossId) html += line(`<b class="ko">😡 ${bossInfo(next.raid.bossId).name} is ENRAGED: bites and swipes double!</b>`);
  for (const p of knocked) html += line(`<span class="ko">💢 The boss swiped back: your #${p.id} ${title(p.look)} is knocked out until round ${next.my.ko.get(p.id)}.</span>`);
  if (eaten > 0) html += line(`<span class="ko">🐛 While he slept, the boss ate <b>${fmt(eaten)}</b> lifespan from your growing plants.</span>`);
  for (const k of kills) {
    html += line(`<h3>☠ ${bossInfo(k.bossId).name} is slain!</h3><div class="small">Round ${k.round} · Champion: ${k.top === zeroAddress ? "the hamster alone" : who(k.top)}</div>`);
  }
  if (iFought && !killed) html += line(`<b>⚔ Your army fought this run.</b>`);
  if (iKilled) html += line(`<b style="color:#ffdf7a">Your army fought in the killing round! If it brought a flower and 5% of the power, claim your loot.</b>`);
  if (killed > 0 && !kills.length) html += line(`<span class="muted">Anyone's next move records the kill on-chain, or tap "Record the kill" to unlock loot now.</span>`);
  if (killed > 0) html += line(`<span class="muted">${bossInfo(next.raid.bossId).name} crawls out of the soil (${fmt(next.raid.hp)} HP)…</span>`);
  if (rolls.length) {
    html += line(`<b>Your blooms re-rolled</b>`);
    html += `<div class="rolls">${rolls
      .map(({ p, before }) => {
        const up = before && p.look.tier > before.tier;
        const down = before && p.look.tier < before.tier;
        return line(`<div class="roll"><img alt="" src="${imgSrc(S.svg.get(svgKey(p, next.work)))}"><span>#${p.id} ${title(p.look)}</span><span class="arrow ${up ? "up" : down ? "down" : ""}">${before && before.stage >= 3 ? `${TIERS[before.tier]} → ${TIERS[p.look.tier]}` : "new bloom"}</span></div>`);
      })
      .join("")}</div>`;
  }
  $("#revealBody").innerHTML = html;
  if ($("#armySheet").open) return toast(`Round ${next.settled} settled: +${fmt(workDelta)} work, ${fmt(dealt)} damage.`);
  if (!$("#reveal").open) $("#reveal").showModal();
  if (killed > 0) killBoss();
  if (iKilled || rolls.some(({ p }) => p.look.tier >= 4)) confetti();
}

function killBoss() {
  const b = $("#boss");
  S.dying = true;
  b.classList.add("dead");
  setTimeout(() => {
    S.dying = false;
    S.shownBoss = null;
    b.classList.remove("dead");
    renderArena();
  }, 1700);
}

function confetti() {
  const box = $("#confetti");
  const colors = ["#f2b33d", "#e0463c", "#4f8a3e", "#8e3fb0", "#2f7dbf", "#fff3c4"];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement("i");
    c.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};--t:${2 + Math.random() * 2}s;animation-delay:${Math.random() * 0.6}s`;
    box.append(c);
    setTimeout(() => c.remove(), 4800);
  }
}

// ================================================================== render
function renderPill() {
  const running = S.live.rpm > 0;
  $("#pill").classList.toggle("running", running);
  $("#pillText").textContent = !S.live.fresh
    ? "Hamster telemetry offline"
    : running
      ? `${local ? "Local hamster" : "Squeektoshi"} is running · ${S.live.rpm.toFixed(0)} rpm`
      : `${local ? "Local hamster" : "Squeektoshi"} is asleep`;
  $("#rpmText").textContent = running ? `${S.live.rpm.toFixed(0)} rpm` : "asleep";
  $("#hamster").classList.toggle("running", running);
  $("#hamster").classList.toggle("sleeping", !running);
}

function renderArena() {
  const r = S.raid ?? { bossId: 0n, hp: 2500n, damage: 0n, openRound: 0n, targetRound: 0n, roundEndsAt: 0n, armedPower: 0n, armedHeads: 0n, armedPoppies: 0n, myArmy: 0n, myPower: 0n };
  const b = bossInfo(r.bossId);
  if (S.shownBoss !== r.bossId && !S.dying) {
    $("#boss").innerHTML = bossSvg(r.bossId);
    S.shownBoss = r.bossId;
  }
  $("#bossName").textContent = b.name;
  $("#bossTitle").textContent = b.title;
  const running = S.live.rpm > 0;
  const weak = r.weakSpecies ?? 3;
  $("#bossTags").innerHTML = [
    `<span class="tag weak">Weak to ${ICON[weak]} ${SPECIES[weak]} x2</span>`,
    r.enraged ? `<span class="tag rage">ENRAGED</span>` : "",
    `<span class="tag">Swipe ${r.swipe ?? 10}%</span>`,
    S.my.holder ? `<span class="tag holder">🐹 Squeek holder</span>` : "",
  ].join("");
  $("#arena").classList.toggle("enraged", !!r.enraged);
  $("#boss").classList.toggle("feast", !running && !S.dying);

  const hp = Number(r.hp);
  const left = hp - Number(r.damage);
  const proj = Math.min(left, incoming() * mult(r.armedPower));
  $("#hpFill").style.width = `${((left - proj) / hp) * 100}%`;
  $("#hpGhost").style.left = `${((left - proj) / hp) * 100}%`;
  $("#hpGhost").style.width = `${(proj / hp) * 100}%`;
  $("#hpLabel").textContent = `BOSS #${r.bossId + 1n} HP`;
  $("#hpNumbers").textContent = `${fmt(left)} / ${fmt(hp)}`;
  const toKill = Math.ceil((left - proj) / mult(Number(r.armedPower) || 0));
  const unguarded = S.account ? 100 - S.my.shield : 100;
  $("#hpFoot").innerHTML = running
    ? `<b>≈ ${fmt(proj)}</b> damage incoming at ${multText(r.armedPower)}${Number(r.combo) > 1 ? ` · 🔥 combo ${r.combo}` : ""} · lands when round ${r.openRound} settles`
    : `🐛 ${b.name} is feasting: <b>-${fmt(r.biteRate ?? 4)}</b> lifespan per sleeping round to growing plants${S.account ? ` (yours take ${unguarded}%)` : ""}. About <b>${fmt(toKill)}</b> more work${Number(r.armedPower) ? ` at the waiting armies' ${multText(r.armedPower)}` : ""} kills it.`;

  $("#openRound").textContent = r.openRound || "—";
  $("#targetRound").textContent = r.targetRound || "—";
  $("#openArmy").textContent = Number(r.armedPower) ? `Armies waiting for him: ${multText(r.armedPower)}` : "No armies yet: he fights alone (×1)";
  $("#nextArmy").textContent = Number(r.armedPower) ? multText(r.armedPower) : "×1";
  const my = $("#myArmy");
  my.textContent = Number(r.myArmy) ? `Your army (power ${fmt(Number(r.myPower) / 10)}) is waiting` : "You have no army waiting";
  my.classList.toggle("in", Number(r.myArmy) > 0);
  const heads = Number(r.armedHeads ?? 0);
  const crit = Math.min(50, Number(r.armedPoppies ?? 0) * 10);
  $("#nextInfo").textContent = `Rally ${Math.min(heads, 3)}/3${heads >= 3 ? " ✓ x1.5" : ""} · crit ${crit}%`;

  const btn = $("#attackBtn");
  btn.classList.remove("glow");
  if (!bloom) { btn.textContent = "Not deployed yet"; btn.disabled = true; }
  else if (!S.account) { btn.textContent = "Connect to join the raid"; btn.disabled = false; }
  else if (S.busy.has("attack")) { btn.textContent = "Marching…"; btn.disabled = true; }
  else if (Number(r.myArmy)) { btn.textContent = "Army waiting for his run"; btn.disabled = true; }
  else { btn.textContent = "Arm an army"; btn.disabled = false; btn.classList.add("glow"); }
}

function tick() {
  if (!S.raid) return;
  const left = Math.max(0, Number(S.raid.roundEndsAt) - Math.floor(Date.now() / 1000));
  $("#countdown").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  if (left === 0 && !S.ticking) {
    S.ticking = true;
    setTimeout(() => { S.ticking = false; refresh(); }, 1500);
  }
}

function meter(p, live) {
  const life = Number(p.lifespan);
  const eaten = Math.min(Number(p.bitten ?? 0n), life);
  const g = Math.min(Number(p.growth), life - eaten);
  const extra = Math.min(live, life - g);
  const ticks = STAGE_AT.slice(1).filter((t) => t < life).map((t) => `<s style="left:${(t / life) * 100}%"></s>`).join("");
  return `<div class="meter">
    <div class="bar"><i class="${(g + eaten) / life > 0.8 ? "late" : ""}" style="width:${(g / life) * 100}%"></i><em style="left:${(g / life) * 100}%;width:${(Math.min(extra, life - eaten - g) / life) * 100}%"></em>${ticks}<b class="bite" style="width:${(eaten / life) * 100}%"></b></div>
    <small><span>${fmt(p.growth)} work${eaten ? ` · ${fmt(eaten)} eaten` : ""}</span><span>wilts at ${fmt(life - eaten)}</span></small></div>`;
}

function hint(p) {
  if (p.look.wilted) return "It wilted. Pick it to clear the plot.";
  const g = Number(p.growth);
  const life = Number(p.lifespan) - Number(p.bitten ?? 0n);
  const next = STAGE_AT.findIndex((t) => t > g);
  const parts = [];
  if (next > 0 && STAGE_AT[next] < life) parts.push(`${STAGES[next]} in ${fmt(STAGE_AT[next] - g)}`);
  parts.push(p.look.stage >= 3 ? `fighter power ${p.points} if picked now` : "becomes a fighter from Bud (400)");
  if (life - g < 600) parts.push(`<b class="t4">wilts in ${fmt(life - g)}</b>`);
  return parts.join(" · ");
}

function badge(p) {
  if (p.look.wilted) return `<span class="badge wilt">Wilted</span>`;
  if (p.look.stage < 3) return `<span class="badge t0">${STAGES[p.look.stage]}</span>`;
  return `<span class="badge t${p.look.tier}">${TIERS[p.look.tier]} · ${p.points}</span>`;
}

function renderPlots() {
  const grid = $("#plotGrid");
  if (!bloom) {
    grid.innerHTML = `<div class="empty-note">The game isn't deployed in this config yet. Open <a href="./deploy.html">deploy.html</a>.</div>`;
    return;
  }
  const live = incoming();
  const running = S.live.rpm > 0;
  const growing = S.plants.filter((p) => mine(p) && !p.harvested);
  const cards = growing.map((p) => {
    const busy = S.busy.has(`h${p.id}`);
    const label = p.look.wilted ? "Clear wilted plant" : p.look.stage < 3 ? "Pick early (no power)" : `Pick: ${title(p.look)}`;
    return `<article class="plot alive ${running ? "windy" : ""}" data-plot="${p.id}">
      <div class="art-wrap"><img class="art" alt="#${p.id} ${title(p.look)}" src="${imgSrc(S.svg.get(svgKey(p)))}">
        <span class="live-tag" ${live && !p.look.wilted ? "" : "hidden"}>+${fmt(live)} growing live</span>
        ${p.bitten > 0n && !p.look.wilted ? `<span class="eaten-tag">🐛 -${fmt(p.bitten)}</span>` : ""}
        ${p.floor ? `<span class="floor-tag">${p.floor >= 4 ? "Champion seed · Epic+" : "Boss seed · Rare+"}</span>` : ""}</div>
      <div class="plot-body">
        <div class="plot-title"><b>#${p.id} ${title(p.look)}</b>${badge(p)}</div>
        ${meter(p, p.look.wilted ? 0 : live)}
        <p class="hint">${hint(p)}</p>
        <div class="actions"><button class="btn ${p.look.tier >= 3 && !p.look.wilted ? "sun" : "ghost"}" data-harvest="${p.id}" ${busy ? "disabled" : ""}>${busy ? "Picking…" : label}</button></div>
      </div></article>`;
  });
  const busy = S.busy.has("plant");
  for (let i = growing.length; i < (S.my.plots ?? 3); i++) {
    cards.push(`<article class="plot empty"><div class="soil"></div>
      ${S.account
        ? `<button class="btn" data-plant ${busy ? "disabled" : ""}>${busy ? "Planting…" : "Plant a seed"}</button><span class="muted small">Free · gas only</span>`
        : `<button class="btn" data-connect>Connect to plant</button><span class="muted small">Sepolia testnet</span>`}
    </article>`);
  }
  grid.innerHTML = cards.join("");
  const f = fighters();
  $("#myScore").textContent = S.account
    ? `${S.my.plots} plots${S.my.holder ? " (Squeek holder)" : ""} · ${f.length} flower${f.length === 1 ? "" : "s"} · shield ${S.my.shield}%`
    : "Plant seeds, grow fighters.";
  $("#shieldText").textContent = `Garden shield ${S.my.shield}%`;
}

/** Cheap live update between full renders: growth stripes and wind. */
function renderPlotsLive() {
  const live = incoming();
  const running = S.live.rpm > 0;
  document.querySelectorAll("[data-plot]").forEach((el) => {
    el.classList.toggle("windy", running);
    const p = S.plants.find((x) => String(x.id) === el.dataset.plot);
    if (!p || p.look.wilted) return;
    const tag = el.querySelector(".live-tag");
    tag.hidden = !live;
    tag.textContent = `+${fmt(live)} growing live`;
    const life = Number(p.lifespan);
    const g = Math.min(Number(p.growth), life);
    const em = el.querySelector(".bar em");
    if (em) em.style.width = `${(Math.min(live, life - g) / life) * 100}%`;
  });
  document.querySelectorAll("#gardenGrid .card").forEach((c) => c.classList.toggle("windy", running));
}

function card(p, { power = false } = {}) {
  let state = "";
  if (power) {
    const why = unavailable(p);
    state = why === "guarding" ? `<span class="state guard">🛡 guarding</span>` : why.startsWith("KO") ? `<span class="state ko">💢 ${why}</span>` : why ? `<span class="state fight">⚔ ${why}</span>` : `<span class="state">ready</span>`;
  }
  const ko = power && unavailable(p).startsWith("KO");
  return `<figure class="card alive ${mine(p) ? "mine" : ""} ${ko ? "ko" : ""}">
    <div class="art-wrap"><img class="art" loading="lazy" alt="#${p.id} ${title(p.look)}" src="${imgSrc(S.svg.get(svgKey(p)))}"></div>
    ${power ? `<span class="pw">${ICON[p.look.species]} ${p.points}</span>${state}` : ""}
    <figcaption><span>${mine(p) ? "yours" : short(p.owner)}</span><span class="t${p.look.wilted ? 0 : p.look.tier}">${p.look.stage >= 3 && !p.look.wilted ? TIERS[p.look.tier] : p.look.wilted ? "Wilted" : STAGES[p.look.stage]}</span></figcaption>
  ${power ? `<div class="role">${ROLE[p.look.species]}</div>` : ""}
  ${!power && robbable(p) ? `<button class="btn sun rob" data-rob="${p.id}">🦝 Rob</button>` : ""}
  </figure>`;
}

function renderLists() {
  const f = fighters();
  loadSvgs(f).then(() => {
    $("#fighterGrid").innerHTML = f.length ? f.map((p) => card(p, { power: true })).join("") : `<div class="empty-note">Pick a plant at Bud or later. It can then attack or guard.</div>`;
  });
  const g = gardenPlants();
  $("#gardenGrid").innerHTML = g.length ? g.map((p) => card(p)).join("") : `<div class="empty-note">No seeds in the ground yet. Be the first gardener.</div>`;

  // battle log
  const items = [
    ...S.events.raid.map((e) => ({ e, k: e.eventName })),
    ...S.events.loot.map((e) => ({ e, k: "LootClaimed" })),
    ...(S.events.guards ?? []).map((e) => ({ e, k: "Stationed" })),
    ...(S.events.pvp ?? []).filter((e) => ["HeistResolved", "DuelResolved", "ArenaEntered"].includes(e.eventName)).map((e) => ({ e, k: e.eventName })),
    ...S.events.harvests.filter((e) => e.args.tier >= 3 && !e.args.wilted).map((e) => ({ e, k: "Harvested" })),
  ].sort((a, b) => Number(b.e.blockNumber - a.e.blockNumber) || b.e.logIndex - a.e.logIndex);
  const lines = items.slice(0, 30).map(({ e, k }) => {
    const a = e.args;
    if (k === "Struck") {
      const fl = `${a.crit ? `<span class="flag crit">CRIT</span>` : ""}${a.rally ? `<span class="flag rally">RALLY</span>` : ""}${a.combo > 1 ? `<span class="flag combo">COMBO ${a.combo}</span>` : ""}`;
      return `<li><span class="ic">⚔</span><span>Round ${a.round}: Squeektoshi ran <b>${fmt(a.work)}</b> work${a.power > 0n ? ` with armies ${multText(a.power)}` : ""} → <b>${fmt(a.damage)}</b> damage to ${bossInfo(a.bossId).name}${fl}</span><span class="when">r${a.round}</span></li>`;
    }
    if (k === "BossSlain") return `<li class="kill"><span class="ic">☠</span><span><b>${bossInfo(a.bossId).name} fell!</b> Champion: ${a.top === zeroAddress ? "the hamster alone" : who(a.top)}</span><span class="when">r${a.round}</span></li>`;
    if (k === "BossSpawned") return a.bossId > 0n ? `<li><span class="ic">🐛</span><span>${bossInfo(a.bossId).name} crawls out of the soil (${fmt(a.hp)} HP)</span><span class="when"></span></li>` : "";
    if (k === "Attacked") return `<li><span class="ic">🌸</span><span>${who(a.gardener)} armed ${a.flowers.length ? `${a.flowers.length} fighter${a.flowers.length > 1 ? "s" : ""}` : "bare paws"} (power ${fmt(Number(a.power) / 10)})</span><span class="when">r${a.round}</span></li>`;
    if (k === "Stationed") return `<li><span class="ic">🛡</span><span>${who(a.gardener)} ${a.flowers.length ? `posted ${a.flowers.length} guard${a.flowers.length > 1 ? "s" : ""} (shield ${a.shield}%)` : "brought their guards home"}</span><span class="when"></span></li>`;
    if (k === "HeistResolved") return `<li class="${a.success ? "kill" : ""}"><span class="ic">🦝</span><span>${heistLine(a.id)}</span><span class="when">r${a.round}</span></li>`;
    if (k === "DuelResolved") return `<li class="kill"><span class="ic">⚔</span><span>Arena: ${who(a.winner)} beat ${who(a.loser)} ${fmt(a.winScore)} to ${fmt(a.loseScore)} and took both flowers</span><span class="when">r${a.round}</span></li>`;
    if (k === "ArenaEntered") return `<li><span class="ic">🏟</span><span>${who(a.gardener)} entered a flower in the round ${a.round} arena</span><span class="when">r${a.round}</span></li>`;
    if (k === "LootClaimed") return `<li><span class="ic">🎁</span><span>${who(a.gardener)} claimed a ${a.floor >= 4 ? "Champion" : "Boss"} Seed from ${bossInfo(a.bossId).name}</span><span class="when"></span></li>`;
    if (k === "Harvested") return `<li><span class="ic">✿</span><span>${who(a.gardener)} picked a <b class="t${a.tier}">${TIERS[a.tier]} ${SPECIES[a.species]}</b></span><span class="when">#${a.id}</span></li>`;
    return "";
  });
  $("#log").innerHTML = lines.join("") || `<li class="muted"><span>No battles yet. The first boss is waiting.</span></li>`;

  const sl = slayerTotals();
  $("#slayers").innerHTML = sl.length ? sl.map(([a, d]) => `<li class="${same(a, S.account) ? "me" : ""}"><span>${who(a)}</span><b>${fmt(d)}</b></li>`).join("") : `<li class="muted"><span>No army has landed a hit yet</span></li>`;
  const pts = new Map();
  for (const e of S.events.harvests) pts.set(e.args.gardener.toLowerCase(), (pts.get(e.args.gardener.toLowerCase()) ?? 0) + Number(e.args.points));
  const gd = [...pts].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  $("#gardeners").innerHTML = gd.length ? gd.map(([a, v]) => `<li class="${same(a, S.account) ? "me" : ""}"><span>${who(a)}</span><b>${fmt(v)}</b></li>`).join("") : `<li class="muted"><span>No picks yet</span></li>`;
}

function renderLoot() {
  const c = claimables();
  const box = $("#loot");
  const pending = Number(S.raid?.pendingKills ?? 0n);
  box.hidden = !c.length && !pending;
  const rec = pending
    ? `<div><b>☠ A boss fell in a settled round!</b><br><span class="small">Record it on-chain so loot can be claimed (anyone can, it's cheap).</span></div><button class="btn sun glow" data-record ${S.busy.has("record") ? "disabled" : ""}>Record the kill</button>`
    : "";
  box.innerHTML = rec + c
    .map((k) => {
      const champ = same(k.top, S.account);
      return `<div><b>You helped slay ${bossInfo(k.bossId).name}!</b><br><span class="small">${champ ? "Biggest army in the kill round: a Champion Seed (blooms Epic or better)" : "You fought in the kill round: a Boss Seed (blooms Rare or better)"}</span></div>
        <button class="btn sun glow" data-claim="${k.bossId}" ${S.busy.has(`loot${k.bossId}`) ? "disabled" : ""}>Claim ${champ ? "Champion" : "Boss"} Seed</button>
        ${growingCount() >= S.my.plots ? `<span class="small">Your plots are full: pick a plant first.</span>` : ""}`;
    })
    .join('<hr style="width:100%;border:0;border-top:1px solid rgba(255,255,255,.2)">');
}

function render() {
  renderPill();
  renderArena();
  renderLoot();
  renderPlots();
  renderLists();
  renderPvp();
  tick();
}

// ===================================================================== pvp
const plantById = (id) => S.plants.find((p) => p.id === id);
const BEATS = { 0: 3, 1: 2, 2: 0, 3: 4, 4: 1 }; // species -> species it beats
const beats = (a, b) => a < 5 && b < 5 && BEATS[a] === b;
const raidPower10 = (p) => p.points * (p.look.species === 3 ? 15 : 10);

const growingCount = () => S.plants.filter((p) => mine(p) && !p.harvested).length;

/** Heists + arenas rebuilt from PvP events, plus what can be resolved right now. */
function pvpState() {
  const heists = new Map();
  const arenas = new Map(); // arena round -> entrants still in it
  for (const e of S.events.pvp ?? []) {
    const a = e.args;
    if (e.eventName === "HeistPlanned") heists.set(a.id, { id: a.id, thief: a.thief, victim: a.victim, target: a.target, round: a.round, chance: a.chance, loot: a.loot, state: "pending" });
    else if (e.eventName === "HeistResolved" && heists.has(a.id)) Object.assign(heists.get(a.id), { state: "done", success: a.success, loot: a.loot, at: a.round });
    else if (e.eventName === "ArenaEntered") {
      if (!arenas.has(a.round)) arenas.set(a.round, []);
      arenas.get(a.round).push({ owner: a.gardener, flower: a.flower });
    } else if (e.eventName === "ArenaLeft" && arenas.has(a.round)) arenas.set(a.round, arenas.get(a.round).filter((x) => x.flower !== a.flower));
  }
  const settled = S.settled ?? 0n;
  const openArenas = [...arenas.entries()].filter(([r, list]) => !S.arenaDone.get(r) && list.length).map(([round, list]) => ({ round, list }));
  const resolvable = [
    ...[...heists.values()].filter((h) => h.state === "pending" && settled >= h.round).map((h) => ({ fn: "resolveHeist", arg: h.id })),
    ...openArenas.filter((x) => settled >= x.round).map((x) => ({ fn: "resolveArena", arg: x.round })),
  ];
  const duels = (S.events.pvp ?? []).filter((e) => e.eventName === "DuelResolved").map((e) => e.args).reverse();
  return { heists: [...heists.values()].reverse(), openArenas, duels, resolvable };
}

function heistLine(id) {
  const h = pvpState().heists.find((x) => x.id === id);
  if (!h) return `Heist #${id}`;
  const t = `${same(h.victim, S.account) ? "your" : `${short(h.victim)}'s`} #${h.target}`;
  if (h.state === "pending") return `${who(h.thief)} ${same(h.thief, S.account) ? "are" : "is"} sneaking into ${t} (round ${h.round})`;
  return h.success
    ? `<b>${who(h.thief)} robbed ${fmt(h.loot)} growth</b> from ${t} (${h.chance}% chance)`
    : h.loot === 0n && h.state === "done" && h.success === false
      ? `${who(h.thief)} got caught raiding ${t}: raiders jailed (${h.chance}% chance)`
      : `${who(h.thief)} raided ${t}: nothing taken (${h.chance}% chance)`;
}

/** A rival's growing plant that is big enough and not on heist cooldown. */
function robbable(p) {
  if (!S.account || !pvpC || mine(p) || p.harvested || p.look.wilted || p.growth < 400n) return false;
  const last = pvpState().heists.filter((h) => h.target === p.id).map((h) => h.round);
  return !last.length || last[0] + 36n < (S.raid?.targetRound ?? 0n);
}

/** Toast my heist/duel outcomes the first time they show up. */
function announcePvp() {
  const keyOf = (e) => `${e.eventName}${e.args.id ?? `${e.args.winFlower}`}`;
  const ids = new Set((S.events.pvp ?? []).filter((e) => e.eventName.endsWith("Resolved")).map(keyOf));
  if (S.seenPvp && S.account) {
    for (const e of S.events.pvp) {
      const key = keyOf(e);
      if (!e.eventName.endsWith("Resolved") || S.seenPvp.has(key)) continue;
      const a = e.args;
      if (e.eventName === "DuelResolved") {
        if (same(a.winner, S.account)) {
          toast(`🏟 You won an arena duel ${fmt(a.winScore)} to ${fmt(a.loseScore)} and took both flowers!`, "gold");
          confetti();
        } else if (same(a.loser, S.account)) toast(`🏟 You lost an arena duel. Your flower now belongs to ${short(a.winner)}.`, "warn");
      } else {
        const h = pvpState().heists.find((x) => x.id === a.id);
        if (h && same(h.thief, S.account)) toast(a.success ? `🦝 Heist worked! You stole ${fmt(a.loot)} growth.` : "🚨 Caught! Your raiders are jailed for 36 rounds.", a.success ? "gold" : "warn");
        if (h && same(h.victim, S.account)) toast(a.success ? `🦝 ${short(h.thief)} robbed ${fmt(a.loot)} growth from your #${h.target}!` : `🛡 Your guards caught ${short(h.thief)}'s raiders!`, a.success ? "warn" : "gold");
      }
    }
  }
  S.seenPvp = ids;
}

function renderPvp() {
  if (!pvpC) {
    $("#heistList").innerHTML = `<li class="muted"><span>PvP isn't deployed in this config.</span></li>`;
    return;
  }
  const { heists, openArenas, duels } = pvpState();
  const settled = S.settled ?? 0n;
  const resolveBtn = (fn, arg, round) => (settled >= round ? `<button class="btn" data-resolve="${fn}:${arg}">Reveal</button>` : "");
  $("#heistList").innerHTML =
    heists
      .slice(0, 10)
      .map((h) => `<li class="${h.state === "done" && h.success ? "kill" : ""}"><span class="ic">🦝</span><span>${heistLine(h.id)}</span>${h.state === "pending" ? resolveBtn("resolveHeist", h.id, h.round) : ""}</li>`)
      .join("") || `<li class="muted"><span>No heists yet. Rivals' plants marked 🦝 in the garden are fair game.</span></li>`;

  const art = (id) => {
    const p = plantById(id);
    return p ? `<img alt="" title="${ICON[p.look.species]} ${title(p.look)} · ${p.points} pts" src="${imgSrc(S.svg.get(svgKey(p)))}">` : "";
  };
  const open = S.raid?.openRound ?? 0n;
  const rows = openArenas.map((x) => {
    const mineIn = x.list.filter((e) => same(e.owner, S.account));
    const status = settled >= x.round ? "ready to reveal" : open >= x.round ? "waiting for him to run" : `starts round ${x.round}`;
    const action = settled >= x.round
      ? resolveBtn("resolveArena", x.round, x.round)
      : open < x.round && mineIn.length
        ? `<button class="btn ghost" data-leave="${mineIn[0].flower}">Leave</button>`
        : "";
    return `<div class="duel"><div class="info"><b>Round ${x.round} arena</b> · ${x.list.length}/16 entrants · ${status}<br>${x.list.map((e) => art(e.flower)).join("")}</div>${action}</div>`;
  });
  const results = duels.slice(0, 6).map((d) => `<div class="duel ${same(d.winner, S.account) ? "won" : ""}">${art(d.winFlower)}<span class="vs">beat</span>${art(d.loseFlower)}
      <div class="info"><b>${who(d.winner)}</b> ${fmt(d.winScore)} to ${fmt(d.loseScore)} vs ${who(d.loser)}<br><span class="muted small">winner took both</span></div></div>`);
  $("#duelList").innerHTML = [...rows, ...results].join("") || `<div class="empty-note">The arena is empty. Enter a flower and see who you're drawn against.</div>`;
  const missing = [...openArenas.flatMap((x) => x.list.map((e) => e.flower)), ...duels.flatMap((d) => [d.winFlower, d.loseFlower])].map(plantById).filter((p) => p && !S.svg.has(svgKey(p)));
  if (missing.length && !S.loadingDuelArt) {
    S.loadingDuelArt = true;
    loadSvgs(missing).then(() => { S.loadingDuelArt = false; renderPvp(); });
  }
}

async function openHeist(target) {
  if (!S.account) return connect();
  const t = plantById(target);
  const receivers = S.plants.filter((p) => mine(p) && !p.harvested && !p.look.wilted);
  if (!receivers.length) return toast("Plant a seed first: the loot needs one of your growing plants to land in.", "warn");
  const f = fighters();
  S.pick.heist = target;
  S.pick.raiders = new Set(f.filter((p) => !unavailable(p)).slice(0, 5).map((p) => p.id));
  S.pick.victimShield = Number(await pub.readContract({ ...guardC, functionName: "shield", args: [t.owner] }));
  await loadSvgs([t, ...f]);
  $("#heistTitle").textContent = `Rob ${short(t.owner)}'s #${t.id}`;
  $("#heistTarget").innerHTML = `<div class="target-card"><img alt="" src="${imgSrc(S.svg.get(svgKey(t)))}"><div><b>${title(t.look)}</b><br><span class="small">${fmt(t.growth)} growth · loot ${fmt(Math.min(400, Number(t.growth) / 4))}</span><br><span class="small muted">Their guard shield: ${S.pick.victimShield}%</span></div></div>`;
  $("#heistReceiver").innerHTML = receivers.map((p) => `<option value="${p.id}">#${p.id} ${title(p.look)} (${fmt(p.growth)} growth)</option>`).join("");
  $("#heistGrid").innerHTML = f.length
    ? f
        .map((p) => {
          const why = unavailable(p);
          return `<button type="button" class="pick ${S.pick.raiders.has(p.id) ? "on" : ""}" data-hpick="${p.id}" ${why ? "disabled" : ""}><img alt="" src="${imgSrc(S.svg.get(svgKey(p)))}"><span>${ICON[p.look.species]} +${fmt(raidPower10(p) / 10)}</span>${why ? `<em class="why">${why}</em>` : ""}</button>`;
        })
        .join("")
    : `<div class="empty-note">You need picked flowers to raid with.</div>`;
  updateHeistChance();
  $("#heistSheet").showModal();
}

function updateHeistChance() {
  const power = fighters().filter((p) => S.pick.raiders.has(p.id)).reduce((s, p) => s + raidPower10(p), 0);
  const chance = power ? Math.floor((power * 100) / (power + S.pick.victimShield * 10 + 50)) : 0;
  $("#heistChance").textContent = `Chance ${chance}% · power ${fmt(power / 10)}`;
  $("#heistGo").disabled = !S.pick.raiders.size;
}

async function sendHeist() {
  $("#heistSheet").close();
  const raiders = fighters().filter((p) => S.pick.raiders.has(p.id)).map((p) => p.id);
  const receiver = BigInt($("#heistReceiver").value);
  const rc = await send("Sending raiders", pvpC, "heist", [S.pick.heist, receiver, raiders], "heist");
  if (rc) toast(`🦝 Raiders are in position. It's decided on the next round Squeektoshi runs (from round ${S.raid.targetRound}).`, "gold");
}

async function openDuel() {
  if (!S.account) return connect();
  const f = fighters();
  if (!f.length) return toast("Pick a flower first. The arena stakes one of your picked flowers.", "warn");
  S.pick.flower = null;
  await loadSvgs(f);
  const round = S.raid.targetRound;
  const entrants = pvpState().openArenas.find((x) => x.round === round)?.list.length ?? 0;
  $("#duelTitle").textContent = `Enter the round ${round} arena`;
  $("#duelTarget").innerHTML = `<p class="muted small">${entrants}/16 entered so far. When Squeektoshi next runs, everyone is shuffled with that round's data and paired at random. Winner takes both flowers; an odd one out gets theirs back. You can leave until round ${round} starts.</p>`;
  $("#duelGrid").innerHTML = f
    .map((p) => {
      const why = unavailable(p);
      return `<button type="button" class="pick" data-dpick="${p.id}" ${why ? "disabled" : ""}><img alt="" src="${imgSrc(S.svg.get(svgKey(p)))}"><span>${ICON[p.look.species]} ${p.points}</span>${why ? `<em class="why">${why}</em>` : ""}</button>`;
    })
    .join("");
  updateDuelInfo();
  $("#duelSheet").showModal();
}

function updateDuelInfo() {
  const p = S.pick.flower ? plantById(S.pick.flower) : null;
  $("#duelGo").disabled = !p;
  $("#duelInfo").textContent = p ? `Stake #${p.id} ${title(p.look)} (${p.points} pts)` : "Pick one flower";
}

async function sendDuel() {
  $("#duelSheet").close();
  const rc = await send("Entering the arena", pvpC, "enterArena", [S.pick.flower], "duel");
  if (rc) toast("🏟 You're in the arena. Opponents are drawn at random when Squeektoshi next runs.", "gold");
}

// =================================================================== wheel
const spokes = document.querySelector(".spokes");
for (let i = 0; i < 12; i++) {
  const a = (i * Math.PI) / 6;
  spokes.insertAdjacentHTML("beforeend", `<line x1="${120 + 12 * Math.cos(a)}" y1="${120 + 12 * Math.sin(a)}" x2="${120 + 84 * Math.cos(a)}" y2="${120 + 84 * Math.sin(a)}"/>`);
}
let angle = 0;
let last = performance.now();
function spin(t) {
  angle = (angle + ((t - last) / 1000) * S.live.rpm * 6) % 360;
  last = t;
  $("#wheelSpin").setAttribute("transform", `rotate(${-angle} 120 120)`);
  requestAnimationFrame(spin);
}
requestAnimationFrame(spin);

// ==================================================================== wire
document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.hasAttribute("data-fix-rpc")) return addWorkingRpc(cfg.rpcs).then(() => toast("Done. Try again.")).catch((x) => toast(explain(x), "warn"));
  if (t.id === "connect" || t.hasAttribute("data-connect")) return connect().catch((x) => toast(explain(x), "warn"));
  if (t.id === "attackBtn") return openArmy().catch((x) => toast(explain(x), "warn"));
  if (t.id === "guardBtn") return openGuards().catch((x) => toast(explain(x), "warn"));
  if (t.dataset.rob) return openHeist(BigInt(t.dataset.rob)).catch((x) => toast(explain(x), "warn"));
  if (t.id === "challengeBtn") return openDuel().catch((x) => toast(explain(x), "warn"));
  if (t.dataset.leave) return send("Leaving the arena", pvpC, "leaveArena", [BigInt(t.dataset.leave)], "duel");
  if (t.hasAttribute("data-record")) return send("Recording the kill", raidC, "advance", [4n], "record");
  if (t.dataset.resolve) {
    const [fn, id] = t.dataset.resolve.split(":");
    return send(fn === "resolveArena" ? "Running the arena" : "Revealing the heist", pvpC, fn, [BigInt(id)], `res${id}`);
  }
  if (t.dataset.hpick) {
    const id = BigInt(t.dataset.hpick);
    if (S.pick.raiders.has(id)) S.pick.raiders.delete(id);
    else if (S.pick.raiders.size < 5) S.pick.raiders.add(id);
    else toast("At most 5 raiders.");
    t.classList.toggle("on", S.pick.raiders.has(id));
    return updateHeistChance();
  }
  if (t.id === "heistGo") {
    e.preventDefault();
    return sendHeist();
  }
  if (t.dataset.dpick) {
    S.pick.flower = BigInt(t.dataset.dpick);
    document.querySelectorAll("[data-dpick]").forEach((b) => b.classList.toggle("on", b.dataset.dpick === t.dataset.dpick));
    return updateDuelInfo();
  }
  if (t.id === "duelGo") {
    e.preventDefault();
    return sendDuel();
  }
  if (t.id === "guardGo") {
    e.preventDefault();
    return sendGuards();
  }
  if (t.dataset.gpick) {
    const id = BigInt(t.dataset.gpick);
    if (S.guards.has(id)) S.guards.delete(id);
    else if (S.guards.size < 3) S.guards.add(id);
    else toast("At most 3 guards.");
    t.classList.toggle("on", S.guards.has(id));
    return updateGuardShield();
  }
  if (t.id === "armyGo") {
    e.preventDefault();
    return sendArmy();
  }
  if (t.hasAttribute("data-plant")) return plant();
  if (t.dataset.harvest) return harvest(BigInt(t.dataset.harvest));
  if (t.dataset.claim) return claim(BigInt(t.dataset.claim));
  if (t.dataset.pick) {
    const id = BigInt(t.dataset.pick);
    if (S.army.has(id)) S.army.delete(id);
    else if (S.army.size < 10) S.army.add(id);
    else toast("At most 10 fighters per round.");
    t.classList.toggle("on", S.army.has(id));
    return updateArmyPower();
  }
  if (t.id === "devWake") {
    S.sim.awake = !S.sim.awake;
    t.textContent = S.sim.awake ? "Put him to sleep" : "Wake him up";
    return;
  }
  if (t.id === "devSprint") {
    if (S.sim.work !== null) S.sim.work += 250n;
  }
});

if (!bloom) {
  const b = $("#banner");
  b.hidden = false;
  b.innerHTML = `The game isn't deployed in this config yet. Open <a href="./deploy.html">deploy.html</a> to deploy it from your wallet. The hamster above is live.`;
}
if (local && !demo) {
  const b = $("#banner");
  b.hidden = false;
  b.innerHTML = `Local test garden with <b>60-second rounds</b> and a simulated hamster. Connect, then use <b>Wake him up</b> under Your plots.`;
}
demo?.onReady?.({ connect, refresh, S });

render();
setInterval(tick, 1000);
await Promise.all([refresh(), pollLive()]);
setInterval(pollLive, local ? 1000 : 2000);
setInterval(refresh, local ? 4000 : 12000);
