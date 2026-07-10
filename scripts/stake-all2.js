require("dotenv").config();
const { ethers } = require("ethers");
const dep = require("../deployments/pulsechain.json");
const norm = (v) => { v=(v||"").trim(); return v.startsWith("0x")?v:"0x"+v; };
const abi = ["function stake(uint8) payable","function currentRoundId() view returns (uint256)","function roundCloseTime(uint256) view returns (uint64)","function minStake() view returns (uint256)","function squareStake(uint256,uint8) view returns (uint256)"];
(async () => {
  const p = new ethers.JsonRpcProvider(process.env.SPEEDY_RPC);
  const w = new ethers.Wallet(norm(process.env.DEPLOYER_PK), p);
  const g = new ethers.Contract(dep.gridGame, abi, w);
  const min = await g.minStake();
  const rid = Number(await g.currentRoundId());
  const close = Number(await g.roundCloseTime(rid));
  const now = (await p.getBlock("latest")).timestamp;
  console.log(`round ${rid}, ${close-now}s left, staking ${ethers.formatEther(min)} PLS x25 sequentially`);
  const fee = await p.getFeeData();
  const gasPrice = (fee.gasPrice * 15n) / 10n;
  let nonce = await p.getTransactionCount(w.address, "latest");
  const hashes = [];
  for (let s = 0; s < 25; s++) {
    const t = await g.stake(s, { value: min, gasPrice, type: 0, gasLimit: 150000, nonce: nonce++ });
    hashes.push(t.hash);
  }
  console.log(`sent 25 (nonces from ${nonce-25}). last ${hashes[24]}`);
  // poll coverage in the same round for up to 90s
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    let covered = 0;
    for (let s = 0; s < 25; s++) if ((await g.squareStake(rid, s)) > 0n) covered++;
    const cr = Number(await g.currentRoundId());
    process.stdout.write(`\rcovered ${covered}/25 (round now ${cr})   `);
    if (covered === 25) { console.log(`\nALL 25 COVERED in round ${rid}`); return; }
    if (cr > rid && covered < 25) { console.log(`\nround advanced with only ${covered}/25 — partial`); return; }
  }
  console.log("\ntimeout waiting for full coverage");
})().catch(e=>{console.error("ERR", e.shortMessage||e.message);process.exit(1);});
