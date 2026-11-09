// Bundles tevm's in-browser Ethereum node into web/vendor/tevm-memory.js for the wallet-free demo.
//
// tevm nests packages deeply, so on Windows install it in a SHORT folder (long paths silently
// lose files past 260 characters), e.g.:
//   mkdir C:\bwd && copy package.json build.mjs entry.mjs C:\bwd && cd C:\bwd
//   npm install
//   (package.json pins tevm@1.0.0-next.142, esbuild@0.24.0, viem@2.37.9, buffer@6.0.3)
//   node build.mjs "C:\path\to\SQUEEKTOSHI\web\vendor\tevm-memory.js"
import { build } from "esbuild";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
if (!out) throw new Error("usage: node build.mjs <output file>");
const res = await build({
  entryPoints: [join(here, "entry.mjs")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  outfile: out,
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  logLevel: "warning",
  metafile: true,
});
const bytes = Object.values(res.metafile.outputs)[0].bytes;
console.log(`wrote ${out} (${(bytes / 1e6).toFixed(2)} MB)`);
