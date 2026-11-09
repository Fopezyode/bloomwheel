// Hardhat is used only as a local EVM (tests + `npm run chain`). Compilation is solc-js (scripts/build.mjs).
const fork = process.env.FORK_RPC;

module.exports = {
  networks: {
    hardhat: {
      chainId: fork ? 11155111 : 31337,
      hardfork: "cancun",
      allowUnlimitedContractSize: false,
      ...(fork ? { forking: { url: fork } } : {}),
    },
  },
};
