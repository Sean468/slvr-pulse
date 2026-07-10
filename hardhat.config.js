require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const norm = (v) => { v = (v || "").trim(); return v ? (v.startsWith("0x") ? v : "0x" + v) : ""; };
const DEPLOYER_PK = norm(process.env.DEPLOYER_PK);
const SPEEDY_RPC = process.env.SPEEDY_RPC || "https://rpc.pulsechain.com";

// PulseChain runs a pre-Cancun (Shanghai) EVM. Compiling with the default
// `cancun` target emits MCOPY/other opcodes that revert on-chain with
// `invalid opcode`. Pin evmVersion to "shanghai" for every network.
const EVM_VERSION = "shanghai";

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: EVM_VERSION,
    },
  },
  networks: {
    hardhat: {
      // Local test network. Cancun would be fine locally, but we match the
      // production target so tests exercise the exact bytecode we deploy.
      hardfork: "shanghai",
    },
    pulsechain: {
      url: SPEEDY_RPC,
      chainId: 369,
      accounts: DEPLOYER_PK ? [DEPLOYER_PK] : [],
      // PulseChain base fee is ~400k gwei; ethers 1559 defaults under-tip and
      // never mine. Force a generous legacy gasPrice (1e15 wei = 1,000,000 gwei).
      gasPrice: 1_000_000_000_000_000,
    },
    pulsechainTestnet: {
      url: process.env.PULSE_TESTNET_RPC || "https://rpc.v4.testnet.pulsechain.com",
      chainId: 943,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};
