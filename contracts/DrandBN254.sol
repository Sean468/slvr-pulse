// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BLS} from "@kevincharm/bls-bn254/contracts/BLS.sol";

/// @title  DrandBN254
/// @notice On-chain verifier for drand `evmnet` beacons (scheme
///         bls-bn254-unchained-on-g1). Signatures live in G1, the group public
///         key in G2, verified via the alt_bn128 pairing precompile (0x08) —
///         available on PulseChain (unlike EIP-2537 / BLS12-381).
/// @dev    DST and message construction are pinned against a live evmnet
///         golden vector in the test suite; do not change without re-proving.
library DrandBN254 {
    /// @dev drand evmnet domain separation tag for hash-to-curve.
    bytes internal constant DST =
        bytes("BLS_SIG_BN254G1_XMD:KECCAK-256_SVDW_RO_NUL_");

    /// @notice Hash a drand round number to a G1 point exactly as evmnet signs it.
    /// @param round drand round number
    /// @return G1 point [x, y]
    function roundToG1(uint64 round) internal view returns (uint256[2] memory) {
        bytes memory message = abi.encodePacked(keccak256(abi.encodePacked(round)));
        return BLS.hashToPoint(DST, message);
    }

    /// @notice Verify an evmnet beacon signature for `round` under `pubKey`.
    /// @param round drand round number
    /// @param pubKey group public key in G2 (EVM order: [x1,x0,y1,y0])
    /// @param signature beacon signature in G1 ([x,y])
    function verify(
        uint64 round,
        uint256[4] memory pubKey,
        uint256[2] memory signature
    ) internal view returns (bool) {
        uint256[2] memory message = roundToG1(round);
        (bool pairingOk, bool callOk) = BLS.verifySingle(signature, pubKey, message);
        return pairingOk && callOk;
    }
}

/// @dev Test harness exposing the library externally.
contract DrandBN254Harness {
    function roundToG1(uint64 round) external view returns (uint256[2] memory) {
        return DrandBN254.roundToG1(round);
    }

    function verify(
        uint64 round,
        uint256[4] memory pubKey,
        uint256[2] memory signature
    ) external view returns (bool) {
        return DrandBN254.verify(round, pubKey, signature);
    }

    /// @notice Sweep helper: hash with an arbitrary DST + message for discovery.
    function hashToPoint(bytes memory dst, bytes memory message)
        external
        view
        returns (uint256[2] memory)
    {
        return BLS.hashToPoint(dst, message);
    }

    function verifySingle(
        uint256[2] memory signature,
        uint256[4] memory pubKey,
        uint256[2] memory message
    ) external view returns (bool pairingOk, bool callOk) {
        return BLS.verifySingle(signature, pubKey, message);
    }
}
