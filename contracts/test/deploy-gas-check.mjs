// node test/deploy-gas-check.mjs — estimate each deployment tx on live Sepolia vs the 16,777,216 per-tx gas cap.
import { createPublicClient, http, encodeDeployData } from "viem";
import { artifact } from "./helpers.mjs";
const CAP = 16_777_216n;
const CORE = "0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4";
const DUMMY = "0x000000000000000000000000000000000000dEaD".toLowerCase();
const pub = createPublicClient({ transport: http(process.argv[2] ?? "https://ethereum-sepolia-rpc.publicnode.com") });
const from = "0x000000000000000000000000000000000000b10c";
let ok = true;
const NFT = "0xc4c7982657f00509548f3a3a41db7fa439a6856b";
const STAKING = "0x50fd1780526c3186a0c037c7622203bc4fb611ca";
for (const [name, args] of [["BloomPetals", []], ["BloomRenderer", [DUMMY]], ["Bloomwheel", [CORE, DUMMY]], ["BloomRaid", [CORE, DUMMY]], ["BloomGuard", [DUMMY, NFT, STAKING]], ["BloomPvP", [CORE, DUMMY]], ["BloomRaidView", [DUMMY]]]) {
  const { abi, bytecode } = artifact(name);
  const gas = await pub.estimateGas({ account: from, data: encodeDeployData({ abi, bytecode, args }) });
  const pct = Number((gas * 1000n) / CAP) / 10;
  if (gas > (CAP * 95n) / 100n) ok = false;
  console.log(`${name.padEnd(14)} ${String(gas).padStart(10)} gas  (${pct}% of per-tx cap)`);
}
if (!ok) throw new Error("a deployment is within 5% of (or over) the per-transaction gas cap");
console.log("all deployments fit");
process.exit(0);
