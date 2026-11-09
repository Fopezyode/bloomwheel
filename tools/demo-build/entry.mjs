// Bundle entry for the wallet-free demo: an in-browser Ethereum node (tevm) plus a small
// provider that behaves like a local dev node: eth_accounts lists 10 pre-funded test accounts,
// and eth_sendTransaction from them is signed here and sent as a raw transaction.
import { createMemoryClient, PREFUNDED_ACCOUNTS } from "tevm";
import { createWalletClient, custom } from "viem";

export function createDemoNode() {
  const node = createMemoryClient({ miningConfig: { type: "auto" } });
  const raw = { request: (args) => node.request(args) };
  const wallets = new Map(
    PREFUNDED_ACCOUNTS.map((account) => [account.address.toLowerCase(), createWalletClient({ account, transport: custom(raw) })])
  );
  const accounts = PREFUNDED_ACCOUNTS.map((a) => a.address);
  const provider = {
    async request({ method, params }) {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return accounts;
      if (method === "eth_sendTransaction") {
        const tx = params[0];
        const wallet = wallets.get(String(tx.from).toLowerCase());
        if (!wallet) throw new Error(`demo: unknown account ${tx.from}`);
        return wallet.sendTransaction({
          to: tx.to ?? undefined,
          data: tx.data ?? tx.input,
          value: tx.value ? BigInt(tx.value) : undefined,
          gas: tx.gas ? BigInt(tx.gas) : undefined,
          chain: null,
        });
      }
      return node.request({ method, params });
    },
  };
  return { node, provider, accounts };
}
