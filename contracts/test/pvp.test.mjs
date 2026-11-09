// Garden Heists + the Duel Arena on the real stack, outcomes checked against the on-chain rolls.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { keccak256, encodeAbiParameters, parseEventLogs } from "viem";
import { chain, deployGame, send, read, expectRevert, hamster } from "./helpers.mjs";

let c;
before(async () => (c = await chain()));

async function world() {
  const h = await hamster(c);
  const game = await deployGame(c, h.core.address);
  const pv = async (id) => (await read(c, game.bloom, "plantViews", [BigInt(id), 1n]))[0][0];
  const total = () => read(c, game.bloom, "totalPlanted");
  const plant = async (who) => (await send(c, game.bloom, "plant", [], who), total());
  const harvest = async (id, who) => send(c, game.bloom, "harvest", [id, await h.work()], who);
  const seedFor = async (r) => {
    const s = await h.state();
    const pg = await read(c, h.core, "roundPage", [r - 1n, s.settledThroughRound, 1n]);
    return pg.rounds[0].dataHash;
  };
  return { ...h, ...game, pv, total, plant, harvest, seedFor };
}

const roll = (types, values) => BigInt(keccak256(encodeAbiParameters(types.map((type) => ({ type })), values))) % 100n;
const events = (rc, abi, name) => parseEventLogs({ abi, logs: rc.logs, eventName: name });
const BEATS = { 0: 3, 1: 2, 2: 0, 3: 4, 4: 1 };
const beats = (x, y) => x < 5 && y < 5 && BEATS[x] === y;

async function heistSetup(w, thief, victim) {
  const target = await w.plant(victim);
  const flowerPlot = await w.plant(thief);
  await w.run(900);
  await w.harvest(flowerPlot, thief);
  const receiver = await w.plant(thief);
  return { target, flower: flowerPlot, receiver };
}

// ================================================================== heists

test("heists: odds and loot fixed at the start; success moves growth, failure jails raiders", async () => {
  const w = await world();
  const [thief, victim] = c.accounts;
  let wins = 0;
  let fails = 0;
  for (let k = 0; k < 6 && (!wins || !fails); k++) {
    const s = await heistSetup(w, thief, victim);
    const f = await w.pv(s.flower);
    const targetGrowth = (await w.pv(s.target)).growth;
    const planned = events(await send(c, w.pvp, "heist", [s.target, s.receiver, [s.flower]], thief), w.pvp.abi, "HeistPlanned")[0].args;
    const power = BigInt(f.points) * (f.look.species === 3 ? 15n : 10n);
    assert.equal(planned.chance, (power * 100n) / (power + 50n));
    assert.equal(planned.loot, targetGrowth / 4n > 400n ? 400n : targetGrowth / 4n);
    assert.equal(await read(c, w.pvp, "isBusy", [s.flower]), true);
    await expectRevert(send(c, w.raid, "attack", [[s.flower]], thief), "Guarding"); // tied up in a heist
    await expectRevert(send(c, w.pvp, "resolveHeist", [planned.id]), "NotYet");

    await w.settle(planned.round, 100);
    const before = { t: (await w.pv(s.target)).growth, r: (await w.pv(s.receiver)).growth };
    const res = events(await send(c, w.pvp, "resolveHeist", [planned.id]), w.pvp.abi, "HeistResolved")[0].args;
    const win = roll(["bytes32", "string", "uint256"], [await w.seedFor(planned.round), "heist", planned.id]) < planned.chance;
    assert.equal(res.success, win);
    if (win) {
      assert.equal(res.loot, planned.loot);
      assert.equal((await w.pv(s.target)).growth, before.t - planned.loot);
      assert.equal((await w.pv(s.receiver)).growth, before.r + planned.loot);
      wins++;
    } else {
      assert.equal(await read(c, w.pvp, "busyUntil", [s.flower]), f.look.species === 2 ? planned.round : res.round + 36n);
      fails++;
    }
    await w.harvest(s.target, victim);
    await w.harvest(s.receiver, thief);
  }
  console.log(`  heists: ${wins} succeeded, ${fails} failed (each matched its on-chain roll)`);
});

test("guards posted after a heist starts don't change its odds", async () => {
  const w = await world();
  const [thief, victim] = c.accounts;
  const s = await heistSetup(w, thief, victim);
  const g = await w.plant(victim);
  await w.run(900);
  await w.harvest(g, victim);
  const planned = events(await send(c, w.pvp, "heist", [s.target, s.receiver, [s.flower]], thief), w.pvp.abi, "HeistPlanned")[0].args;
  await send(c, w.guard, "station", [[g]], victim); // too late
  assert.ok((await read(c, w.guard, "shield", [victim])) > 0n);
  await w.settle(planned.round, 100);
  const res = events(await send(c, w.pvp, "resolveHeist", [planned.id]), w.pvp.abi, "HeistResolved")[0].args;
  const win = roll(["bytes32", "string", "uint256"], [await w.seedFor(planned.round), "heist", planned.id]) < planned.chance;
  assert.equal(res.success, win, "resolved with the chance fixed at the start");
});

test("heist rules: no self-robbery, targets must be Bud+, 36-round cooldown", async () => {
  const w = await world();
  const [thief, victim, other] = c.accounts;
  const s = await heistSetup(w, thief, victim);
  const small = await w.plant(victim);
  await expectRevert(send(c, w.pvp, "heist", [s.receiver, s.receiver, [s.flower]], thief), "BadTarget");
  await expectRevert(send(c, w.pvp, "heist", [small, s.receiver, [s.flower]], thief), "BadTarget");
  await expectRevert(send(c, w.pvp, "heist", [s.target, s.receiver, []], thief), "TooManyRaiders");
  await send(c, w.pvp, "heist", [s.target, s.receiver, [s.flower]], thief);
  const o = await w.plant(other);
  await w.run(500);
  await w.harvest(o, other);
  const oReceiver = await w.plant(other);
  await expectRevert(send(c, w.pvp, "heist", [s.target, oReceiver, [o]], other), "Cooldown");
});

// =================================================================== arena

test("arena: entrants are paired at random from the round's data; winners take both", async () => {
  const w = await world();
  const players = c.accounts.slice(0, 5); // odd count: one gets a bye
  const flowers = [];
  for (const p of players) flowers.push(await w.plant(p));
  await w.run(900);
  for (let i = 0; i < 5; i++) await w.harvest(flowers[i], players[i]);
  let round;
  for (let i = 0; i < 5; i++) {
    const ev = events(await send(c, w.pvp, "enterArena", [flowers[i]], players[i]), w.pvp.abi, "ArenaEntered")[0].args;
    round = ev.round;
    assert.equal((await read(c, w.bloom, "ownerOf", [flowers[i]])).toLowerCase(), w.pvp.address.toLowerCase());
  }
  assert.equal((await read(c, w.pvp, "arena", [round])).length, 5);
  await expectRevert(send(c, w.raid, "attack", [[flowers[0]]], players[0]), "NotYourPlant"); // held in the arena
  await expectRevert(send(c, w.pvp, "resolveArena", [round]), "NotYet");

  await w.settle(round, 0); // he naps: the arena waits
  await expectRevert(send(c, w.pvp, "resolveArena", [round]), "NotYet");
  await expectRevert(send(c, w.pvp, "leaveArena", [flowers[0]], players[0]), "NotYet"); // round has started
  await w.run(80);
  const rc = await send(c, w.pvp, "resolveArena", [round], c.accounts[7]);
  const duels = events(rc, w.pvp.abi, "DuelResolved").map((l) => l.args);
  const bye = events(rc, w.pvp.abi, "ArenaLeft").map((l) => l.args);
  assert.equal(duels.length, 2);
  assert.equal(bye.length, 1);

  // re-derive the shuffle and every score
  const seed = await w.seedFor(round);
  const entries = flowers.map((f, i) => ({ owner: players[i], flower: f }));
  for (let i = entries.length; i > 1; i--) {
    const j = Number(BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint64" }, { type: "uint256" }], [seed, round, BigInt(i)]))) % BigInt(i));
    [entries[i - 1], entries[j]] = [entries[j], entries[i - 1]];
  }
  const looks = new Map();
  for (const f of flowers) looks.set(f, await w.pv(f));
  for (let k = 0; k < 2; k++) {
    const [A, B] = [entries[2 * k], entries[2 * k + 1]];
    const [la, lb] = [looks.get(A.flower), looks.get(B.flower)];
    const ra = roll(["bytes32", "string", "uint256"], [seed, "duel", A.flower]);
    const rb = roll(["bytes32", "string", "uint256"], [seed, "duel", B.flower]);
    const sa = BigInt(la.points) * (beats(la.look.species, lb.look.species) ? 2n : 1n) * (50n + ra);
    const sb = BigInt(lb.points) * (beats(lb.look.species, la.look.species) ? 2n : 1n) * (50n + rb);
    const winner = sa > sb || (sa === sb && ra >= rb) ? A : B;
    const d = duels[k];
    assert.equal(d.winner.toLowerCase(), winner.owner.toLowerCase());
    assert.equal(d.winScore, winner === A ? sa : sb);
    for (const f of [A.flower, B.flower]) assert.equal((await read(c, w.bloom, "ownerOf", [f])).toLowerCase(), winner.owner.toLowerCase());
  }
  assert.equal(bye[0].flower, entries[4].flower);
  assert.equal((await read(c, w.bloom, "ownerOf", [entries[4].flower])).toLowerCase(), entries[4].owner.toLowerCase());
  await expectRevert(send(c, w.pvp, "resolveArena", [round]), "BadState");
});

test("arena: leave before the round starts; guards can't enter", async () => {
  const w = await world();
  const [a] = c.accounts;
  const f1 = await w.plant(a);
  const f2 = await w.plant(a);
  await w.run(900);
  await w.harvest(f1, a);
  await w.harvest(f2, a);
  await send(c, w.pvp, "enterArena", [f1], a);
  await expectRevert(send(c, w.pvp, "leaveArena", [f1], c.accounts[1]), "NotYours");
  await send(c, w.pvp, "leaveArena", [f1], a);
  assert.equal((await read(c, w.bloom, "ownerOf", [f1])).toLowerCase(), a.toLowerCase());
  await send(c, w.guard, "station", [[f2]], a);
  await expectRevert(send(c, w.pvp, "enterArena", [f2], a), "Busy");
});

test("arena: rock-paper-scissors table", async () => {
  const w = await world();
  for (const [a, b] of [[3, 4], [4, 1], [1, 2], [2, 0], [0, 3]]) {
    assert.equal(await read(c, w.pvp, "beats", [a, b]), true);
    assert.equal(await read(c, w.pvp, "beats", [b, a]), false);
  }
  assert.equal(await read(c, w.pvp, "beats", [5, 3]), false);
});
