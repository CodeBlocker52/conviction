// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title QuantumLP
/// @notice Phase A LP stub that custodizes USDC deposits for future liquidity programs.
/// @dev Seeding in Phase A is handled by QuantumRound.protocolLiquiditySeed.
contract QuantumLP is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Role used by QuantumRound integration hooks.
    bytes32 public constant QUANTUM_ROUND_ROLE = keccak256("QUANTUM_ROUND_ROLE");

    /// @notice Arc testnet USDC token address.
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    /// @notice User LP balances in USDC 6-decimal units.
    mapping(address user => uint256 balance) public lpBalances;

    /// @notice Aggregate LP deposits.
    uint256 public totalLP;

    /// @notice Round settlement gate flag for withdrawals.
    bool public withdrawalsEnabled;

    /// @notice Canonical USDC token instance.
    IERC20 public immutable usdc;

    /// @notice Thrown when amount argument is zero.
    error ZeroAmount();

    /// @notice Thrown when address argument is zero.
    error ZeroAddress();

    /// @notice Thrown when user has no LP balance.
    error NoBalance();

    /// @notice Thrown when withdrawals are not yet enabled.
    error WithdrawalsNotEnabled();

    /// @notice Emitted when LP deposits USDC.
    event LPDeposited(address indexed provider, uint256 amount);

    /// @notice Emitted when LP withdraws USDC.
    event LPWithdrawn(address indexed provider, uint256 amount);

    /// @notice Emitted when withdrawal mode is updated.
    event WithdrawalsEnabledSet(bool enabled);

    /// @notice Deploys LP stub.
    /// @param initialAdmin Address granted admin + quantum-round roles.
    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) revert ZeroAddress();

        usdc = IERC20(USDC);

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(QUANTUM_ROUND_ROLE, initialAdmin);
    }

    /// @notice Deposits USDC into LP stub custody.
    /// @param amount USDC amount in 6-decimal base units.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        lpBalances[msg.sender] += amount;
        totalLP += amount;

        emit LPDeposited(msg.sender, amount);
    }

    /// @notice Withdraws full LP balance when withdrawals are enabled after settlement.
    function withdraw() external nonReentrant {
        if (!withdrawalsEnabled) revert WithdrawalsNotEnabled();

        uint256 amount = lpBalances[msg.sender];
        if (amount == 0) revert NoBalance();

        lpBalances[msg.sender] = 0;
        totalLP -= amount;
        usdc.safeTransfer(msg.sender, amount);

        emit LPWithdrawn(msg.sender, amount);
    }

    /// @notice Enables or disables LP withdrawals.
    /// @dev TODO(Phase B): replace global toggle with per-round withdrawal accounting and queueing.
    /// @param enabled New withdrawal enabled flag.
    function setWithdrawalsEnabled(bool enabled) external onlyRole(QUANTUM_ROUND_ROLE) {
        withdrawalsEnabled = enabled;
        emit WithdrawalsEnabledSet(enabled);
    }
}
