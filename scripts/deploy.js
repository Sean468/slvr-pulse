// Deploys SlvrToken + GridGame configured for drand evmnet on PulseChain.
// Usage: npx hardhat run scripts/deploy.js --network pulsechain   (or pulsechainTestnet)
const hre = require("hardhat");
const { ethers } = hre;
const { EVMNET, pubKeyEvm } = require("../test/drand.config");

// --- deploy parameters (edit before mainnet) ---
const PARAMS = {
  roundDuration: 300n,                      // 5-minute rounds (gas-economical settling)
  minStake: ethers.parseEther("10000"),     // 10,000 PLS min stake (~$0.30)
  houseFeeBps: 300,                         // 3% house fee
  emissionPerRound: ethers.parseEther("1000"), // SLVR minted to winners / round
  taxBps: 300,                              // 3% SLVR trade tax -> jackpot
  jackpotOdds: 50n,                         // ~1-in-50 settled rounds pay jackpot
  // drand evmnet (mainnet League of Entropy)
  drandGenesis: 1727521075n,
  drandPeriod: 3n,
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY || deployer.address;
  console.log("deployer:", deployer.address, "treasury:", treasury);

  const token = await (await ethers.getContractFactory("SlvrToken")).deploy(deployer.address);
  await token.waitForDeployment();
  console.log("SlvrToken:", await token.getAddress());

  const game = await (await ethers.getContractFactory("GridGame")).deploy(
    deployer.address, await token.getAddress(), PARAMS.roundDuration, PARAMS.minStake,
    PARAMS.houseFeeBps, PARAMS.emissionPerRound, treasury,
    PARAMS.drandGenesis, PARAMS.drandPeriod
  );
  await game.waitForDeployment();
  console.log("GridGame:", await game.getAddress());

  // Wire everything up.
  await (await token.setMinter(await game.getAddress())).wait();
  await (await token.setTaxRecipient(await game.getAddress())).wait();
  await (await token.setTaxBps(PARAMS.taxBps)).wait();
  await (await game.setDrandPubKey(pubKeyEvm())).wait();
  await (await game.setEconomics(PARAMS.minStake, PARAMS.houseFeeBps, PARAMS.emissionPerRound, PARAMS.jackpotOdds)).wait();

  // Persist deployment for the keeper + frontend.
  const fs = require("fs");
  const path = require("path");
  const out = {
    network: "pulsechain",
    chainId: 369,
    slvrToken: await token.getAddress(),
    gridGame: await game.getAddress(),
    treasury,
    params: {
      roundDuration: Number(PARAMS.roundDuration),
      minStake: PARAMS.minStake.toString(),
      houseFeeBps: PARAMS.houseFeeBps,
      emissionPerRound: PARAMS.emissionPerRound.toString(),
      taxBps: PARAMS.taxBps,
      jackpotOdds: Number(PARAMS.jackpotOdds),
      drandGenesis: Number(PARAMS.drandGenesis),
      drandPeriod: Number(PARAMS.drandPeriod),
    },
    evmnetChainHash: EVMNET.chainHash,
    deployedAt: new Date().toISOString(),
    gameStart: Number(await game.gameStart()),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "pulsechain.json"), JSON.stringify(out, null, 2));
  console.log("\nWired. Saved deployments/pulsechain.json");
  console.log(out);
  console.log("NEXT (manual, when ready): token.lockMinter(); game.lockDrandPubKey();");
}

main().catch((e) => { console.error(e); process.exit(1); });
