// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ProposerRegistry
/// @notice Maintains proposer registration state and USDC proposal bond custody.
contract ProposerRegistry is AccessControl {
    using SafeERC20 for IERC20;

    /// @notice Role allowed to lock/refund/slash bonds and record performance.
    bytes32 public constant QUANTUM_ROUND_ROLE = keccak256("QUANTUM_ROUND_ROLE");

    /// @notice Canonical Arc testnet USDC address.
    IERC20 public immutable usdc;

    /// @notice Metadata and performance tracking for a registered agent.
    struct Agent {
        string name;
        address wallet;
        bool active;
        uint256 proposalCount;
        uint256 winCount;
        int256 cumulativeReturn;
    }

    /// @notice Registered agents keyed by wallet address.
    mapping(address => Agent) public agents;

    /// @notice Bond balances held in escrow for each proposer (USDC 6-decimal units).
    mapping(address => uint256) public bonds;

    /// @notice Thrown when an operation requires a registered agent.
    error AgentNotRegistered();

    /// @notice Thrown when attempting to register an already-registered agent.
    error AgentAlreadyRegistered();

    /// @notice Thrown when a required address argument is zero.
    error ZeroAddress();

    /// @notice Thrown when proposer bond balance is insufficient.
    error InsufficientBond();

    /// @notice Thrown when proposer has not granted enough USDC allowance to this registry.
    error InsufficientAllowance();

    /// @notice Emitted when a new proposer is registered.
    /// @param agent Wallet address of the registered proposer.
    /// @param name Human-readable proposer name.
    event AgentRegistered(address indexed agent, string name);

    /// @notice Emitted when a proposer is deactivated by admin.
    /// @param agent Wallet address of the proposer.
    event AgentDeactivated(address indexed agent);

    /// @notice Emitted when bond is locked for a proposer.
    /// @param proposer Proposer address.
    /// @param amount Bond amount locked.
    event BondLocked(address indexed proposer, uint256 amount);

    /// @notice Emitted when bond is refunded to proposer.
    /// @param proposer Proposer address.
    /// @param amount Bond amount refunded.
    event BondRefunded(address indexed proposer, uint256 amount);

    /// @notice Emitted when bond is slashed to treasury.
    /// @param proposer Proposer address.
    /// @param treasury Treasury receiving slashed funds.
    /// @param amount Bond amount slashed.
    event BondSlashed(address indexed proposer, address indexed treasury, uint256 amount);

    /// @notice Emitted when win statistics are recorded.
    /// @param proposer Proposer address.
    /// @param returnBps Return in basis points attributed to this win.
    event WinRecorded(address indexed proposer, int256 returnBps);

    /// @notice Deploys registry.
    /// @param usdc_ Arc USDC token address.
    /// @param initialAdmin Address granted admin and quantum-round roles.
    constructor(address usdc_, address initialAdmin) {
        if (usdc_ == address(0) || initialAdmin == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(QUANTUM_ROUND_ROLE, initialAdmin);
    }

    /// @notice Registers caller as an active proposer agent.
    /// @param name Human-readable proposer display name.
    function registerAgent(string calldata name) external {
        Agent storage agent = agents[msg.sender];
        if (agent.wallet != address(0)) revert AgentAlreadyRegistered();

        agents[msg.sender] =
            Agent({ name: name, wallet: msg.sender, active: true, proposalCount: 0, winCount: 0, cumulativeReturn: 0 });

        emit AgentRegistered(msg.sender, name);
    }

    /// @notice Deactivates a registered proposer.
    /// @param agent Proposer wallet address.
    function deactivateAgent(address agent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (agent == address(0)) revert ZeroAddress();
        Agent storage info = agents[agent];
        if (info.wallet == address(0)) revert AgentNotRegistered();

        info.active = false;
        emit AgentDeactivated(agent);
    }

    /// @notice Locks bond collateral by pulling USDC from proposer into escrow.
    /// @param proposer Proposer wallet.
    /// @param amount Bond amount to lock.
    function lockBond(address proposer, uint256 amount) external onlyRole(QUANTUM_ROUND_ROLE) {
        if (proposer == address(0)) revert ZeroAddress();
        Agent storage info = agents[proposer];
        if (info.wallet == address(0) || !info.active) revert AgentNotRegistered();

        // Proposer must have approved this contract before calling lockBond indirectly via QuantumRound.propose.
        // safeTransferFrom uses proposer (not msg.sender) intentionally: this function is onlyRole(QUANTUM_ROUND_ROLE).
        if (usdc.allowance(proposer, address(this)) < amount) revert InsufficientAllowance();
        // slither-disable-next-line arbitrary-send-erc20
        usdc.safeTransferFrom(proposer, address(this), amount);
        bonds[proposer] += amount;
        info.proposalCount += 1;

        emit BondLocked(proposer, amount);
    }

    /// @notice Refunds bond collateral from escrow back to proposer.
    /// @param proposer Proposer wallet.
    /// @param amount Bond amount to refund.
    function refundBond(address proposer, uint256 amount) external onlyRole(QUANTUM_ROUND_ROLE) {
        if (proposer == address(0)) revert ZeroAddress();
        uint256 bonded = bonds[proposer];
        if (bonded < amount) revert InsufficientBond();

        unchecked {
            bonds[proposer] = bonded - amount;
        }
        usdc.safeTransfer(proposer, amount);

        emit BondRefunded(proposer, amount);
    }

    /// @notice Slashes bond collateral and transfers it to treasury.
    /// @param proposer Proposer wallet.
    /// @param amount Bond amount to slash.
    /// @param treasury Treasury address receiving slashed funds.
    function slashBond(address proposer, uint256 amount, address treasury) external onlyRole(QUANTUM_ROUND_ROLE) {
        if (proposer == address(0) || treasury == address(0)) revert ZeroAddress();
        uint256 bonded = bonds[proposer];
        if (bonded < amount) revert InsufficientBond();

        unchecked {
            bonds[proposer] = bonded - amount;
        }
        usdc.safeTransfer(treasury, amount);

        emit BondSlashed(proposer, treasury, amount);
    }

    /// @notice Records a winning outcome for proposer analytics.
    /// @param proposer Proposer wallet.
    /// @param returnBps Return in basis points associated with the win.
    function recordWin(address proposer, int256 returnBps) external onlyRole(QUANTUM_ROUND_ROLE) {
        if (proposer == address(0)) revert ZeroAddress();
        Agent storage info = agents[proposer];
        if (info.wallet == address(0)) revert AgentNotRegistered();

        info.winCount += 1;
        info.cumulativeReturn += returnBps;

        emit WinRecorded(proposer, returnBps);
    }
}
