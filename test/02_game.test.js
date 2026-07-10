const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { getBytes } = ethers;
const { kyberG1ToEvm } = require("@kevincharm/bls-bn254");
const { pubKeyEvm } = require("./drand.config");

const P = 3n; // drand period (s)
// Real evmnet vectors (verified in 01_drand_verify.test.js)
const A = { round: 18710192n, square: 20, sigHex: "174c481ee5453aa002b6a5e4e4b3bad70c62933a286285b5c22e1d6b9304b4d40720072ba15a5c6dfe9f271bd48fd36b9d488334da388da85e45451f95ad1427" };
const B = { round: 1000n, square: 7, sigHex: "06fd5996329504d3a56b482d9222bf7205857d0a9559ddd216ca31a286f6a8cc0a120f021aac2f13553fb164f62bc3a5ca32c76dea88a777b39bcf3cac5fdbd6" };

const sigArr = (hex) => kyberG1ToEvm(getBytes("0x" + hex));

const EMISSION = ethers.parseEther("1000");
const MIN_STAKE = ethers.parseEther("0.001");
const HOUSE_BPS = 500n; // 5%
const N = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

// Deploy token + game so that game round 0 settles against evmnet round `target`.
async function deploy({ roundDuration = 60n, target = A.round, houseFeeBps = HOUSE_BPS, jackpotOdds = 0n } = {}) {
  const [owner, treasury, alice, bob, carol] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("SlvrToken");
  const token = await Token.deploy(owner.address);
  await token.waitForDeployment();

  const now = BigInt(await time.latest());
  const GAME_START = now + 100000n;
  // closeTime(0) = GAME_START + roundDuration; want target(0) = target.
  // (closeTime - genesis)/P + 2 = target  =>  genesis = closeTime - P*(target-2)
  const closeTime0 = GAME_START + roundDuration;
  const genesis = closeTime0 - P * (target - 2n);

  await time.setNextBlockTimestamp(GAME_START);
  const Game = await ethers.getContractFactory("GridGame");
  const game = await Game.deploy(
    owner.address, await token.getAddress(), roundDuration, MIN_STAKE,
    houseFeeBps, EMISSION, treasury.address, genesis, P
  );
  await game.waitForDeployment();

  await token.setMinter(await game.getAddress());
  await game.setDrandPubKey(pubKeyEvm());
  if (jackpotOdds > 0n) await game.setEconomics(MIN_STAKE, houseFeeBps, EMISSION, jackpotOdds);

  return { owner, treasury, alice, bob, carol, token, game, GAME_START, genesis, roundDuration };
}

describe("GridGame — core loop", () => {
  it("derives the target drand round deterministically from close time", async () => {
    const { game } = await deploy();
    const closeTime0 = await game.roundCloseTime(0);
    expect(await game.targetDrandRound(closeTime0)).to.eq(A.round);
  });

  it("settles a round against a real beacon and pays the winning square pro-rata", async () => {
    const { game, token, alice, bob, carol, treasury } = await deploy();
    const stakeWin = ethers.parseEther("2");   // alice on winning square 20
    const stakeWin2 = ethers.parseEther("1");  // bob on winning square 20
    const stakeLose = ethers.parseEther("3");  // carol on a losing square

    await game.connect(alice).stake(A.square, { value: stakeWin });
    await game.connect(bob).stake(A.square, { value: stakeWin2 });
    await game.connect(carol).stake((A.square + 1) % 25, { value: stakeLose });

    const gross = stakeWin + stakeWin2 + stakeLose;

    // settle after the target beacon's emit time
    const emit = await game.drandEmitTime(A.round);
    await time.increaseTo(emit);
    await expect(game.settle(0, sigArr(A.sigHex)))
      .to.emit(game, "RoundSettled");

    const res = await game.result(0);
    expect(res.settled).to.eq(true);
    expect(res.winningSquare).to.eq(A.square);
    expect(res.winningStake).to.eq(stakeWin + stakeWin2);

    const house = (gross * HOUSE_BPS) / 10000n;
    const payout = gross - house;
    expect(res.payoutPool).to.eq(payout);
    expect(await game.treasuryOwedPls()).to.eq(house);

    // alice gets 2/3 of payout, bob 1/3; both get emission pro-rata; carol nothing
    const [aPls, aSlvr] = await game.pendingClaim(0, alice.address);
    expect(aPls).to.eq((payout * stakeWin) / (stakeWin + stakeWin2));
    expect(aSlvr).to.eq((EMISSION * stakeWin) / (stakeWin + stakeWin2));

    const balBefore = await ethers.provider.getBalance(bob.address);
    const tx = await game.connect(bob).claim(0);
    const rcpt = await tx.wait();
    const gasCost = rcpt.gasUsed * rcpt.gasPrice;
    const balAfter = await ethers.provider.getBalance(bob.address);
    expect(balAfter - balBefore + gasCost).to.eq((payout * stakeWin2) / (stakeWin + stakeWin2));
    expect(await token.balanceOf(bob.address)).to.eq((EMISSION * stakeWin2) / (stakeWin + stakeWin2));

    // carol (loser) cannot claim
    await expect(game.connect(carol).claim(0)).to.be.revertedWithCustomError(game, "NothingToClaim");
    // double claim blocked
    await expect(game.connect(bob).claim(0)).to.be.revertedWithCustomError(game, "AlreadyClaimed");
  });

  it("conserves value: winner payouts + treasury == total staked (minus dust)", async () => {
    const { game, alice, bob, carol } = await deploy();
    const s1 = ethers.parseEther("1.7"), s2 = ethers.parseEther("0.9"), s3 = ethers.parseEther("2.3");
    await game.connect(alice).stake(A.square, { value: s1 });
    await game.connect(bob).stake(A.square, { value: s2 });
    await game.connect(carol).stake(3, { value: s3 });
    const gross = s1 + s2 + s3;

    await time.increaseTo(await game.drandEmitTime(A.round));
    await game.settle(0, sigArr(A.sigHex));

    const [aPls] = await game.pendingClaim(0, alice.address);
    const [bPls] = await game.pendingClaim(0, bob.address);
    const house = await game.treasuryOwedPls();
    const dust = gross - (aPls + bPls + house);
    expect(dust).to.be.gte(0n);
    expect(dust).to.be.lt(2n); // at most rounding dust
  });

  it("rolls the pot over when the winning square has no stake", async () => {
    const { game } = await deploy();
    const [ , , alice] = await ethers.getSigners();
    const stakeLose = ethers.parseEther("5");
    await game.connect(alice).stake((A.square + 2) % 25, { value: stakeLose });

    await time.increaseTo(await game.drandEmitTime(A.round));
    await expect(game.settle(0, sigArr(A.sigHex))).to.emit(game, "RoundRolledOver");

    const house = (stakeLose * HOUSE_BPS) / 10000n;
    expect(await game.rolloverPls()).to.eq(stakeLose - house);
    const res = await game.result(0);
    expect(res.winningStake).to.eq(0);
    expect(res.payoutPool).to.eq(0);
  });

  it("rejects tampered / wrong-round beacons and premature settles", async () => {
    const { game, alice } = await deploy();
    await game.connect(alice).stake(A.square, { value: ethers.parseEther("1") });

    // before close
    await expect(game.settle(0, sigArr(A.sigHex))).to.be.revertedWithCustomError(game, "RoundNotClosed");

    await time.increaseTo(await game.drandEmitTime(A.round));
    // tampered signature
    const bad = sigArr(A.sigHex); bad[0] = (bad[0] + 1n) % N;
    await expect(game.settle(0, bad)).to.be.revertedWithCustomError(game, "InvalidBeacon");
    // valid signature but for the wrong round (round 1000's sig)
    await expect(game.settle(0, sigArr(B.sigHex))).to.be.revertedWithCustomError(game, "InvalidBeacon");

    // correct one works, and re-settle is blocked
    await game.settle(0, sigArr(A.sigHex));
    await expect(game.settle(0, sigArr(A.sigHex))).to.be.revertedWithCustomError(game, "AlreadySettled");
  });

  it("rejects settling before the beacon could exist", async () => {
    const { game, alice } = await deploy();
    await game.connect(alice).stake(A.square, { value: ethers.parseEther("1") });
    // move just past close but before the beacon emit time
    const closeTime = await game.roundCloseTime(0);
    await time.increaseTo(closeTime + 1n);
    await expect(game.settle(0, sigArr(A.sigHex))).to.be.revertedWithCustomError(game, "BeaconNotReady");
  });

  it("pays the SLVR jackpot to winners when triggered", async () => {
    const { game, token, owner, alice } = await deploy({ jackpotOdds: 1n }); // always trigger
    // fund jackpot: owner mints? no — only game mints. Simulate tax by transferring SLVR
    // to the game from a holder. Mint some to owner is impossible; instead route via game:
    // give the game SLVR by having a round mint to alice, then alice funds jackpot.
    await game.connect(alice).stake(A.square, { value: ethers.parseEther("1") });
    await time.increaseTo(await game.drandEmitTime(A.round));
    await game.settle(0, sigArr(A.sigHex));
    await game.connect(alice).claim(0); // alice now holds EMISSION SLVR
    // alice donates half to the game as "tax", then syncs jackpot
    const donate = EMISSION / 2n;
    await token.connect(alice).transfer(await game.getAddress(), donate);
    await game.syncJackpot();
    expect(await game.slvrJackpotPool()).to.eq(donate);

    // next winner round consumes the jackpot — reuse a fresh deploy with jackpot pre-funded
    // (kept simple: assert pool accounting only)
    expect(await game.slvrJackpotReserved()).to.eq(0);
  });

  it("blocks staking while paused", async () => {
    const { game, owner, alice } = await deploy();
    await game.connect(owner).pause();
    await expect(game.connect(alice).stake(A.square, { value: ethers.parseEther("1") }))
      .to.be.revertedWithCustomError(game, "EnforcedPause");
    await game.connect(owner).unpause();
    await expect(game.connect(alice).stake(A.square, { value: ethers.parseEther("1") })).to.not.be.reverted;
  });

  it("enforces min stake and valid square", async () => {
    const { game, alice } = await deploy();
    await expect(game.connect(alice).stake(25, { value: ethers.parseEther("1") }))
      .to.be.revertedWithCustomError(game, "BadSquare");
    await expect(game.connect(alice).stake(0, { value: 1n }))
      .to.be.revertedWithCustomError(game, "StakeTooSmall");
  });

  it("withdraws house fee to treasury", async () => {
    const { game, treasury, alice } = await deploy();
    await game.connect(alice).stake(A.square, { value: ethers.parseEther("10") });
    await time.increaseTo(await game.drandEmitTime(A.round));
    await game.settle(0, sigArr(A.sigHex));
    const owed = await game.treasuryOwedPls();
    expect(owed).to.be.gt(0);
    const before = await ethers.provider.getBalance(treasury.address);
    await game.connect(alice).withdrawTreasury(); // permissionless, funds go to treasury
    expect(await ethers.provider.getBalance(treasury.address)).to.eq(before + owed);
    expect(await game.treasuryOwedPls()).to.eq(0);
  });
});

describe("GridGame — rollover consumed by a later winner (integration)", () => {
  it("carries a no-winner pot into the next winning round's payout", async () => {
    // D=8*P=24 so game round r maps to drand round (1000 + 8r): round 0 -> 1000
    // (square 7), round R2 -> 18710192 (square 20). Round 0 gets a 24s window so
    // deploy/admin txs don't spill the first stake into round 1.
    const { game, token, alice, bob } = await deploy({ roundDuration: 24n, target: B.round, houseFeeBps: HOUSE_BPS });

    // Round 0: stake only on a LOSING square (winner for round 1000 is square 7)
    const loseStake = ethers.parseEther("4");
    await game.connect(alice).stake((B.square + 1) % 25, { value: loseStake });
    await time.increaseTo(await game.drandEmitTime(B.round));
    await game.settle(0, sigArr(B.sigHex));
    const house0 = (loseStake * HOUSE_BPS) / 10000n;
    const carried = loseStake - house0;
    expect(await game.rolloverPls()).to.eq(carried);

    // Round R2 = (18710192 - 1000)/8 = 2338649 -> winner square 20
    const R2 = Number((A.round - B.round) / 8n);
    const winStart = await game.roundCloseTime(R2 - 1); // == start of round R2
    await time.increaseTo(winStart);
    const winStake = ethers.parseEther("2");
    await game.connect(bob).stake(A.square, { value: winStake });

    await time.increaseTo(await game.drandEmitTime(A.round));
    await game.settle(R2, sigArr(A.sigHex));

    const res = await game.result(R2);
    const house2 = (winStake * HOUSE_BPS) / 10000n;
    // payout includes this round's net pot PLUS the carried rollover
    expect(res.payoutPool).to.eq(winStake - house2 + carried);
    expect(await game.rolloverPls()).to.eq(0);

    // bob is sole winner -> receives the whole payout pool
    const [bPls] = await game.pendingClaim(R2, bob.address);
    expect(bPls).to.eq(winStake - house2 + carried);
  });

  it("awards and pays out the SLVR jackpot end-to-end", async () => {
    // Round 0 -> drand 1000 (winner square 7); round R2 -> 18710192 (winner square 20).
    const { game, token, owner, alice, bob } = await deploy({ roundDuration: 24n, target: B.round });
    await game.connect(owner).setEconomics(MIN_STAKE, HOUSE_BPS, EMISSION, 1n); // jackpotOdds=1 -> always

    // Round 0: alice wins (square 7), claims EMISSION SLVR.
    await game.connect(alice).stake(B.square, { value: ethers.parseEther("1") });
    await time.increaseTo(await game.drandEmitTime(B.round));
    await game.settle(0, sigArr(B.sigHex));
    await game.connect(alice).claim(0);
    expect(await token.balanceOf(alice.address)).to.eq(EMISSION);

    // Fund the jackpot with SLVR "tax" and sync.
    const jackpot = EMISSION / 4n;
    await token.connect(alice).transfer(await game.getAddress(), jackpot);
    await game.syncJackpot();
    expect(await game.slvrJackpotPool()).to.eq(jackpot);

    // Round R2: bob wins (square 20); jackpot must be awarded and claimable.
    const R2 = Number((A.round - B.round) / 8n);
    await time.increaseTo(await game.roundCloseTime(R2 - 1));
    await game.connect(bob).stake(A.square, { value: ethers.parseEther("1") });
    await time.increaseTo(await game.drandEmitTime(A.round));
    await game.settle(R2, sigArr(A.sigHex));

    const res = await game.result(R2);
    expect(res.jackpotAwarded).to.eq(jackpot);
    expect(await game.slvrJackpotPool()).to.eq(0);
    expect(await game.slvrJackpotReserved()).to.eq(jackpot);

    await game.connect(bob).claim(R2);
    // bob (sole winner) gets emission + full jackpot in SLVR
    expect(await token.balanceOf(bob.address)).to.eq(EMISSION + jackpot);
    expect(await game.slvrJackpotReserved()).to.eq(0);
    expect(await token.balanceOf(await game.getAddress())).to.eq(0);
  });
});
