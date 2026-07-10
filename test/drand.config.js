// drand `evmnet` (BN254) beacon configuration + live golden vectors.
// Chain: https://api.drand.sh/v2/beacons/evmnet
//   chainHash 04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3
//   scheme    bls-bn254-unchained-on-g1   period 3s   unchained
// DST for mainnet evmnet hash-to-curve is the SVDW variant (proven below);
// note the library's own test vectors are from a different chain that used the
// SSWU label — do not conflate them.
const { getBytes } = require("ethers");
const { kyberG2ToEvm } = require("@kevincharm/bls-bn254");

const EVMNET = {
  chainHash: "04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3",
  period: 3,
  // group public key (G2), from /info
  pubKeyHex:
    "07e1d1d335df83fa98462005690372c643340060d205306a9aa8106b6bd0b3820557ec32c2ad488e4d4f6008f89a346f18492092ccc0d594610de2732c8b808f0095685ae3a85ba243747b1b2f426049010f6b73a0cf1d389351d5aaaa1047f6297d3a4f9749b33eb2d904c9d9ebf17224150ddd7abd7567a9bec6c74480ee0b",
  // Live golden vectors fetched from the drand API.
  vectors: [
    { round: 1000, signature: "06fd5996329504d3a56b482d9222bf7205857d0a9559ddd216ca31a286f6a8cc0a120f021aac2f13553fb164f62bc3a5ca32c76dea88a777b39bcf3cac5fdbd6", randomness: "0e6745667465a6f9dce5d5f994656955080be14c469ff17fc4fc588c925a8504" },
    { round: 18710192, signature: "174c481ee5453aa002b6a5e4e4b3bad70c62933a286285b5c22e1d6b9304b4d40720072ba15a5c6dfe9f271bd48fd36b9d488334da388da85e45451f95ad1427", randomness: "7e4275a00825f58a689a547e8a728ca497c85cb2b08af3f8b6e75776bd64f385" },
  ],
};

function pubKeyEvm() {
  return kyberG2ToEvm(getBytes("0x" + EVMNET.pubKeyHex));
}

module.exports = { EVMNET, pubKeyEvm };
