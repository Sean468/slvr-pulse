require("dotenv").config();
const { ethers } = require("ethers");
const dep = require("../deployments/pulsechain.json");
const norm = (v) => { v=(v||"").trim(); return v.startsWith("0x")?v:"0x"+v; };
const abi = ["function stake(uint8 square) payable","function currentRoundId() view returns (uint256)","function minStake() view returns (uint256)"];
(async () => {
  const p = new ethers.JsonRpcProvider(process.env.SPEEDY_RPC);
  const w = new ethers.Wallet(norm(process.env.DEPLOYER_PK), p);
  const g = new ethers.Contract(dep.gridGame, abi, w);
  const min = await g.minStake();
  const rid0 = await g.currentRoundId();
  const fee = await p.getFeeData();
  const gasPrice = (fee.gasPrice * 13n) / 10n;
  let nonce = await p.getTransactionCount(w.address, "latest");
  console.log("round:", rid0.toString(), "staking", ethers.formatEther(min), "PLS x25 squares, nonce base", nonce);
  const txs = [];
  for (let sq = 0; sq < 25; sq++) {
    txs.push(g.stake(sq, { value: min, gasPrice, type: 0, gasLimit: 150000, nonce: nonce++ }));
  }
  const sent = await Promise.all(txs);
  console.log("sent 25 txs, last:", sent[24].hash);
  const rcpts = await Promise.all(sent.map(t => t.wait()));
  const ok = rcpts.filter(r => r.status === 1).length;
  const rid1 = await g.currentRoundId();
  console.log(`mined ${ok}/25 ok. currentRound now ${rid1} (staked into ${rid0})`);
  console.log("all in round", rid0.toString(), ":", rid1.toString() === rid0.toString() ? "round still open ✓" : "NOTE round advanced during staking");
})().catch(e=>{console.error("ERR", e.shortMessage||e.message);process.exit(1);});
