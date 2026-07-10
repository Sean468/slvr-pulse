const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getBytes, sha256, hexlify } = ethers;
const { kyberG1ToEvm } = require("@kevincharm/bls-bn254");
const { EVMNET, pubKeyEvm } = require("./drand.config");

// Proves the on-chain BN254 verifier accepts real drand `evmnet` beacons on a
// Shanghai-EVM chain (PulseChain target), and rejects tampered inputs. This is
// the security foundation of the game's randomness; nothing else may be trusted
// until this passes.
describe("DrandBN254 — evmnet BN254 verification", () => {
  let harness, pk;

  before(async () => {
    harness = await (await ethers.getContractFactory("DrandBN254Harness")).deploy();
    await harness.waitForDeployment();
    pk = pubKeyEvm();
  });

  it("verifies live mainnet evmnet beacons via verify(round)", async () => {
    for (const { round, signature } of EVMNET.vectors) {
      const sig = kyberG1ToEvm(getBytes("0x" + signature));
      expect(await harness.verify(round, pk, sig), `round ${round}`).to.eq(true);
    }
  });

  it("matches drand's published randomness = sha256(signature)", async () => {
    for (const { signature, randomness } of EVMNET.vectors) {
      expect(sha256(getBytes("0x" + signature))).to.eq(hexlify("0x" + randomness));
    }
  });

  it("rejects a signature verified against the wrong round", async () => {
    const { signature } = EVMNET.vectors[0]; // round 1000's sig
    const sig = kyberG1ToEvm(getBytes("0x" + signature));
    expect(await harness.verify(1001, pk, sig)).to.eq(false);
  });

  it("rejects a tampered signature", async () => {
    const { round, signature } = EVMNET.vectors[0];
    const sig = kyberG1ToEvm(getBytes("0x" + signature));
    sig[0] = (sig[0] + 1n) %
      21888242871839275222246405745257275088696311157297823662689037894645226208583n;
    expect(await harness.verify(round, pk, sig)).to.eq(false);
  });

  it("rejects a valid beacon under a different (wrong) group key", async () => {
    const { round, signature } = EVMNET.vectors[0];
    const sig = kyberG1ToEvm(getBytes("0x" + signature));
    const badPk = [...pk];
    badPk[0] = (badPk[0] + 1n) %
      21888242871839275222246405745257275088696311157297823662689037894645226208583n;
    // Wrong key is almost certainly off-curve -> precompile call fails -> false.
    expect(await harness.verify(round, badPk, sig)).to.eq(false);
  });
});
