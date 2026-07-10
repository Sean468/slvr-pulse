require("dotenv").config();
const { ethers } = require("ethers");
const dep = require("../deployments/pulsechain.json");
const gameAbi = [
  "function currentRoundId() view returns (uint256)",
  "function roundCloseTime(uint256) view returns (uint64)",
  "function targetDrandRound(uint64) view returns (uint64)",
  "function drandEmitTime(uint64) view returns (uint64)",
  "function drandPubKey(uint256) view returns (uint256)",
  "function minStake() view returns (uint256)",
  "function slvr() view returns (address)",
  "function owner() view returns (address)",
];
const tokenAbi = ["function minter() view returns (address)","function taxRecipient() view returns (address)","function taxBps() view returns (uint16)"];
(async () => {
  const p = new ethers.JsonRpcProvider(process.env.SPEEDY_RPC);
  const game = new ethers.Contract(dep.gridGame, gameAbi, p);
  const token = new ethers.Contract(dep.slvrToken, tokenAbi, p);
  const rid = await game.currentRoundId();
  const close = await game.roundCloseTime(rid);
  const target = await game.targetDrandRound(close);
  const emit = await game.drandEmitTime(target);
  console.log("owner:", await game.owner());
  console.log("token.minter == game:", (await token.minter()).toLowerCase() === dep.gridGame.toLowerCase());
  console.log("token.taxRecipient == game:", (await token.taxRecipient()).toLowerCase() === dep.gridGame.toLowerCase(), "taxBps:", (await token.taxBps()).toString());
  console.log("game.slvr == token:", (await game.slvr()).toLowerCase() === dep.slvrToken.toLowerCase());
  console.log("pubKey[0] set:", (await game.drandPubKey(0)) !== 0n);
  console.log("minStake:", ethers.formatEther(await game.minStake()), "PLS");
  console.log("currentRoundId:", rid.toString(), "closeTime:", close.toString(), "-> targetDrandRound:", target.toString(), "emitTime:", emit.toString());
  // compare to live evmnet latest
  const r = await (await fetch("https://api.drand.sh/04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3/public/latest")).json();
  console.log("live evmnet latest round:", r.round, "| contract target for current round:", target.toString());
})().catch(e=>{console.error("ERR", e.shortMessage||e.message);process.exit(1);});
