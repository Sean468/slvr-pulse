require("dotenv").config();
const { ethers } = require("ethers");
const { kyberG1ToEvm } = require("@kevincharm/bls-bn254");
const dep = require("../deployments/pulsechain.json");
const norm = (v) => { v=(v||"").trim(); return v.startsWith("0x")?v:"0x"+v; };
const CH = dep.evmnetChainHash;
const abi = [
  "function currentRoundId() view returns (uint256)",
  "function roundCloseTime(uint256) view returns (uint64)",
  "function targetDrandRound(uint64) view returns (uint64)",
  "function drandEmitTime(uint64) view returns (uint64)",
  "function result(uint256) view returns (bool settled,uint8 winningSquare,uint64 drandRound,uint256 grossPot,uint256 payoutPool,uint256 winningStake,uint256 slvrEmission,uint256 jackpotAwarded)",
  "function settle(uint256,uint256[2])",
  "function pendingClaim(uint256,address) view returns (uint256,uint256,uint256)",
  "function claim(uint256)",
];
const tokenAbi=["function balanceOf(address) view returns (uint256)"];
const ROUND = Number(process.env.VR || "3");
const sleep = (ms) => new Promise(r=>setTimeout(r,ms));
(async () => {
  const p = new ethers.JsonRpcProvider(process.env.SPEEDY_RPC);
  const w = new ethers.Wallet(norm(process.env.DEPLOYER_PK), p);
  const g = new ethers.Contract(dep.gridGame, abi, w);
  const token = new ethers.Contract(dep.slvrToken, tokenAbi, p);
  const close = Number(await g.roundCloseTime(ROUND));
  const target = Number(await g.targetDrandRound(close));
  const emit = Number(await g.drandEmitTime(target));
  console.log(`round ${ROUND} close ${close} target drand ${target} emit ${emit}`);
  // wait until beacon exists on-chain-time and API
  for (;;) {
    const now = (await p.getBlock("latest")).timestamp;
    if (now >= emit) break;
    console.log(`  waiting ${emit-now}s for close+beacon...`); await sleep(5000);
  }
  let sigHex=null;
  for (let i=0;i<40;i++){ const r=await fetch(`https://api.drand.sh/${CH}/public/${target}`); if(r.ok){sigHex=(await r.json()).signature;break;} await sleep(3000); }
  if(!sigHex) throw new Error("beacon not published");
  const already = await g.result(ROUND);
  if (!already.settled) {
    const fee=await p.getFeeData(); const gasPrice=(fee.gasPrice*15n)/10n;
    const tx = await g.settle(ROUND, kyberG1ToEvm(ethers.getBytes("0x"+sigHex)), { gasPrice, type:0, gasLimit:600000 });
    console.log("settle tx", tx.hash); await tx.wait();
  }
  const res = await g.result(ROUND);
  console.log(`settled: winningSquare=${res.winningSquare} pot=${ethers.formatEther(res.grossPot)} payout=${ethers.formatEther(res.payoutPool)} slvrEmission=${ethers.formatEther(res.slvrEmission)}`);
  const [plsOut, slvrOut] = await g.pendingClaim(ROUND, w.address);
  console.log(`pendingClaim: ${ethers.formatEther(plsOut)} PLS + ${ethers.formatEther(slvrOut)} SLVR`);
  const balBefore = await p.getBalance(w.address);
  const slvrBefore = await token.balanceOf(w.address);
  const fee=await p.getFeeData(); const gasPrice=(fee.gasPrice*15n)/10n;
  const ctx = await g.claim(ROUND, { gasPrice, type:0, gasLimit:200000 });
  console.log("claim tx", ctx.hash); const cr = await ctx.wait();
  const gas = cr.gasUsed * cr.gasPrice;
  const balAfter = await p.getBalance(w.address);
  const slvrAfter = await token.balanceOf(w.address);
  console.log(`PLS received (net+gas): ${ethers.formatEther(balAfter-balBefore+gas)}  expected ${ethers.formatEther(plsOut)}`);
  console.log(`SLVR minted: ${ethers.formatEther(slvrAfter-slvrBefore)}  expected ${ethers.formatEther(slvrOut)}`);
  console.log((balAfter-balBefore+gas)===plsOut && (slvrAfter-slvrBefore)===slvrOut ? "\nCLAIM VALIDATED ✓ full loop works on mainnet" : "\nMISMATCH");
})().catch(e=>{console.error("ERR", e.shortMessage||e.message);process.exit(1);});
