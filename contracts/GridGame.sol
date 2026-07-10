// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {DrandBN254} from "./DrandBN254.sol";
import {SlvrToken} from "./SlvrToken.sol";

/// @title  GridGame
/// @notice On-chain grid-mining game (slvr.fun mechanic, PulseChain fork).
///         Each fixed-length round, players stake native PLS on a 25-square grid.
///         After the round closes it is settled against the FIRST drand `evmnet`
///         beacon emitted after close — a value nobody could know while betting
///         was open. The winning square = keccak256(signature) % 25; stakers on
///         that square split the round pot (minus house fee) pro-rata and mint
///         SLVR pro-rata. Rounds with no winner roll their pot forward.
/// @dev    Randomness fairness rests entirely on DrandBN254.verify + the
///         deterministic target-round derivation; see DrandBN254.sol.
contract GridGame is Ownable2Step, ReentrancyGuard, Pausable {
    uint256 public constant SQUARES = 25;
    uint256 public constant BPS = 10_000;

    // --- drand evmnet timing (mainnet: genesis 1727521075, period 3s) ---
    // Immutable, set at deploy. Only gate settlement timing + target-round
    // derivation; the group public key is the actual security anchor.
    uint64 public immutable drandGenesis;
    uint64 public immutable drandPeriod;

    SlvrToken public immutable slvr;

    /// @notice Group public key (G2) of the evmnet beacon, EVM-encoded [x1,x0,y1,y0].
    uint256[4] public drandPubKey;
    bool public pubKeyLocked;

    // --- round timing ---
    uint64 public immutable gameStart;
    uint64 public immutable roundDuration;

    // --- economics ---
    uint256 public minStake;
    uint16 public houseFeeBps; // to treasury, on gross pot at settle
    uint256 public emissionPerRound; // SLVR minted to winners of a settled round
    /// @notice 1-in-N chance a settled round also pays the SLVR jackpot (0 = off).
    uint256 public jackpotOdds;

    address public treasury;
    uint256 public treasuryOwedPls;

    /// @notice Pot carried from prior no-winner rounds, added to the next payout.
    uint256 public rolloverPls;

    /// @notice SLVR available to award as jackpot (funded by token trade tax).
    uint256 public slvrJackpotPool;
    /// @notice SLVR awarded to winners but not yet claimed (reserved, not re-awardable).
    uint256 public slvrJackpotReserved;

    struct RoundResult {
        bool settled;
        uint8 winningSquare;
        uint64 drandRound;
        uint256 grossPot;
        uint256 payoutPool; // PLS split among winners (incl. rollover in)
        uint256 winningStake; // total PLS on the winning square
        uint256 slvrEmission; // SLVR split among winners
        uint256 jackpotAwarded; // SLVR jackpot split among winners
    }

    // roundId => per-square total stake
    mapping(uint256 => uint256[25]) private _squareStake;
    // roundId => user => per-square stake
    mapping(uint256 => mapping(address => uint256[25])) private _userStake;
    // roundId => gross pot (sum of all squares)
    mapping(uint256 => uint256) public roundPot;
    // roundId => settlement result
    mapping(uint256 => RoundResult) public result;
    // roundId => user => claimed?
    mapping(uint256 => mapping(address => bool)) public claimed;

    event Staked(uint256 indexed roundId, address indexed player, uint8 indexed square, uint256 amount);
    event RoundSettled(uint256 indexed roundId, uint8 winningSquare, uint64 drandRound, uint256 payoutPool, uint256 slvrEmission, uint256 jackpotAwarded);
    event RoundRolledOver(uint256 indexed roundId, uint256 amountCarried);
    event Claimed(uint256 indexed roundId, address indexed player, uint256 plsOut, uint256 slvrOut, uint256 jackpotOut);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event JackpotSynced(uint256 pool);
    event ParamsUpdated();

    error BadSquare();
    error StakeTooSmall();
    error RoundNotClosed();
    error BeaconNotReady();
    error AlreadySettled();
    error NotSettled();
    error InvalidBeacon();
    error NothingToClaim();
    error AlreadyClaimed();
    error ZeroAddress();
    error PubKeyIsLocked();
    error FeeTooHigh();

    constructor(
        address initialOwner,
        SlvrToken slvr_,
        uint64 roundDuration_,
        uint256 minStake_,
        uint16 houseFeeBps_,
        uint256 emissionPerRound_,
        address treasury_,
        uint64 drandGenesis_,
        uint64 drandPeriod_
    ) Ownable(initialOwner) {
        if (address(slvr_) == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (drandPeriod_ == 0) revert ZeroAddress();
        if (roundDuration_ < drandPeriod_) revert RoundNotClosed();
        if (houseFeeBps_ > 2000) revert FeeTooHigh(); // hard cap 20%
        slvr = slvr_;
        gameStart = uint64(block.timestamp);
        roundDuration = roundDuration_;
        minStake = minStake_;
        houseFeeBps = houseFeeBps_;
        emissionPerRound = emissionPerRound_;
        treasury = treasury_;
        drandGenesis = drandGenesis_;
        drandPeriod = drandPeriod_;
    }

    // --- views ---

    function currentRoundId() public view returns (uint256) {
        return (block.timestamp - gameStart) / roundDuration;
    }

    function roundCloseTime(uint256 roundId) public view returns (uint64) {
        return gameStart + uint64(roundId + 1) * roundDuration;
    }

    /// @notice The evmnet round used to settle a round closing at `closeTime`:
    ///         the first beacon emitted strictly after close. Deterministic and
    ///         unknowable while betting is open (fairness anchor).
    function targetDrandRound(uint64 closeTime) public view returns (uint64) {
        // drand round n is emitted at genesis + (n-1)*period (round 1 at genesis).
        // Smallest n with emit_time(n) > closeTime.
        uint64 elapsed = closeTime - drandGenesis;
        return elapsed / drandPeriod + 2;
    }

    function drandEmitTime(uint64 round) public view returns (uint64) {
        return drandGenesis + (round - 1) * drandPeriod;
    }

    function squareStake(uint256 roundId, uint8 square) external view returns (uint256) {
        return _squareStake[roundId][square];
    }

    function userStake(uint256 roundId, address user, uint8 square) external view returns (uint256) {
        return _userStake[roundId][user][square];
    }

    /// @notice PLS/SLVR a user can currently claim for a settled round.
    function pendingClaim(uint256 roundId, address user)
        public
        view
        returns (uint256 plsOut, uint256 slvrOut, uint256 jackpotOut)
    {
        RoundResult storage R = result[roundId];
        if (!R.settled || R.winningStake == 0 || claimed[roundId][user]) return (0, 0, 0);
        uint256 s = _userStake[roundId][user][R.winningSquare];
        if (s == 0) return (0, 0, 0);
        plsOut = (R.payoutPool * s) / R.winningStake;
        slvrOut = (R.slvrEmission * s) / R.winningStake;
        jackpotOut = (R.jackpotAwarded * s) / R.winningStake;
    }

    // --- staking ---

    /// @notice Stake native PLS on `square` in the currently-open round.
    function stake(uint8 square) external payable nonReentrant whenNotPaused {
        if (square >= SQUARES) revert BadSquare();
        if (msg.value < minStake) revert StakeTooSmall();
        uint256 r = currentRoundId();
        _squareStake[r][square] += msg.value;
        _userStake[r][msg.sender][square] += msg.value;
        roundPot[r] += msg.value;
        emit Staked(r, msg.sender, square, msg.value);
    }

    // --- settlement ---

    /// @notice Settle a closed round against its target drand beacon. Permissionless.
    /// @param roundId round to settle (must be fully closed)
    /// @param signature evmnet G1 beacon signature for the target round ([x,y])
    function settle(uint256 roundId, uint256[2] calldata signature)
        external
        nonReentrant
    {
        RoundResult storage R = result[roundId];
        if (R.settled) revert AlreadySettled();

        uint64 closeTime = roundCloseTime(roundId);
        if (block.timestamp < closeTime) revert RoundNotClosed();

        uint64 dRound = targetDrandRound(closeTime);
        if (block.timestamp < drandEmitTime(dRound)) revert BeaconNotReady();

        if (!DrandBN254.verify(dRound, drandPubKey, signature)) revert InvalidBeacon();

        // Derive the winning square from the verified signature.
        uint256 seed = uint256(keccak256(abi.encodePacked(signature[0], signature[1])));
        uint8 winning = uint8(seed % SQUARES);

        uint256 gross = roundPot[roundId];
        uint256 house = (gross * houseFeeBps) / BPS;
        uint256 toWinners = gross - house;
        uint256 wStake = _squareStake[roundId][winning];

        R.settled = true;
        R.winningSquare = winning;
        R.drandRound = dRound;
        R.grossPot = gross;
        R.winningStake = wStake;

        if (house > 0) treasuryOwedPls += house;

        if (wStake == 0) {
            // No winner: carry the winners' portion forward.
            rolloverPls += toWinners;
            emit RoundRolledOver(roundId, toWinners);
            emit RoundSettled(roundId, winning, dRound, 0, 0, 0);
            return;
        }

        uint256 payout = toWinners + rolloverPls;
        rolloverPls = 0;
        R.payoutPool = payout;
        R.slvrEmission = emissionPerRound;

        // Jackpot: 1-in-jackpotOdds settled rounds also pay the SLVR jackpot.
        if (jackpotOdds > 0 && (seed / SQUARES) % jackpotOdds == 0 && slvrJackpotPool > 0) {
            uint256 jack = slvrJackpotPool;
            slvrJackpotPool = 0;
            slvrJackpotReserved += jack;
            R.jackpotAwarded = jack;
        }

        emit RoundSettled(roundId, winning, dRound, payout, R.slvrEmission, R.jackpotAwarded);
    }

    // --- claiming ---

    function claim(uint256 roundId) external nonReentrant {
        RoundResult storage R = result[roundId];
        if (!R.settled) revert NotSettled();
        if (claimed[roundId][msg.sender]) revert AlreadyClaimed();
        uint256 s = _userStake[roundId][msg.sender][R.winningSquare];
        if (s == 0 || R.winningStake == 0) revert NothingToClaim();

        claimed[roundId][msg.sender] = true;

        uint256 plsOut = (R.payoutPool * s) / R.winningStake;
        uint256 slvrOut = (R.slvrEmission * s) / R.winningStake;
        uint256 jackOut = (R.jackpotAwarded * s) / R.winningStake;

        if (jackOut > 0) {
            slvrJackpotReserved -= jackOut;
            require(slvr.transfer(msg.sender, jackOut), "jackpot xfer");
        }
        if (slvrOut > 0) {
            slvr.mint(msg.sender, slvrOut);
        }
        if (plsOut > 0) {
            (bool ok, ) = msg.sender.call{value: plsOut}("");
            require(ok, "PLS xfer");
        }
        emit Claimed(roundId, msg.sender, plsOut, slvrOut, jackOut);
    }

    // --- jackpot funding ---

    /// @notice Absorb SLVR sent to this contract (trade tax) into the awardable
    ///         jackpot pool. Permissionless.
    function syncJackpot() external {
        uint256 held = slvr.balanceOf(address(this));
        // held = awardable pool + reserved-for-claims. Anything above reserved is new tax.
        uint256 pool = held - slvrJackpotReserved;
        slvrJackpotPool = pool;
        emit JackpotSynced(pool);
    }

    // --- admin ---

    function setDrandPubKey(uint256[4] calldata pk) external onlyOwner {
        if (pubKeyLocked) revert PubKeyIsLocked();
        drandPubKey = pk;
        emit ParamsUpdated();
    }

    function lockDrandPubKey() external onlyOwner {
        pubKeyLocked = true;
        emit ParamsUpdated();
    }

    function setEconomics(
        uint256 minStake_,
        uint16 houseFeeBps_,
        uint256 emissionPerRound_,
        uint256 jackpotOdds_
    ) external onlyOwner {
        if (houseFeeBps_ > 2000) revert FeeTooHigh();
        minStake = minStake_;
        houseFeeBps = houseFeeBps_;
        emissionPerRound = emissionPerRound_;
        jackpotOdds = jackpotOdds_;
        emit ParamsUpdated();
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit ParamsUpdated();
    }

    function withdrawTreasury() external nonReentrant {
        uint256 amount = treasuryOwedPls;
        treasuryOwedPls = 0;
        address to = treasury;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "treasury xfer");
        emit TreasuryWithdrawn(to, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
