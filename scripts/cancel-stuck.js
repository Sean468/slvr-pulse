require("dotenv").config();
const { ethers } = require("ethers");
const norm=(v)=>{v=(v||"").trim();return v.startsWith("0x")?v:"0x"+v;};
(async()=>{
  const p=new ethers.JsonRpcProvider(process.env.SPEEDY_RPC);
  const w=new ethers.Wallet(norm(process.env.DEPLOYER_PK),p);
  const latest=await p.getTransactionCount(w.address,"latest");
  const pending=await p.getTransactionCount(w.address,"pending");
  if(pending<=latest){console.log("no stuck txs");return;}
  const fee=await p.getFeeData();
  const gasPrice=(fee.gasPrice*30n)/10n; // 3x to force replacement
  console.log(`cancelling nonces ${latest}..${pending-1} at ${ethers.formatUnits(gasPrice,"gwei")} gwei`);
  const txs=[];
  for(let n=latest;n<pending;n++){
    txs.push(w.sendTransaction({to:w.address,value:0,gasPrice,gasLimit:21000,type:0,nonce:n}));
  }
  const sent=await Promise.all(txs);
  console.log("sent",sent.length,"cancels; waiting...");
  await Promise.all(sent.map(t=>t.wait()));
  const nl=await p.getTransactionCount(w.address,"latest");
  const np=await p.getTransactionCount(w.address,"pending");
  console.log("done. nonce latest:",nl,"pending:",np,"stuck:",np-nl);
})().catch(e=>{console.error("ERR",e.shortMessage||e.message);process.exit(1);});
