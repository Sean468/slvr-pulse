require("dotenv").config();
const { ethers } = require("ethers");
const norm = (v) => { v=(v||"").trim(); return v.startsWith("0x")?v:"0x"+v; };
const AMOUNT = ethers.parseEther(process.env.FUND_AMOUNT || "500000");
(async () => {
  const provider = new ethers.JsonRpcProvider(process.env.SPEEDY_RPC);
  const funder = new ethers.Wallet(norm(process.env.FUNDER_PK), provider);
  const to = new ethers.Wallet(norm(process.env.DEPLOYER_PK)).address;
  const fee = await provider.getFeeData();
  const gasPrice = (fee.gasPrice * 13n) / 10n; // 1.3x, legacy
  const balBefore = await provider.getBalance(to);
  console.log(`Sending ${ethers.formatEther(AMOUNT)} PLS  ${funder.address} -> ${to}`);
  console.log(`gasPrice ${ethers.formatUnits(gasPrice,"gwei")} gwei (legacy type 0)`);
  const tx = await funder.sendTransaction({ to, value: AMOUNT, gasPrice, gasLimit: 21000, type: 0 });
  console.log("tx:", tx.hash);
  const r = await tx.wait();
  console.log("mined in block", r.blockNumber, "status", r.status);
  const balAfter = await provider.getBalance(to);
  console.log("deployer balance:", ethers.formatEther(balAfter), "PLS (was", ethers.formatEther(balBefore) + ")");
})().catch(e=>{console.error("ERR", e.shortMessage||e.message);process.exit(1);});
