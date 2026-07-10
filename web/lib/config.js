// Public config for the SLVR grid-mining dApp (PulseChain mainnet).
// Reads use a PUBLIC RPC (never the keyed Speedy URL — that stays server-side).
export const CHAIN_ID = 369;
export const CHAIN_ID_HEX = "0x171";
export const READ_RPC = "https://rpc.pulsechain.com";
export const EXPLORER = "https://otter.pulsechain.com";

export const SLVR_TOKEN = "0xC0F1bDB494Cd248e1D64236720b8d253540ad7cC";
export const GRID_GAME = "0x61a21dB5764C695490FE9394999F121499c5Bd07";
export const SQUARES = 25;
// drand evmnet chain — used to link each result to its exact verifiable beacon.
export const EVMNET_CHAIN_HASH = "04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3";
export const DRAND_API = "https://api.drand.sh";

export const PULSECHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: "PulseChain",
  nativeCurrency: { name: "Pulse", symbol: "PLS", decimals: 18 },
  rpcUrls: [READ_RPC],
  blockExplorerUrls: [EXPLORER],
};

export const GAME_ABI = [
  "function currentRoundId() view returns (uint256)",
  "function roundCloseTime(uint256) view returns (uint64)",
  "function gameStart() view returns (uint64)",
  "function roundDuration() view returns (uint64)",
  "function minStake() view returns (uint256)",
  "function houseFeeBps() view returns (uint16)",
  "function slvrJackpotPool() view returns (uint256)",
  "function jackpotOdds() view returns (uint256)",
  "function roundPot(uint256) view returns (uint256)",
  "function squareStake(uint256,uint8) view returns (uint256)",
  "function userStake(uint256,address,uint8) view returns (uint256)",
  "function result(uint256) view returns (bool settled, uint8 winningSquare, uint64 drandRound, uint256 grossPot, uint256 payoutPool, uint256 winningStake, uint256 slvrEmission, uint256 jackpotAwarded)",
  "function pendingClaim(uint256,address) view returns (uint256 plsOut, uint256 slvrOut, uint256 jackpotOut)",
  "function claimed(uint256,address) view returns (bool)",
  "function stake(uint8 square) payable",
  "function claim(uint256 roundId)",
];

export const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
];
