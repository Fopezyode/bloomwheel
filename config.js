// After deploying v4 (open deploy.html), paste the addresses and block it prints here.
export const CONFIG = {
  chainId: 11155111, // Sepolia
  rpc: "https://ethereum-sepolia-rpc.publicnode.com",
  // Read connections, tried in order if one is down (all checked to allow browser requests).
  rpcs: [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://sepolia.gateway.tenderly.co",
    "https://ethereum-sepolia.gateway.tatum.io",
    "https://1rpc.io/sepolia",
    "https://rpc.sepolia.ethpandaops.io",
  ],
  bloomwheel: null, // garden + NFTs   (v3 was 0x69f2B41439DA376118edfB2FbFBf45dc6534419E)
  raid: null, // bosses
  guard: null, // guards, holder perk + loot
  pvp: null, // heists + duel arena
  view: null, // raid view helper
  squeekNft: "0xc4c7982657f00509548f3a3a41db7fa439a6856b",
  squeekStaking: "0x50fd1780526c3186a0c037c7622203bc4fb611ca",
  deployBlock: "0",
  squeekCore: "0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4",
  api: "https://api.squeekchain.com",
  explorer: "https://eth-sepolia.blockscout.com",
};
