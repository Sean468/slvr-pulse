// slvr-pulse settlement keeper.
// Watches for closed rounds that have stakes but aren't settled, fetches the
// round's target drand `evmnet` beacon, and calls settle(). Empty rounds are
// skipped (no funds, no need to pay gas). Permissionless settle — this is just
// the default settler; anyone (e.g. a winner) can also settle.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");
const { kyberG1ToEvm } = require("@kevincharm/bls-bn254");
const dep = require("../deployments/pulsechain.json");

const norm = (v) => { v = (v || "").trim(); return v.startsWith("0x") ? v : "0x" + v; };
const CHAIN_HASH = dep.evmnetChainHash;
const POLL_MS = 15_000;

const gameAbi = [
  "function currentRoundId() view returns (uint256)",
  "function roundCloseTime(uint256) view returns (uint64)",
  "function targetDrandRound(uint64) view returns (uint64)",
  "function drandEmitTime(uint64) view returns (uint64)",
  "function roundPot(uint256) view returns (uint256)",
  "function result(uint256) view returns (bool settled, uint8 winningSquare, uint64 drandRound, uint256 grossPot, uint256 payoutPool, uint256 winningStake, uint256 slvrEmission, uint256 jackpotAwarded)",
  "function settle(uint256 roundId, uint256[2] signature)",
];

const provider = new ethers.JsonRpcProvider(process.env.SPEEDY_RPC);
const wallet = new ethers.Wallet(norm(process.env.DEPLOYER_PK), provider);
const game = new ethers.Contract(dep.gridGame, gameAbi, wallet);

let cursor = 0; // lowest round id not yet known-final

async function fetchBeacon(round) {
  const url = `https://api.drand.sh/${CHAIN_HASH}/public/${round}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  return j.signature; // 64-byte G1 hex
}

async function tick() {
  const rid = Number(await game.currentRoundId());
  for (let r = cursor; r < rid; r++) {
    const res = await game.result(r);
    if (res.settled) { cursor = r + 1; continue; }

    const pot = await game.roundPot(r);
    if (pot === 0n) { cursor = r + 1; continue; } // empty: never needs settling

    const closeTime = await game.roundCloseTime(r);
    const target = await game.targetDrandRound(closeTime);
    const emit = await game.drandEmitTime(target);
    const now = (await provider.getBlock("latest")).timestamp;
    if (now < Number(emit)) return; // beacon can't exist yet; wait

    const sigHex = await fetchBeacon(Number(target));
    if (!sigHex) { console.log(`[r${r}] beacon ${target} not published yet; retry`); return; }

    const sig = kyberG1ToEvm(ethers.getBytes("0x" + sigHex));
    try {
      const fee = await provider.getFeeData();
      const gasPrice = (fee.gasPrice * 13n) / 10n;
      const tx = await game.settle(r, sig, { gasPrice, type: 0, gasLimit: 600000 });
      console.log(`[r${r}] settling with drand ${target} -> ${tx.hash}`);
      const rc = await tx.wait();
      const after = await game.result(r);
      console.log(`[r${r}] settled block ${rc.blockNumber}: winningSquare=${after.winningSquare} pot=${ethers.formatEther(after.grossPot)} payout=${ethers.formatEther(after.payoutPool)} jackpot=${ethers.formatEther(after.jackpotAwarded)}`);
      cursor = r + 1;
    } catch (e) {
      console.error(`[r${r}] settle failed:`, e.shortMessage || e.message);
      return; // retry next tick
    }
  }
}

async function main() {
  console.log("keeper up. game:", dep.gridGame, "as", wallet.address);
  const once = process.argv.includes("--once") || process.env.KEEPER_ONCE === "1";
  if (once) {
    // Single pass (for GitHub Actions cron / one-shot). Scan from 0 each run
    // since there is no persisted cursor across invocations.
    try { await tick(); } catch (e) { console.error("tick error:", e.shortMessage || e.message); }
    return;
  }
  for (;;) {
    try { await tick(); } catch (e) { console.error("tick error:", e.shortMessage || e.message); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
main();
