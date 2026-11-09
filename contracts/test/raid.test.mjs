// Raid rules with exact numbers: a MockGarden serves fighters with chosen species and tiers.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { keccak256, encodeAbiParameters, parseEventLogs } from "viem";
import { chain, deploy, send, read, expectRevert, hamster } from "./helpers.mjs";

let c;
before(async () => (c = await chain()));

const [DAISY, POPPY, LILY, SUN, LOTUS, WHEEL] = [0, 1, 2, 3, 4, 5];
const ZERO = "0x0000000000000000000000000000000000000000";

async function world() {
  const h = await hamster(c);
  const garden = await deploy(c, "MockGarden");
  const raid = await deploy(c, "BloomRaid", [h.core.address, garden.address]);
  const view = await deploy(c, "BloomRaidView", [raid.address]);
  await send(c, garden, "setLinks", [raid.address, ZERO]);
  const fighter = (id, owner, pts, species, tier = 1) => send(c, garden, "setFighter", [BigInt(id), owner, pts, species, tier]);
  const state = (who = c.accounts[0]) => read(c, view, "raidState", [who]);
  /** Write settled rounds and return the Struck events, by round. */
  const strikes = async () => {
    const rc = await send(c, raid, "advance", [4n]);
    return new Map(parseEventLogs({ abi: raid.abi, logs: rc.logs, eventName: "Struck" }).map((l) => [l.args.round, l.args]));
  };
  return { ...h, garden, raid, view, fighter, state, strikes };
}

const koRoll = (seed, id) => BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [seed, BigInt(id)]))) % 100n;
const critRoll = (seed, round) => BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint64" }], [seed, round]))) % 100n;
const seedOf = async (w, round) => {
  const pg = await read(c, w.core, "roundPage", [round - 1n, round, 1n]);
  return pg.rounds[0].dataHash;
};

test("species powers and weakness: Sunflower x1.5, weak species x2, Wheelbloom always x2", async () => {
  const w = await world();
  const [a, b, d] = c.accounts;
  assert.equal((await w.state()).weakSpecies, SUN); // boss 0 is weak to Sunflowers
  await w.fighter(1, a, 25, SUN, 4); // 250 * 1.5 * 2 = 750
  await w.fighter(2, b, 25, LOTUS, 4); // 250
  await w.fighter(3, d, 100, WHEEL, 5); // 1000 * 2 = 2000
  await send(c, w.raid, "attack", [[1n]], a);
  await send(c, w.raid, "attack", [[2n]], b);
  await send(c, w.raid, "attack", [[3n]], d);
  assert.equal((await w.state(a)).myPower, 760n); // + bare paws 10
  assert.equal((await w.state(b)).myPower, 260n);
  assert.equal((await w.state(d)).myPower, 2010n);
  assert.equal((await w.state()).armedPower, 3030n);
});

test("standing armies wait through naps and fight his next working round, once", async () => {
  const w = await world();
  const a = c.accounts[0];
  await w.fighter(1, a, 25, LOTUS, 4); // 250 + bare 10 = 260 tenths
  await send(c, w.raid, "attack", [[1n]], a);
  const { myArmy: R } = await w.state(a);
  await w.settle(R, 0); // he naps through the army's round
  await w.settle(R + 2n, 0); // ...and the next ones
  assert.equal((await w.state(a)).myArmy, R, "still standing");
  await expectRevert(send(c, w.raid, "attack", [[]], a), "AlreadyAttacking"); // one army at a time
  await w.settle(R + 3n, 100); // he wakes: the army fights now
  const st = (await w.strikes()).get(R + 3n);
  assert.equal(st.power, 260n);
  assert.equal(st.damage, (100n * 360n) / 100n);
  assert.equal((await w.state(a)).myArmy, 0n, "fought");
  await w.settle(R + 5n, 100); // the next working round: army already spent
  assert.equal((await w.strikes()).get(R + 5n).power, 0n);
  await send(c, w.raid, "attack", [[1n]], a); // free to arm again
});

test("rally (3+ heads, Daisies count double) and hamster combo multiply a round", async () => {
  const w = await world();
  const [a, b] = c.accounts;
  await w.fighter(1, b, 1, DAISY, 1);
  await send(c, w.raid, "attack", [[]], a); // 1 head
  await send(c, w.raid, "attack", [[1n]], b); // 2 heads (Daisy)
  const { targetRound: R, armedHeads } = await w.state();
  assert.equal(armedHeads, 3n);
  await w.settle(R - 1n, 10); // he was already running (armies wait for R): combo 2 in round R
  await w.settle(R, 100);
  const st = (await w.strikes()).get(R);
  // 100 * (100 + 10 + 20) / 100 = 130 -> rally x1.5 = 195 -> combo +10% = 214
  assert.equal(st.rally, true);
  assert.equal(st.combo, 2);
  assert.equal(st.damage, 214n);
});

test("Poppies add crit chance, rolled from the round's data hash", async () => {
  const w = await world();
  const a = c.accounts[0];
  for (let i = 1; i <= 5; i++) await w.fighter(i, a, 1, POPPY, 5); // tier 5 resists swipes, so they can re-attack
  let crits = 0;
  for (let k = 0; k < 6; k++) {
    await send(c, w.raid, "attack", [[1n, 2n, 3n, 4n, 5n]], a);
    const R = (await w.state(a)).myArmy;
    await w.settle(R, 100);
    const st = (await w.strikes()).get(R);
    const expectCrit = critRoll(await seedOf(w, R), R) < 50n;
    assert.equal(st.crit, expectCrit);
    const base = (100n * (100n + 60n)) / 100n; // bare 10 + 5 poppies x 10
    assert.equal(st.damage, expectCrit ? base * 2n : base);
    if (st.crit) crits++;
  }
  console.log(`  ${crits}/6 rounds crit at 50%`);
});

test("the boss bites every round the hamster sleeps, double when enraged", async () => {
  const w = await world();
  await w.settle(1n, 50);
  await w.settle(7n, 50); // rounds 2..6 slept: 5 x 4
  assert.equal((await w.state()).bites, 20n);
  await w.settle(8n, 1300); // boss 0 now below half HP: enraged
  const v = await w.state();
  assert.equal(v.enraged, true);
  assert.equal(v.biteRate, 8n);
  await w.settle(11n, 0); // 3 more sleeping rounds at 8
  assert.equal((await w.state()).bites, 44n);
});

test("next boss HP = max(x1.25, 6 x the killing blow)", async () => {
  const w = await world();
  const a = c.accounts[0];
  await w.fighter(1, a, 100, WHEEL, 5); // 2000 + 10 tenths = x21
  await send(c, w.raid, "attack", [[1n]], a);
  const R = (await w.state(a)).myArmy;
  await w.settle(R, 300); // 300 * 21.1 = 6330 damage: kills 2500 HP, blow x6 = 37980
  const st = (await w.strikes()).get(R);
  assert.equal(st.damage, 6330n);
  const v = await w.state();
  assert.equal(v.bossId, 1n);
  assert.equal(v.hp, 6330n * 6n);
  const slain = await read(c, w.raid, "boss", [0n]);
  assert.equal(slain.slainRound, R);
  assert.equal(slain.killFrom, R);
  assert.equal(slain.killPower, 2010n);
  assert.equal(slain.top.toLowerCase(), a.toLowerCase());
});

test("counter-attack knocks fighters out for 36 rounds; Star Lilies and Wheelblooms dodge", async () => {
  const w = await world();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const who = c.accounts[i];
    const mine = [];
    for (let j = 0; j < 10; j++) {
      const id = 100 + i * 10 + j;
      await w.fighter(id, who, 3, j === 0 ? LILY : j === 1 ? WHEEL : DAISY, 1);
      mine.push(BigInt(id));
    }
    ids.push(...mine);
    await send(c, w.raid, "attack", [mine], who);
  }
  const R = (await w.state()).targetRound;
  await w.settle(R, 200);
  const st = (await w.strikes()).get(R);
  assert.equal(st.swipe, 10); // boss 0, not enraged
  const seed = await seedOf(w, R);
  const expected = (id) => (Number(id % 10n) <= 1 ? 0n : koRoll(seed, id) < 5n ? R + 36n : 0n); // tier 1 resists 5%
  let kos = 0;
  for (const id of ids) {
    const until = await read(c, w.raid, "koUntil", [id]);
    assert.equal(until, expected(id), `flower ${id}`);
    if (until) kos++;
  }
  console.log(`  ${kos}/30 fighters knocked out at a 5% net swipe`);
});

test("a knocked-out flower sits out 36 rounds, then can fight again", async () => {
  const w = await world();
  await w.settle(1n, 1300); // boss 0 below half HP: enraged, swipes 20%
  assert.equal((await w.state()).swipe, 20);
  const a = c.accounts[0];
  let hurt = null;
  let until = 0n;
  for (let tries = 0; tries < 4 && !hurt; tries++) {
    const ids = [];
    for (let j = 0; j < 10; j++) {
      const id = BigInt(1000 + tries * 10 + j);
      await w.fighter(id, a, 1, DAISY, 0); // tier 0: no resistance
      ids.push(id);
    }
    await send(c, w.raid, "attack", [ids], a);
    const R = (await w.state(a)).myArmy;
    await w.settle(R, 5); // small hits: keep the boss alive and enraged
    await send(c, w.raid, "advance", [1n]);
    for (const id of ids) {
      const u = await read(c, w.raid, "koUntil", [id]);
      if (u) [hurt, until] = [id, u];
    }
  }
  assert.ok(hurt, "someone got knocked out in 40 swings at 20%");
  await expectRevert(send(c, w.raid, "attack", [[hurt]], a), "KnockedOut");
  assert.equal(await read(c, w.raid, "isBusy", [hurt]), true);
  await w.settle(until, 0);
  assert.equal(await read(c, w.raid, "isBusy", [hurt]), false);
  await send(c, w.raid, "attack", [[hurt]], a);
});

test("swipes scale with the boss and resistance scales with tier", async () => {
  const w = await world();
  const a = c.accounts[0];
  await w.fighter(1, a, 100, SUN, 5); // Legendary tier resists 25% (> 10% swipe)
  await send(c, w.raid, "attack", [[1n]], a);
  const R = (await w.state(a)).myArmy;
  await w.settle(R, 100);
  await send(c, w.raid, "advance", [1n]);
  assert.equal(await read(c, w.raid, "koUntil", [1n]), 0n);
});

test("attack rules: one army each, flowers once, only picked flowers", async () => {
  const w = await world();
  const a = c.accounts[0];
  await w.fighter(1, a, 8, SUN, 3);
  await w.fighter(2, a, 0, SUN, 0);
  await expectRevert(send(c, w.raid, "attack", [[2n]], a), "NotAFighter");
  await expectRevert(send(c, w.raid, "attack", [[1n]], c.accounts[1]), "NotYourPlant");
  await expectRevert(send(c, w.raid, "attack", [Array(11).fill(1n)], a), "TooManyFighters");
  await expectRevert(send(c, w.raid, "attack", [[1n, 1n]], a), "AlreadyFighting");
  await send(c, w.raid, "attack", [[1n]], a);
  await expectRevert(send(c, w.raid, "attack", [[]], a), "AlreadyAttacking");
  assert.equal(await read(c, w.raid, "isBusy", [1n]), true);
});

test("more than 16 working rounds catch up with advance(pages)", async () => {
  const w = await world();
  for (let i = 1n; i <= 20n; i++) await w.settle(i * 2n, 10); // every other round: no combo
  assert.equal((await w.state()).damage, 160n); // the view previews one page
  await send(c, w.raid, "advance", [2n]);
  assert.equal((await w.state()).damage, 200n);
});
