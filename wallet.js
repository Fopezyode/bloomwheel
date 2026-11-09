// Shared wallet helpers: switch networks safely and turn wallet errors into plain words.

export const FAUCETS = [
  ["Google Cloud faucet", "https://cloud.google.com/application/web3/faucet/ethereum/sepolia"],
  ["Alchemy faucet", "https://www.alchemy.com/faucets/ethereum-sepolia"],
];
const faucetLinks = () => FAUCETS.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join(" or ");

/** Which extension answered window.ethereum (for error messages). */
export function walletName() {
  const e = window.ethereum;
  if (!e) return null;
  if (e.isRabby) return "Rabby";
  if (e.isPhantom) return "Phantom";
  if (e.isCoinbaseWallet) return "Coinbase Wallet";
  if (e.isBraveWallet) return "Brave Wallet";
  if (e.isOkxWallet || e.isOKExWallet) return "OKX Wallet";
  if (e.isMetaMask) return "MetaMask";
  return "your wallet";
}

/** Ask the wallet to add a working Sepolia RPC (MetaMask shows an "add / update network" prompt). */
export async function addWorkingRpc(rpcs) {
  await window.ethereum.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId: "0xaa36a7",
      chainName: "Sepolia",
      nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: rpcs,
      blockExplorerUrls: ["https://eth-sepolia.blockscout.com"],
    }],
  });
}

/** Switch to `chain`, adding it to the wallet first if the wallet doesn't know it. */
export async function ensureChain(wallet, chain) {
  if ((await wallet.getChainId()) === chain.id) return;
  try {
    await wallet.switchChain({ id: chain.id });
  } catch (e) {
    if (codes(e).includes(4902) || /unrecognized|not added|unknown chain/i.test(texts(e))) {
      await wallet.addChain({ chain });
      await wallet.switchChain({ id: chain.id });
    } else throw e;
  }
  if ((await wallet.getChainId()) !== chain.id) throw new Error(`Please switch ${walletName()} to ${chain.name} and try again.`);
}

function chainOf(e) {
  const out = [];
  for (let x = e, i = 0; x && i < 10; x = x.cause, i++) out.push(x);
  return out;
}
const codes = (e) => chainOf(e).flatMap((x) => [x.code, x.data?.code, x.data?.originalError?.code]).filter((c) => c !== undefined);
const texts = (e) =>
  chainOf(e)
    .flatMap((x) => [x.details, x.shortMessage, x.message, x.data?.message, x.data?.data?.message, x.data?.originalError?.message])
    .filter((s) => typeof s === "string")
    .join(" | ");

/** Best human explanation for any wallet / RPC / contract error. Returns HTML. */
export function describeError(e, contractErrors = {}) {
  for (const x of chainOf(e)) {
    const name = x.data?.errorName;
    if (name) return contractErrors[name] ?? name;
  }
  const t = texts(e);
  const c = codes(e);
  const w = walletName() ?? "your wallet";
  if (c.includes(4001) || /user rejected|user denied|rejected the request|cancel/i.test(t)) return "Cancelled in your wallet.";
  if (c.includes(-32002) || /already pending/i.test(t))
    return `${w} already has a request waiting. Click the ${w} extension icon, approve or reject it, then try again.`;
  if (/insufficient funds|exceeds the balance|gas \* price/i.test(t))
    return `Your wallet has no Sepolia ETH to pay gas. Sepolia ETH is free test money: get some from the ${faucetLinks()}, then try again.`;
  if (/rpc|not available|unavailable|failed to fetch|timed? ?out|bad gateway|service unavailable|\b50[234]\b/i.test(t))
    return `${w}'s own connection to Sepolia is down right now (this page is fine). <button class="btn ghost" data-fix-rpc>Point ${w} at a working Sepolia RPC</button> or do it by hand: ${w} → Settings → Networks → Sepolia → add RPC URL <code>https://ethereum-sepolia-rpc.publicnode.com</code>. Then try again.`;
  if (c.includes(4100) || /not authorized|unauthorized/i.test(t)) return `${w} hasn't connected this site yet. Unlock it, approve the connection, then try again.`;
  if (/chain|network/i.test(t) && /mismatch|does not match|switch/i.test(t)) return `${w} is on the wrong network. Switch it to Sepolia and try again.`;
  // Fall back to the most specific message the wallet gave us, not the generic wrapper.
  const specific = chainOf(e)
    .flatMap((x) => [x.data?.data?.message, x.data?.message, x.data?.originalError?.message, x.details])
    .find((s) => typeof s === "string" && s && !/^internal (json-rpc )?error\.?$/i.test(s.trim()));
  const top = String(e?.shortMessage ?? e?.message ?? e).split("\n")[0];
  if (specific) return `${top} (${w} says: ${specific})`;
  if (c.includes(-32603) || /internal/i.test(t))
    return `${w} hit an internal error without saying why. Usually one of these fixes it: unlock ${w}; make sure it is on Sepolia with some Sepolia ETH (free from the ${faucetLinks()}); if you have several wallet extensions, turn all but one off; then reload this page and try again.`;
  return `${top} (${w}, code ${c[0] ?? "?"})`;
}
