// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title  SlvrToken (SLVR)
/// @notice Reward token for the grid-mining game. Emitted only through gameplay
///         (no presale/insider allocation): the game contract is the sole minter.
///         A configurable tax on DEX trades accrues in-contract and is forwarded
///         to the jackpot recipient.
contract SlvrToken is ERC20, Ownable2Step {
    /// @notice Authorized minter (the GridGame). Set once, then frozen.
    address public minter;
    bool public minterLocked;

    /// @notice Basis points (1e4) taken on transfers to/from an AMM pair.
    uint16 public taxBps;
    uint16 public constant MAX_TAX_BPS = 1000; // hard cap 10%

    /// @notice Where accrued tax is forwarded (the game's jackpot sink).
    address public taxRecipient;

    /// @notice AMM pairs that trigger tax on buy/sell.
    mapping(address => bool) public isAmmPair;
    /// @notice Addresses exempt from tax (router, game, treasury, owner...).
    mapping(address => bool) public isTaxExempt;

    event MinterSet(address indexed minter);
    event MinterLocked();
    event TaxBpsSet(uint16 bps);
    event TaxRecipientSet(address indexed recipient);
    event AmmPairSet(address indexed pair, bool isPair);
    event TaxExemptSet(address indexed account, bool exempt);
    event TaxAccrued(uint256 amount);
    event TaxDistributed(address indexed to, uint256 amount);

    error NotMinter();
    error MinterAlreadySet();
    error MinterIsLocked();
    error ZeroAddress();
    error TaxTooHigh();

    constructor(address initialOwner)
        ERC20("SLVR", "SLVR")
        Ownable(initialOwner)
    {
        isTaxExempt[initialOwner] = true;
        isTaxExempt[address(this)] = true;
    }

    // --- Minting (game only) ---

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter();
        _;
    }

    /// @notice Set the game as the sole minter. Callable once (until locked).
    function setMinter(address newMinter) external onlyOwner {
        if (minterLocked) revert MinterIsLocked();
        if (newMinter == address(0)) revert ZeroAddress();
        if (minter != address(0)) revert MinterAlreadySet();
        minter = newMinter;
        isTaxExempt[newMinter] = true;
        emit MinterSet(newMinter);
    }

    /// @notice Permanently freeze the minter so it can never be changed.
    function lockMinter() external onlyOwner {
        if (minter == address(0)) revert ZeroAddress();
        minterLocked = true;
        emit MinterLocked();
    }

    /// @notice Mint SLVR emissions. Only the game may call.
    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    // --- Tax configuration ---

    function setTaxBps(uint16 bps) external onlyOwner {
        if (bps > MAX_TAX_BPS) revert TaxTooHigh();
        taxBps = bps;
        emit TaxBpsSet(bps);
    }

    function setTaxRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        taxRecipient = recipient;
        isTaxExempt[recipient] = true;
        emit TaxRecipientSet(recipient);
    }

    function setAmmPair(address pair, bool _isPair) external onlyOwner {
        if (pair == address(0)) revert ZeroAddress();
        isAmmPair[pair] = _isPair;
        emit AmmPairSet(pair, _isPair);
    }

    function setTaxExempt(address account, bool exempt) external onlyOwner {
        isTaxExempt[account] = exempt;
        emit TaxExemptSet(account, exempt);
    }

    // --- Taxed transfer hook (OZ v5 _update override) ---

    function _update(address from, address to, uint256 value) internal override {
        // Skip tax on mint/burn and when either side is exempt or no pair involved.
        if (
            from == address(0) ||
            to == address(0) ||
            taxBps == 0 ||
            isTaxExempt[from] ||
            isTaxExempt[to] ||
            !(isAmmPair[from] || isAmmPair[to])
        ) {
            super._update(from, to, value);
            return;
        }

        uint256 tax = (value * taxBps) / 10_000;
        if (tax > 0) {
            super._update(from, address(this), tax);
            emit TaxAccrued(tax);
        }
        super._update(from, to, value - tax);
    }

    /// @notice Forward accrued tax (held as SLVR by this contract) to the jackpot.
    ///         Permissionless: anyone may poke it; funds can only go to taxRecipient.
    function distributeTax() external returns (uint256 amount) {
        address recipient = taxRecipient;
        if (recipient == address(0)) revert ZeroAddress();
        amount = balanceOf(address(this));
        if (amount > 0) {
            super._update(address(this), recipient, amount);
            emit TaxDistributed(recipient, amount);
        }
    }
}
