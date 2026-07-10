# slvr-pulse

A clean-room fork of the [slvr.fun](https://slvr.fun) grid-mining game onto **PulseChain**.

Every round, players stake native **PLS** across a 25-square grid. After the round
closes it is settled against a public **drand** randomness beacon; stakers on the
winning square split the round pot (minus a house fee) pro-rata and mint **SLVR**
pro-rata. A trade tax on SLVR feeds an on-chain jackpot.

## Why this isn't a copy-paste of slvr.fun

slvr.fun proves fairness with drand **quicknet**, a **BLS12-381** beacon. Verifying
that on-chain needs the **EIP-2537** precompiles — which **PulseChain does not have**
(it runs a pre-Cancun / Shanghai EVM). Probing confirms it: an `eth_call` to
precompile `0x0b` returns data on Ethereum but empty (`0x`) on PulseChain.

PulseChain *does* have the **BN254 pairing precompile (`0x08`)**. drand runs a beacon
built exactly for this: **`evmnet`** — scheme `bls-bn254-unchained-on-g1`, a 3-second,
unchained **BN254** beacon designed to be verified inside the EVM. So this fork keeps
slvr.fun's "operator-can't-cheat, publicly verifiable" trust model, just on a curve
PulseChain can actually verify.

### Randomness verification details (proven, don't change casually)

- Verifier lib: **`@kevincharm/bls-bn254` v2.0.0** (v1.x uses a Fouque–Tibouchi map that
  does **not** match drand; v2.0.0 uses the **SvdW** map that does).
- Mainnet `evmnet` DST: `BLS_SIG_BN254G1_XMD:KECCAK-256_SVDW_RO_NUL_`.
  (The library's own test vectors are from a different chain that used the `SSWU`
  label — don't conflate the two.)
- Message hashed to G1: `keccak256(round_be_uint64)`.
- The winning square is `keccak256(signature) % 25`, derived from the *verified* beacon.
- `test/01_drand_verify.test.js` proves the on-chain verifier against **live mainnet
  evmnet beacons** (rounds 1000 and 18710192) and rejects tampered inputs.

## Fairness anchor

A round closing at time `T` is settled against the **first evmnet beacon emitted after
`T`** (`targetDrandRound`, derived deterministically on-chain). That signature does not
exist while betting is open, so neither players nor the operator can predict or grind
the outcome. `settle()` is permissionless and enforces the exact target round.

## Contracts

| Contract | Role |
|---|---|
| `DrandBN254.sol` | Library + harness: verify evmnet BN254 beacons via the `0x08` pairing precompile. |
| `SlvrToken.sol` | ERC-20 SLVR. Game is the sole minter (lockable). Configurable trade tax on AMM pairs → jackpot. |
| `GridGame.sol` | 25-square rounds, PLS staking, drand-verified settlement, pull-payment winnings, rollover, SLVR emission + jackpot. |

## Build & test

```sh
npm install
npx hardhat test          # 20 passing: drand verify, game loop, token
npx hardhat run scripts/deploy.js --network pulsechainTestnet
```

`hardhat.config.js` pins `evmVersion: shanghai` — PulseChain reverts on Cancun opcodes
(MCOPY etc.).

## Status / roadmap

**Phase 1 (done):** randomness verifier, SLVR token, core game, full test suite.

**Not yet built (later phases):** off-chain **keeper** (posts evmnet beacons to `settle`),
**Next.js frontend**, **veNFT** revenue share, **LP staking**. A live keeper and a
DEX/liquidity setup are required before mainnet launch.

> ⚠️ This is a gambling contract that custodies user funds and has not been audited.
> Do not deploy to mainnet with real value without an independent audit.
