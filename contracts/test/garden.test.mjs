// The real stack (garden + raid + guard) on a mock hamster.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { chain, deploy, deployGame, send, read, expectRevert, hamster, decodeTokenURI, assertWellFormedSvg } from "./helpers.mjs";

let c;
before(async () => (c = await chain()));

async function world(opts = {}) {
  const h = await hamster(c);
  const nft = opts.holder ? await deploy(c, "MockSqueekNFT") : null;
  const game = await deployGame(c, h.core.address, nft ? { nft: nft.address } : {});
  const pv = async (id) => (await read(c, game.bloom, "plantViews", [BigInt(id), 1n]))[0][0];
  const raidView = (who = c.accounts[0]) => read(c, game.view, "raidState", [who]);
  const total = () => read(c, game.bloom, "totalPlanted");
  return { ...h, ...game, nft, pv, raidView, total };
}

/** Plant, grow to a bloom, pick. Returns the picked flower. */
async function pick(w, who = c.accounts[0], grow = 900) {
  await send(c, w.bloom, "plant", [], who);
  const id = await w.total();
  await w.run(grow);
  await send(c, w.bloom, "harvest", [id, await w.work()], who);
  return w.pv(id);
}

// =================================================================== garden

test("plant, grow through every stage, re-roll only when he works", async () => {
  const w = await world();
  await send(c, w.bloom, "plant");
  const v0 = await w.pv(1);
  assert.equal(v0.plantedWork, 11030n);
  assert.ok(v0.lifespan >= 2000 && v0.lifespan <= 4000);
  for (const [work, stage] of [[29, 0], [1, 1], [120, 2], [250, 3], [400, 4], [800, 5]]) {
    await w.run(work);
    assert.equal((await w.pv(1)).look.stage, stage);
  }
  const a = await w.pv(1);
  await w.run(0);
  assert.deepEqual((await w.pv(1)).look, a.look); // nap: no re-roll
});

test("plots, stale harvests, rooted plants", async () => {
  const w = await world();
  for (let i = 0; i < 3; i++) await send(c, w.bloom, "plant");
  await expectRevert(send(c, w.bloom, "plant"), "PlotsFull");
  await expectRevert(send(c, w.bloom, "transferFrom", [c.accounts[0], c.accounts[1], 1n]), "StillRooted");
  await w.run(900);
  const seen = await w.work();
  await w.run(5);
  await expectRevert(send(c, w.bloom, "harvest", [1n, seen]), "GardenChanged");
  await expectRevert(send(c, w.bloom, "harvest", [1n, await w.work()], c.accounts[1]), "NotYourPlant");
  await send(c, w.bloom, "harvest", [1n, await w.work()]);
  await expectRevert(send(c, w.bloom, "harvest", [1n, await w.work()]), "AlreadyHarvested");
});

// ==================================================================== bites

test("the boss bites growing plants while the hamster sleeps, and they can wilt early", async () => {
  const w = await world();
  await send(c, w.bloom, "plant");
  const { lifespan } = await w.pv(1);
  await w.settle(101n, 0); // 101 sleeping rounds x 4 bites
  const v = await w.pv(1);
  assert.equal(v.bitten, 404n);
  assert.equal(v.look.wilted, false);
  // grow to just short of (lifespan - bites): still alive; one more step wilts it
  await w.run(Number(lifespan) - 404 - 1);
  assert.equal((await w.pv(1)).look.wilted, false);
  await w.run(1);
  assert.equal((await w.pv(1)).look.wilted, true);
});

test("guards shield bites (Lotus counts double), can't fight, can't be sold", async () => {
  const w = await world();
  const a = c.accounts[0];
  const f = await pick(w, a);
  assert.ok(f.points > 0, "picked a fighter");
  await send(c, w.guard, "station", [[f.id]]);
  const shield = await read(c, w.guard, "shield", [a]);
  assert.equal(shield, BigInt(Math.min(90, f.look.species === 4 ? f.points * 2 : f.points)));

  await send(c, w.bloom, "plant");
  const seed = await w.total();
  const now = (await w.state()).settledThroughRound;
  await w.settle(now + 101n, 0);
  const v = await w.pv(seed);
  assert.equal(v.bitten, (101n * 4n * (100n - shield)) / 100n); // 101 sleeping rounds (the zero-work settled one too)

  await expectRevert(send(c, w.raid, "attack", [[f.id]]), "Guarding");
  await expectRevert(send(c, w.bloom, "transferFrom", [a, c.accounts[1], f.id]), "Guarding");
  await send(c, w.guard, "station", [[]]); // bring it home
  await send(c, w.bloom, "transferFrom", [a, c.accounts[1], f.id]);
});

test("a flower that is fighting can't guard", async () => {
  const w = await world();
  const f = await pick(w);
  await send(c, w.raid, "attack", [[f.id]]);
  await expectRevert(send(c, w.guard, "station", [[f.id]]), "Busy");
});

// ==================================================================== perks

test("Squeek holders get a 4th plot and +5 bare-paw power", async () => {
  const w = await world({ holder: true });
  const [holder, other] = c.accounts;
  await send(c, w.nft, "mint", [holder]);
  for (let i = 0; i < 4; i++) await send(c, w.bloom, "plant", [], holder); // 4 plots
  for (let i = 0; i < 3; i++) await send(c, w.bloom, "plant", [], other);
  await expectRevert(send(c, w.bloom, "plant", [], other), "PlotsFull"); // 3 plots
  await send(c, w.raid, "attack", [[]], holder);
  await send(c, w.raid, "attack", [[]], other);
  assert.equal((await w.raidView(holder)).myPower, 60n);
  assert.equal((await w.raidView(other)).myPower, 10n);
});

// ===================================================================== loot

test("loot: only flower armies with >= 5% of the kill; the biggest gets a Champion seed; needs a free plot", async () => {
  const w = await world();
  const [a, b, d, e] = c.accounts;
  const big = await pick(w, a);
  const small = await pick(w, e);
  await send(c, w.raid, "advance", [1n]);
  const left = (await w.raidView()).hp - (await w.raidView()).damage;
  await w.run(Number(left) - 300); // leave ~300 HP
  await send(c, w.raid, "attack", [[big.id]], a);
  await send(c, w.raid, "attack", [[small.id]], e);
  await send(c, w.raid, "attack", [[]], b); // bare paws: fights, but can't loot
  const R = (await w.raidView(a)).myArmy;
  await w.settle(R, 400);
  await send(c, w.raid, "advance", [1n]);

  const slain = await read(c, w.raid, "boss", [0n]);
  assert.equal(slain.slainRound, R);
  assert.equal(slain.top.toLowerCase(), a.toLowerCase());
  const powerOf = (who) => read(c, w.raid, "attackPower", [R, who]);
  await expectRevert(send(c, w.guard, "claimLoot", [0n, R], b), "NoLoot"); // no flower
  await expectRevert(send(c, w.guard, "claimLoot", [0n, R], d), "NoLoot"); // didn't fight
  await expectRevert(send(c, w.guard, "claimLoot", [1n, R], a), "BossAlive");

  // a: full plots first -> PlotsFull; free one -> Champion seed
  for (let i = 0; i < 3; i++) await send(c, w.bloom, "plant", [], a);
  await expectRevert(send(c, w.guard, "claimLoot", [0n, R], a), "PlotsFull");
  const plots = (await read(c, w.bloom, "plantViews", [1n, 100n]))[0].filter((p) => p.owner.toLowerCase() === a.toLowerCase() && !p.harvested);
  await send(c, w.bloom, "harvest", [plots[0].id, await w.work()], a);
  await send(c, w.guard, "claimLoot", [0n, R], a);
  await expectRevert(send(c, w.guard, "claimLoot", [0n, R], a), "LootTaken");
  const champ = await w.total();
  assert.equal((await w.pv(champ)).floor, 4);

  // e: a flower army is a Boss seed only with >= 5% of the killing round's power
  const share = (await powerOf(e)) * 20n >= slain.killPower;
  if (share) {
    await send(c, w.guard, "claimLoot", [0n, R], e);
    assert.equal((await w.pv(await w.total())).floor, 3);
  } else {
    await expectRevert(send(c, w.guard, "claimLoot", [0n, R], e), "NoLoot");
  }
  console.log(`  e's army: ${await powerOf(e)} of ${slain.killPower} tenths -> ${share ? "Boss seed" : "too small for loot"}`);

  await w.run(800);
  assert.ok((await w.pv(champ)).look.tier >= 4);
  const { json, svg } = decodeTokenURI(await read(c, w.bloom, "tokenURI", [champ]));
  assertWellFormedSvg(svg);
  assert.equal(json.attributes[0].value, "Champion seed");
});

test("only the guard mints loot; links are set once by the deployer", async () => {
  const w = await world();
  await expectRevert(send(c, w.bloom, "mintLoot", [c.accounts[0], 4]), "NotRaid");
  await expectRevert(send(c, w.bloom, "setLinks", [c.accounts[1], c.accounts[1], c.accounts[1]]), "NotRaid");
});

test("art renders well-formed SVG + JSON for every stage, tier and species", async () => {
  const w = await world();
  const species = new Map();
  for (let i = 0; species.size < 5 && i < 60; i++) {
    const who = c.accounts[i % 10];
    const [all] = await read(c, w.bloom, "plantViews", [1n, 500n]);
    if (all.filter((p) => p.owner.toLowerCase() === who.toLowerCase() && !p.harvested).length >= 3) continue;
    await send(c, w.bloom, "plant", [], who);
    const id = await w.total();
    const v = await w.pv(id);
    if (!species.has(v.look.species)) species.set(v.look.species, id);
  }
  const tiers = new Set();
  const check = async (id) => {
    const { json, svg } = decodeTokenURI(await read(c, w.bloom, "tokenURI", [id]));
    assertWellFormedSvg(svg);
    assert.equal(json.attributes.length, 8);
    return w.pv(id);
  };
  for (const step of [10, 30, 150, 400, 800]) {
    await w.run(step);
    for (const id of species.values()) await check(id);
  }
  for (let i = 0; i < 300 && tiers.size < 5; i++) {
    await w.run(1);
    for (const id of species.values()) tiers.add((await check(id)).look.tier);
  }
  assert.equal(tiers.size, 5, `tiers seen: ${[...tiers]}`);
});
