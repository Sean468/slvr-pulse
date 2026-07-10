require("dotenv").config();
const { ethers } = require("ethers");
const norm = (v) => { v=(v||"").trim(); return v.startsWith("0x")?v:"0x"+v; };
(async () => {
  const provider = new ethers.JsonRpcProvider(process.env.SPEEDY_RPC);
  const net = await provider.getNetwork();
  console.log("chainId:", net.chainId.toString(), "(expect 369)");
  const bn = await provider.getBlockNumber();
  console.log("block:", bn);
  const deployer = new ethers.Wallet(norm(process.env.DEPLOYER_PK), provider);
  const funder = new ethers.Wallet(norm(process.env.FUNDER_PK), provider);
  const db = await provider.getBalance(deployer.address);
  const fb = await provider.getBalance(funder.address);
  console.log("DEPLOYER (pk119):", deployer.address, "balance:", ethers.formatEther(db), "PLS");
  console.log("FUNDER (treasured):", funder.address, "balance:", ethers.formatEther(fb), "PLS");
  const gp = await provider.getFeeData();
  console.log("gasPrice:", gp.gasPrice ? ethers.formatUnits(gp.gasPrice,"gwei")+" gwei" : "n/a");
})().catch(e=>{console.error("ERR", e.shortMessage||e.message);process.exit(1);});
