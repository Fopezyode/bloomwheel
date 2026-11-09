# Bloomwheel: Raid Night

**A garden that only grows when Squeektoshi runs, and a boss that only dies when he does.**

> **Repository layout:** the site files are at the top level (open `index.html`, or `demo.html` for the wallet-free demo); paths below that say `web/` refer to them.

Squeektoshi runs on a real wheel, and every 10 minutes his work settles on Sepolia. Everything in this game comes from that: growth, rerolls, damage, dice and loot.

**Try it without a wallet:** open `demo.html`. It runs the real contracts on a private chain inside your browser, with 20-second rounds, a fast hamster and bot gardeners.

## How it plays

1. **Grow.** Plant seeds for free: 3 plots, or 4 for Squeek holders. They grow only when the hamster runs. From Bud on, every settled run rerolls each bloom (Common → Legendary). Pick a bloom to freeze it. Wait too long and it wilts.
2. **Attack or defend.** Every picked flower has a job:
   - **Army:** arm an army and it **stands ready until his next working round**, however long he sleeps, then fights once and multiplies that round's damage. One army per gardener at a time.
   - **Guard:** guards stay home and shield your growing plants.
3. **The boss fights back.**
   - **Bites:** while he sleeps, the boss eats lifespan from growing plants, (4 + boss number) per round. Guards block this: shield % equals guard points, Lotus counts double, up to 90%.
   - **Swipes:** every fighter may be **knocked out for 36 rounds**. The chance is (10 + 3 × boss number)%, minus 5% per rarity tier, rolled from the round's signed data hash.
   - **Enrage:** below 50% HP, bites and swipes double.
4. **Play the matchup.**
   - Each boss is **weak to one species** (×2).
   - **Roles:** 🌻 Sunflower ×1.5 · 🌺 Poppy +10% crit chance · ✦ Star Lily dodges swipes · 🌼 Daisy counts double for Rally · ✿ Lotus double shield · ☸ Wheelbloom always ×2 and never knocked out.
   - **Rally:** 3+ heads in a round deal ×1.5.
   - **Combo:** back-to-back working rounds add +10% each, up to +50%.
5. **Last hit wins.**
   - Armies in the killing round that brought **at least one flower and ≥5% of its power** get a **Boss Seed** (Rare+). The biggest army gets a **Champion Seed** (Epic+).
   - Loot needs a free plot.
   - **The next boss's HP is max(×1.25, 6 × the killing blow)**, so every boss is a real fight however strong the gardeners get.
6. **🦝 Garden Heists.**
   - Rob a rival's Bud-or-bigger plant with up to 5 raiders. **Odds and loot are fixed when the heist starts**: chance = power ÷ (power + their shield × 10 + 50), and loot = 25% of growth, up to 400.
   - **Fail**, and your raiders are jailed for 36 rounds (Star Lilies slip away).
   - A plant can be targeted once per 36 rounds.
7. **🏟 Duel Arena.**
   - Stake a flower in the next round's arena. When he runs, entrants are **shuffled with that round's data and paired at random**, so nobody can pick a winning matchup.
   - Score = points × 2 if your species beats theirs (🌻 › ✿ › 🌺 › ✦ › 🌼 › 🌻) × luck. **The winner takes both flowers.**
   - You can leave before the round starts, or after 36 rounds with no run.

## Trust model

- **Everything is decided on-chain from SqueekCore.**
  - Growth and rerolls use `state()`.
  - Damage, combos and sleeping rounds use exact per-round work from `roundPage()`; zero-work rounds don't appear there.
  - Crits, knockouts, heists and arena pairings roll from the round's reporter-signed `dataHash`, which nobody knows when they commit.
  - Round timing uses `configuration()`.
- **No admin keys, no oracle, no keeper.** Anyone can trigger reveals and record kills.
- **Fair picks.** `harvest(id, expectedWork)` refuses if a settlement lands first, so you never get a bloom you didn't see.
- **The holder perk** reads `SqueekNFT.balanceOf` and `SqueekStaking.accountPower().nftPower`.
- **The live API** is used only for animation (wheel speed, flying seeds, "incoming" damage).

## Contracts

Sepolia charges **1,542 gas per byte of code** against a **16,777,216 gas cap per transaction**, so the game is split into seven contracts:

| Contract | Role | Live Sepolia deploy gas |
|---|---|---|
| `BloomPetals` | draws the plant | 13.5M (81%) |
| `BloomRenderer` | card frame + JSON metadata | 11.6M (69%) |
| `Bloomwheel` | garden + ERC-721 | 15.9M (95%) |
| `BloomRaid` | bosses, standing armies, roles, swipes, bites | 15.8M (94%) |
| `BloomGuard` | guards, holder perk, boss loot | 8.4M (50%) |
| `BloomPvP` | heists + duel arena | 15.4M (92%) |
| `BloomRaidView` | one-call view of the raid for the page | 4.9M (29%) |

An eighth transaction, `Bloomwheel.setLinks(raid, guard, pvp)`, links them. It can be called once, by the deployer.

## Run it

Run these in `contracts/`:

```bash
npm install && npm run build && npm test
```

To play locally against a mock hamster (60-second rounds), start the chain with `npm run chain` in its own terminal, then:

```bash
node scripts/deploy-local.mjs
```

```bash
python ../serve.py
```

Then open `http://localhost:5173/?local=1`, or `http://localhost:5173/demo.html` for the in-browser demo.

**Checks against live Sepolia** (nothing is sent):

```bash
node test/deploy-gas-check.mjs
```

```bash
FORK_RPC=https://sepolia.gateway.tenderly.co node test/sepolia-fork.mjs
```

The demo's in-browser chain (`web/vendor/tevm-memory.js`) is bundled by `tools/demo-build/build.mjs`; the instructions are at the top of that file.

## Go live

1. Run `python serve.py`, then open `http://localhost:5173/deploy.html` in the browser that has your wallet. It checks your network and balance, then walks through **8 transactions**, resuming if you stop halfway.
2. Paste the printed `bloomwheel`, `raid`, `guard`, `pvp`, `view` and `deployBlock` lines into `web/config.js`.
3. Host `web/` through IMD, or any static host.

Testnet only: no token, no value. Unaudited.
