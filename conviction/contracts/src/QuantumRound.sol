// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IProposalMarket } from "./IProposalMarket.sol";
import { ProposalTokens, ProposalTokenImpl } from "./ProposalTokens.sol";
import { ProposerRegistry } from "./ProposerRegistry.sol";

/// @title QuantumRound
/// @notice Core Wavefund Phase A contract: rounds, proposals, deposits, trading delegation, collapse, settlement, redemption.
contract QuantumRound is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Keeper role for round lifecycle operations.
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    /// @notice Vault role allowed to cancel a round after a slippage breach.
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    /// @notice Arc testnet USDC address (6 decimals).
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    /// @notice Default proposer bond in USDC base units (1 USDC).
    uint256 public constant DEFAULT_BOND = 1_000_000;

    /// @notice USDC seed amount per proposal market. Configurable by admin; default 500 USDC.
    uint256 public initialLiquidityPerProposal = 500_000_000;

    /// @notice Maximum number of proposals allowed in one round (including status quo).
    uint256 public constant MAX_PROPOSALS_PER_ROUND = 10;

    /// @notice Price threshold below which proposal is considered spam for slashing logic.
    uint256 public constant SPAM_THRESHOLD_PRICE = 0.2e18;

    /// @notice Winner margin above status quo in 1e18 fixed-point.
    uint256 public constant EPSILON = 0.005e18;

    /// @notice Performance fee charged on positive performance in basis points.
    uint16 public constant PERFORMANCE_FEE = 1_000;

    /// @notice Share of performance fee paid to proposer in basis points.
    uint16 public constant PROPOSER_SHARE = 5_000;

    /// @notice Delay after evaluation end after which anyone can settle at par.
    uint256 public constant EMERGENCY_SETTLE_DELAY = 2 days;

    /// @notice Converts six-decimal credits into eighteen-decimal outcome-token units.
    uint256 public constant COMPLETE_SET_SCALE = 1e12;

    /// @notice Allocation representation for target portfolio mix.
    struct Allocation {
        uint16 tEthBps;
    }

    /// @notice Proposal metadata and accounting.
    struct Proposal {
        uint256 id;
        address proposer;
        Allocation target;
        string rationaleURI;
        uint256 bondAmount;
        bool bondRefunded;
        bool isStatusQuo;
    }

    /// @notice Round-level lifecycle and settlement state.
    struct Round {
        uint256 id;
        uint64 tradingEnd;
        uint64 evaluationEnd;
        uint96 rMin;
        uint96 rMax;
        uint32 twapWindow;
        uint96 epsilon;
        uint256 proposalCount;
        uint256 winnerProposalId;
        bool collapsed;
        bool settled;
        int256 realisedReturn;
        uint256 totalDeposited;
        bool cancelled;
    }

    /// @notice Rounds by id.
    mapping(uint256 roundId => Round) public rounds;

    /// @notice Proposals by round and proposal id, with id 0 as status quo.
    mapping(uint256 roundId => mapping(uint256 proposalIdx => Proposal)) public proposals;

    /// @notice USDC deposits per user and round.
    mapping(uint256 roundId => mapping(address user => uint256)) public deposits;

    /// @notice Credits claimed per user in each proposal market per round.
    mapping(uint256 roundId => mapping(uint256 proposalId => mapping(address user => uint256))) public creditsClaimed;

    /// @notice Aggregate credits claimed by user across all proposals in a round.
    mapping(uint256 roundId => mapping(address user => uint256)) public totalCreditsClaimed;

    /// @notice Round-level deposits not yet converted into claimed credits or redeemed.
    mapping(uint256 roundId => uint256) public roundUnclaimedCollateral;

    /// @notice Protocol seed allocated to each proposal when a round opens.
    mapping(uint256 roundId => uint256) public roundSeedPerProposal;

    /// @notice Winning proposal's seed held as settlement collateral.
    mapping(uint256 roundId => uint256) public roundWinningSeed;

    /// @notice Collateral remaining for a settled round's outstanding user liabilities.
    mapping(uint256 roundId => uint256) public roundRemainingCollateral;

    /// @notice Number of rounds opened so far.
    uint256 public roundCount;

    /// @notice Protocol-owned USDC available for seeding proposal markets.
    uint256 public protocolLiquiditySeed;

    /// @notice Shared proposal-token factory.
    ProposalTokens public immutable proposalTokens;

    /// @notice Proposal market adapter.
    IProposalMarket public immutable market;

    /// @notice Proposer registry + bond custodian.
    ProposerRegistry public immutable proposerRegistry;

    /// @notice Canonical USDC token instance.
    IERC20 public immutable usdc;

    /// @notice Treasury recipient for slashed proposer bonds.
    address public treasury;

    /// @notice Authorized resolver contract allowed to settle rounds.
    address public resolver;

    /// @notice Thrown when round is not open for requested operation.
    error RoundNotOpen();

    /// @notice Thrown when round has not been collapsed yet.
    error RoundNotCollapsed();

    /// @notice Thrown when round has not been settled yet.
    error RoundNotSettled();

    /// @notice Thrown when collapse is attempted more than once.
    error AlreadyCollapsed();

    /// @notice Thrown when settle is attempted more than once.
    error AlreadySettled();

    /// @notice Thrown when trading is closed for requested action.
    error TradingClosed();

    /// @notice Thrown when trading closure precondition is not yet met.
    error TradingNotClosed();

    /// @notice Thrown when deposit or tracked balance is insufficient.
    error InsufficientDeposit();

    /// @notice Thrown when admin rescue exceeds unallocated protocol seed.
    error InsufficientProtocolLiquidity();

    /// @notice Thrown when a complete-set market returns collateral below its promised liabilities.
    error InsufficientSolvencyReserve();

    /// @notice Thrown when a complete-set market is paired with credits that are not six-decimal.
    error InvalidCreditPrecision();

    /// @notice Thrown when credits requested exceed tracked allowance.
    error InsufficientCredits();

    /// @notice Thrown when proposal identifier is invalid.
    error InvalidProposal();

    /// @notice Thrown when allocation inputs are invalid.
    error InvalidAllocation();

    /// @notice Thrown when caller is not a registered active proposer.
    error NotRegistered();

    /// @notice Thrown when amount argument is zero.
    error ZeroAmount();

    /// @notice Thrown when address argument is zero.
    error ZeroAddress();

    /// @notice Thrown when settlement caller is not keeper/resolver and emergency window is not reached.
    error UnauthorizedSettlement();

    /// @notice Emitted when a round is opened.
    event RoundOpened(
        uint256 indexed roundId, uint64 tradingEnd, uint64 evaluationEnd, uint96 rMin, uint96 rMax, uint32 twapWindow
    );

    /// @notice Emitted when a proposal is created.
    event ProposalCreated(
        uint256 indexed roundId,
        uint256 indexed proposalId,
        address indexed proposer,
        uint16 tEthBps,
        string rationaleURI
    );

    /// @notice Emitted on user USDC deposit.
    event Deposited(uint256 indexed roundId, address indexed user, uint256 amount);

    /// @notice Emitted when credits are claimed into a proposal market.
    event CreditsClaimed(uint256 indexed roundId, uint256 indexed proposalId, address indexed user, uint256 amount);

    /// @notice Emitted for market trade routing.
    event Trade(
        uint256 indexed roundId,
        uint256 indexed proposalId,
        address indexed user,
        string side,
        uint256 amountIn,
        uint256 amountOut
    );

    /// @notice Emitted when winner selection collapses a round.
    event Collapsed(uint256 indexed roundId, uint256 winnerProposalId, uint256[] twaps);

    /// @notice Emitted when realised return is posted and round is settled.
    event Settled(uint256 indexed roundId, int256 realisedReturn);

    /// @notice Emitted when the vault cancels a round after a failed execution slippage check.
    event RoundCancelled(uint256 indexed roundId);

    /// @notice Emitted when admin withdraws unallocated protocol seed.
    event ProtocolSeedRescued(address indexed admin, uint256 amount);

    /// @notice Emitted on user redemption.
    event Redeemed(uint256 indexed roundId, address indexed user, uint256 payout);

    /// @notice Emitted when a proposal bond is refunded during round collapse.
    event BondRefunded(uint256 indexed roundId, uint256 indexed proposalId, address indexed proposer, uint256 amount);

    /// @notice Emitted when a proposal bond is slashed during round collapse.
    event BondSlashed(
        uint256 indexed roundId, uint256 indexed proposalId, address indexed proposer, address treasury, uint256 amount
    );

    /// @notice Emitted when positive performance generates proposer-fee entitlement.
    event ProposerFeeEarned(
        uint256 indexed roundId,
        uint256 indexed proposalId,
        address indexed proposer,
        int256 realisedReturn,
        uint256 proposerFee
    );

    /// @notice Emitted when resolver address is updated by admin.
    event ResolverSet(address indexed resolver);

    /// @notice Deploys QuantumRound core.
    /// @param proposalTokens_ Proposal token factory address.
    /// @param market_ Proposal market adapter address.
    /// @param proposerRegistry_ Proposer registry address.
    /// @param initialAdmin Initial admin + keeper.
    /// @param treasury_ Treasury address that receives slashed proposer bonds.
    /// @param resolver_ Resolver contract address allowed to call settle.
    constructor(
        address proposalTokens_,
        address market_,
        address proposerRegistry_,
        address initialAdmin,
        address treasury_,
        address resolver_
    ) {
        if (
            proposalTokens_ == address(0) || market_ == address(0) || proposerRegistry_ == address(0)
                || initialAdmin == address(0) || treasury_ == address(0) || resolver_ == address(0)
        ) revert ZeroAddress();

        proposalTokens = ProposalTokens(proposalTokens_);
        market = IProposalMarket(market_);
        proposerRegistry = ProposerRegistry(proposerRegistry_);
        usdc = IERC20(USDC);
        treasury = treasury_;
        resolver = resolver_;

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(KEEPER_ROLE, initialAdmin);
    }

    /// @notice Sets the USDC seed amount per proposal market. Used to reduce for testnet demos.
    /// @param amount New seed amount in USDC base units.
    function setInitialLiquidityPerProposal(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == 0) revert ZeroAmount();
        initialLiquidityPerProposal = amount;
    }

    /// @notice Updates resolver contract that may call settle.
    /// @param resolver_ New resolver address.
    function setResolver(address resolver_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (resolver_ == address(0)) revert ZeroAddress();
        resolver = resolver_;
        emit ResolverSet(resolver_);
    }

    /// @notice Cancels an unsettled round so users can redeem their deposits at par.
    function cancelRound(uint256 roundId) external nonReentrant onlyRole(VAULT_ROLE) {
        Round storage round = rounds[roundId];
        if (round.id == 0) revert InvalidProposal();
        if (round.settled) revert AlreadySettled();

        uint256 seedPerProposal = roundSeedPerProposal[roundId];
        if (round.collapsed) {
            protocolLiquiditySeed += roundWinningSeed[roundId];
            roundWinningSeed[roundId] = 0;
        } else {
            if (market.completeSetScale() != 0 && block.timestamp < round.tradingEnd) revert TradingNotClosed();
            for (uint256 proposalId = 0; proposalId < round.proposalCount; proposalId++) {
                market.closeTwapWindow(roundId, proposalId, round.tradingEnd);
                (uint256 longReturned, uint256 shortReturned) = market.finalizeProposal(roundId, proposalId);
                address longTokenAddr = proposalTokens.longToken(roundId, proposalId);
                address shortTokenAddr = proposalTokens.shortToken(roundId, proposalId);
                if (longReturned > 0) ProposalTokenImpl(longTokenAddr).burn(address(this), longReturned);
                if (shortReturned > 0) ProposalTokenImpl(shortTokenAddr).burn(address(this), shortReturned);
            }
            protocolLiquiditySeed += seedPerProposal * round.proposalCount;
        }

        roundRemainingCollateral[roundId] = round.totalDeposited;
        roundUnclaimedCollateral[roundId] = round.totalDeposited;
        round.cancelled = true;
        round.collapsed = true;
        round.settled = true;
        round.realisedReturn = int256(1e18);

        for (uint256 proposalId = 1; proposalId < round.proposalCount; proposalId++) {
            Proposal storage proposal = proposals[roundId][proposalId];
            if (!proposal.bondRefunded) {
                proposal.bondRefunded = true;
                proposerRegistry.refundBond(proposal.proposer, proposal.bondAmount);
                emit BondRefunded(roundId, proposalId, proposal.proposer, proposal.bondAmount);
            }
        }

        emit RoundCancelled(roundId);
        emit Settled(roundId, int256(1e18));
    }

    /// @notice Returns the round's evaluation end timestamp, or zero for an unknown round.
    function roundEvaluationEnd(uint256 roundId) external view returns (uint64) {
        return rounds[roundId].evaluationEnd;
    }

    /// @notice Returns timing inputs required by the proposal-market adapter.
    function marketTiming(uint256 roundId) external view returns (uint64 tradingEnd, uint32 twapWindow) {
        Round storage round = rounds[roundId];
        if (round.id == 0) revert InvalidProposal();
        return (round.tradingEnd, round.twapWindow);
    }

    /// @notice Adds protocol-owned USDC seed liquidity for future proposal markets.
    /// @param amount USDC amount to add to protocol liquidity seed.
    function addProtocolLiquiditySeed(uint256 amount) external nonReentrant onlyRole(KEEPER_ROLE) {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        protocolLiquiditySeed += amount;
    }

    /// @notice Withdraws only protocol seed that has not been allocated to a proposal market.
    /// @dev Round allocations are removed from protocolLiquiditySeed when the round/proposal is created.
    function rescueProtocolSeed(uint256 amount) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == 0) revert ZeroAmount();
        if (amount > protocolLiquiditySeed) revert InsufficientProtocolLiquidity();

        protocolLiquiditySeed -= amount;
        usdc.safeTransfer(msg.sender, amount);

        emit ProtocolSeedRescued(msg.sender, amount);
    }

    /// @notice Opens a new round and seeds the status-quo market.
    /// @param tradingEnd Timestamp when trading phase ends.
    /// @param horizon Evaluation horizon length in seconds.
    /// @param rMin Minimum bounded return (1e18 scale).
    /// @param rMax Maximum bounded return (1e18 scale).
    /// @param twapWindow TWAP lookback window in seconds.
    function openRound(uint64 tradingEnd, uint64 horizon, uint96 rMin, uint96 rMax, uint32 twapWindow)
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
    {
        if (tradingEnd <= block.timestamp) revert InvalidAllocation();
        if (horizon == 0) revert InvalidAllocation();
        if (rMin >= rMax) revert InvalidAllocation();
        if (rMin < 0.5e18 || rMax > 2e18) revert InvalidAllocation();
        if (twapWindow == 0) revert InvalidAllocation();
        if (market.completeSetScale() != 0 && uint256(twapWindow) > uint256(tradingEnd) - block.timestamp) {
            revert InvalidAllocation();
        }
        if (protocolLiquiditySeed < initialLiquidityPerProposal) revert InsufficientDeposit();

        uint256 newRoundId = ++roundCount;
        uint64 evaluationEnd = tradingEnd + horizon;

        Round storage round = rounds[newRoundId];
        round.id = newRoundId;
        round.tradingEnd = tradingEnd;
        round.evaluationEnd = evaluationEnd;
        round.rMin = rMin;
        round.rMax = rMax;
        round.twapWindow = twapWindow;
        round.epsilon = uint96(EPSILON);
        round.proposalCount = 1;
        roundSeedPerProposal[newRoundId] = initialLiquidityPerProposal;

        proposals[newRoundId][0] = Proposal({
            id: 0,
            proposer: address(this),
            target: Allocation({ tEthBps: 0 }),
            rationaleURI: "status-quo",
            bondAmount: 0,
            bondRefunded: true,
            isStatusQuo: true
        });

        protocolLiquiditySeed -= initialLiquidityPerProposal;

        proposalTokens.deployForProposal(
            newRoundId, 0, _creditSymbol(newRoundId, 0), _longSymbol(newRoundId, 0), _shortSymbol(newRoundId, 0)
        );

        _seedProposalMarket(newRoundId, 0, initialLiquidityPerProposal);

        emit RoundOpened(newRoundId, tradingEnd, evaluationEnd, rMin, rMax, twapWindow);
    }

    /// @notice Creates a new proposal in an open round.
    /// @param roundId Round identifier.
    /// @param target Target allocation proposed by agent.
    /// @param rationaleURI Off-chain rationale URI.
    function propose(uint256 roundId, Allocation calldata target, string calldata rationaleURI) external nonReentrant {
        Round storage round = rounds[roundId];
        if (round.id == 0) revert InvalidProposal();
        if (round.collapsed) revert TradingClosed();
        if (block.timestamp >= round.tradingEnd) revert TradingClosed();
        if (market.completeSetScale() != 0 && block.timestamp >= uint256(round.tradingEnd) - round.twapWindow) {
            revert TradingClosed();
        }
        if (target.tEthBps > 10_000) revert InvalidAllocation();
        if (round.proposalCount >= MAX_PROPOSALS_PER_ROUND) revert InvalidAllocation();

        (, address wallet, bool active,,,) = proposerRegistry.agents(msg.sender);
        if (wallet == address(0) || !active) revert NotRegistered();

        proposerRegistry.lockBond(msg.sender, DEFAULT_BOND);

        uint256 proposalId = round.proposalCount;
        round.proposalCount = proposalId + 1;

        proposals[roundId][proposalId] = Proposal({
            id: proposalId,
            proposer: msg.sender,
            target: Allocation({ tEthBps: target.tEthBps }),
            rationaleURI: rationaleURI,
            bondAmount: DEFAULT_BOND,
            bondRefunded: false,
            isStatusQuo: false
        });

        uint256 proposalSeed = roundSeedPerProposal[roundId];
        if (protocolLiquiditySeed < proposalSeed) revert InsufficientDeposit();
        protocolLiquiditySeed -= proposalSeed;

        proposalTokens.deployForProposal(
            roundId,
            proposalId,
            _creditSymbol(roundId, proposalId),
            _longSymbol(roundId, proposalId),
            _shortSymbol(roundId, proposalId)
        );

        _seedProposalMarket(roundId, proposalId, proposalSeed);

        emit ProposalCreated(roundId, proposalId, msg.sender, target.tEthBps, rationaleURI);
    }

    /// @notice Deposits USDC into a round.
    /// @param roundId Round identifier.
    /// @param amount Deposit amount in USDC base units.
    function deposit(uint256 roundId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Round storage round = rounds[roundId];
        if (round.id == 0) revert InvalidProposal();
        if (round.collapsed || block.timestamp >= round.tradingEnd) revert TradingClosed();

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        deposits[roundId][msg.sender] += amount;
        round.totalDeposited += amount;
        roundUnclaimedCollateral[roundId] += amount;

        emit Deposited(roundId, msg.sender, amount);
    }

    /// @notice Claims proposal-market credits against deposited USDC balance.
    /// @dev Aggregate credits claimed across all proposals in a round cannot exceed the caller's round deposit.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param amount Credit amount to claim.
    function claimCredits(uint256 roundId, uint256 proposalId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        Round storage round = rounds[roundId];
        if (round.id == 0) revert InvalidProposal();
        if (round.collapsed || block.timestamp >= round.tradingEnd) revert TradingClosed();
        if (proposalId >= round.proposalCount) revert InvalidProposal();

        uint256 userDeposit = deposits[roundId][msg.sender];
        uint256 alreadyClaimedTotal = totalCreditsClaimed[roundId][msg.sender];
        if (alreadyClaimedTotal + amount > userDeposit) revert InsufficientDeposit();

        address credit = proposalTokens.creditToken(roundId, proposalId);
        if (credit == address(0)) revert InvalidProposal();

        creditsClaimed[roundId][proposalId][msg.sender] += amount;
        totalCreditsClaimed[roundId][msg.sender] = alreadyClaimedTotal + amount;
        roundUnclaimedCollateral[roundId] -= amount;
        ProposalTokenImpl(credit).mint(msg.sender, amount);

        emit CreditsClaimed(roundId, proposalId, msg.sender, amount);
    }

    /// @notice Routes a BUY_LONG trade through the proposal market.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param creditsIn Credits spent.
    /// @param minLongOut Minimum acceptable LONG output.
    function buyLong(uint256 roundId, uint256 proposalId, uint256 creditsIn, uint256 minLongOut) external nonReentrant {
        if (creditsIn == 0) revert ZeroAmount();
        _requireTradingOpen(roundId, proposalId);

        address credit = proposalTokens.creditToken(roundId, proposalId);
        if (credit == address(0)) revert InvalidProposal();

        ProposalTokenImpl(credit).burn(msg.sender, creditsIn);
        uint256 setScale = market.completeSetScale();
        if (setScale != 0) {
            _requireSixDecimalCredits(credit);
            _mintCompleteSet(roundId, proposalId, address(market), creditsIn * setScale);
        }

        uint256 longOut = market.tradeBuyLong(roundId, proposalId, creditsIn, minLongOut);

        address longTokenAddr = proposalTokens.longToken(roundId, proposalId);
        if (longTokenAddr == address(0)) revert InvalidProposal();

        if (setScale == 0) {
            ProposalTokenImpl(longTokenAddr).mint(msg.sender, longOut);
        } else {
            IERC20(longTokenAddr).safeTransfer(msg.sender, longOut);
        }

        emit Trade(roundId, proposalId, msg.sender, "BUY_LONG", creditsIn, longOut);
    }

    /// @notice Routes a BUY_SHORT trade through the proposal market.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param creditsIn Credits spent.
    /// @param minSetsOut Minimum acceptable set output.
    function buyShort(uint256 roundId, uint256 proposalId, uint256 creditsIn, uint256 minSetsOut)
        external
        nonReentrant
    {
        if (creditsIn == 0) revert ZeroAmount();
        _requireTradingOpen(roundId, proposalId);

        address credit = proposalTokens.creditToken(roundId, proposalId);
        if (credit == address(0)) revert InvalidProposal();

        ProposalTokenImpl(credit).burn(msg.sender, creditsIn);
        uint256 setScale = market.completeSetScale();
        if (setScale != 0) {
            _requireSixDecimalCredits(credit);
            _mintCompleteSet(roundId, proposalId, address(market), creditsIn * setScale);
        }

        uint256 setsOut = market.tradeBuyShort(roundId, proposalId, creditsIn, minSetsOut);

        address shortTokenAddr = proposalTokens.shortToken(roundId, proposalId);
        if (shortTokenAddr == address(0)) revert InvalidProposal();

        if (setScale == 0) {
            ProposalTokenImpl(shortTokenAddr).mint(msg.sender, setsOut);
        } else {
            IERC20(shortTokenAddr).safeTransfer(msg.sender, setsOut);
        }

        emit Trade(roundId, proposalId, msg.sender, "BUY_SHORT", creditsIn, setsOut);
    }

    /// @notice Routes a SELL_LONG trade through the proposal market.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param longIn LONG amount sold.
    /// @param minCreditsOut Minimum acceptable credit output.
    function sellLong(uint256 roundId, uint256 proposalId, uint256 longIn, uint256 minCreditsOut)
        external
        nonReentrant
    {
        if (longIn == 0) revert ZeroAmount();
        _requireTradingOpen(roundId, proposalId);

        address longTokenAddr = proposalTokens.longToken(roundId, proposalId);
        if (longTokenAddr == address(0)) revert InvalidProposal();

        ProposalTokenImpl(longTokenAddr).burn(msg.sender, longIn);
        uint256 setScale = market.completeSetScale();
        if (setScale != 0) ProposalTokenImpl(longTokenAddr).mint(address(market), longIn);

        uint256 creditsOut = market.tradeSellLong(roundId, proposalId, longIn, minCreditsOut);

        address credit = proposalTokens.creditToken(roundId, proposalId);
        if (credit == address(0)) revert InvalidProposal();

        if (setScale != 0) {
            _requireSixDecimalCredits(credit);
            _settleCompleteSetSale(roundId, proposalId, creditsOut, msg.sender, true);
        }
        ProposalTokenImpl(credit).mint(msg.sender, creditsOut);

        emit Trade(roundId, proposalId, msg.sender, "SELL_LONG", longIn, creditsOut);
    }

    /// @notice Routes a SELL_SHORT trade through the proposal market.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param setsIn Complete sets sold.
    /// @param minCreditsOut Minimum acceptable credit output.
    function sellShort(uint256 roundId, uint256 proposalId, uint256 setsIn, uint256 minCreditsOut)
        external
        nonReentrant
    {
        if (setsIn == 0) revert ZeroAmount();
        _requireTradingOpen(roundId, proposalId);

        address shortTokenAddr = proposalTokens.shortToken(roundId, proposalId);
        if (shortTokenAddr == address(0)) revert InvalidProposal();

        ProposalTokenImpl(shortTokenAddr).burn(msg.sender, setsIn);
        uint256 setScale = market.completeSetScale();
        if (setScale != 0) ProposalTokenImpl(shortTokenAddr).mint(address(market), setsIn);

        uint256 creditsOut = market.tradeSellShort(roundId, proposalId, setsIn, minCreditsOut);

        address credit = proposalTokens.creditToken(roundId, proposalId);
        if (credit == address(0)) revert InvalidProposal();

        if (setScale != 0) {
            _requireSixDecimalCredits(credit);
            _settleCompleteSetSale(roundId, proposalId, creditsOut, msg.sender, false);
        }
        ProposalTokenImpl(credit).mint(msg.sender, creditsOut);

        emit Trade(roundId, proposalId, msg.sender, "SELL_SHORT", setsIn, creditsOut);
    }

    /// @notice Collapses a round by selecting winner via TWAP comparison and finalizing proposal bonds.
    /// @param roundId Round identifier.
    function collapse(uint256 roundId) external nonReentrant {
        Round storage round = rounds[roundId];
        if (round.id == 0) revert InvalidProposal();
        if (block.timestamp < round.tradingEnd) revert TradingNotClosed();
        if (round.collapsed) revert AlreadyCollapsed();

        uint256 count = round.proposalCount;
        uint256[] memory twaps = new uint256[](count);

        round.collapsed = true;

        uint256 windowStart = round.tradingEnd > round.twapWindow ? round.tradingEnd - round.twapWindow : 0;

        for (uint256 i = 0; i < count; i++) {
            market.closeTwapWindow(roundId, i, round.tradingEnd);
            twaps[i] = market.twap(roundId, i, windowStart, round.tradingEnd);
        }

        uint256 statusQuoTwap = twaps[0];
        uint256 bestProposal = 0;
        uint256 bestTwap = statusQuoTwap;

        for (uint256 i = 1; i < count; i++) {
            if (twaps[i] > bestTwap) {
                bestTwap = twaps[i];
                bestProposal = i;
            }
        }

        if (bestTwap < statusQuoTwap + uint256(round.epsilon)) {
            bestProposal = 0;
        }

        round.winnerProposalId = bestProposal;
        uint256 seedPerProposal = roundSeedPerProposal[roundId];

        for (uint256 i = 0; i < count; i++) {
            (uint256 longReturned, uint256 shortReturned) = market.finalizeProposal(roundId, i);
            address longTokenAddr = proposalTokens.longToken(roundId, i);
            address shortTokenAddr = proposalTokens.shortToken(roundId, i);
            if (longReturned > 0) ProposalTokenImpl(longTokenAddr).burn(address(this), longReturned);
            if (shortReturned > 0) ProposalTokenImpl(shortTokenAddr).burn(address(this), shortReturned);

            if (i == bestProposal) {
                roundWinningSeed[roundId] = seedPerProposal;
            } else {
                protocolLiquiditySeed += seedPerProposal;
            }

            if (i > 0) _finalizeProposalBond(roundId, i, bestProposal, twaps[i]);
        }

        emit Collapsed(roundId, bestProposal, twaps);
    }

    /// @notice Settles a collapsed round with realised return.
    /// @dev permissionless emergency settlement: if keeper has not settled after evaluationEnd + EMERGENCY_SETTLE_DELAY,
    /// anyone may settle at par (realisedReturn = 1e18).
    /// @param roundId Round identifier.
    /// @param realisedReturn Realised return in 1e18 scale.
    function settle(uint256 roundId, int256 realisedReturn) external {
        Round storage round = rounds[roundId];
        if (round.id == 0) revert InvalidProposal();
        if (round.cancelled) revert AlreadySettled();
        if (!round.collapsed) revert RoundNotCollapsed();
        if (round.settled) revert AlreadySettled();
        if (block.timestamp < round.evaluationEnd) revert TradingNotClosed();

        bool isAuthorized = hasRole(KEEPER_ROLE, msg.sender) || msg.sender == resolver;
        bool isEmergency = block.timestamp >= uint256(round.evaluationEnd) + EMERGENCY_SETTLE_DELAY;
        if (!isAuthorized && !isEmergency) revert UnauthorizedSettlement();

        int256 effectiveReturn = isAuthorized ? realisedReturn : int256(1e18);

        round.realisedReturn = effectiveReturn;
        round.settled = true;
        roundRemainingCollateral[roundId] = round.totalDeposited + roundWinningSeed[roundId];
        if (roundUserLiability(roundId) > roundRemainingCollateral[roundId]) revert InsufficientSolvencyReserve();

        uint256 winnerProposalId = round.winnerProposalId;
        Proposal storage winner = proposals[roundId][winnerProposalId];

        if (!winner.isStatusQuo) {
            proposerRegistry.recordWin(winner.proposer, effectiveReturn);

            if (effectiveReturn > int256(1e18)) {
                uint256 gainFactor = uint256(effectiveReturn - int256(1e18));
                uint256 proposerFee =
                    (gainFactor * round.totalDeposited * PERFORMANCE_FEE * PROPOSER_SHARE) / (1e18 * 10_000 * 10_000);
                emit ProposerFeeEarned(roundId, winnerProposalId, winner.proposer, effectiveReturn, proposerFee);
            }
        }

        emit Settled(roundId, effectiveReturn);
    }

    /// @notice Redeems user payout from a settled round.
    /// @param roundId Round identifier.
    function redeem(uint256 roundId) external nonReentrant {
        Round storage round = rounds[roundId];
        if (round.id == 0) revert InvalidProposal();
        if (!round.settled) revert RoundNotSettled();

        uint256 userDeposit = deposits[roundId][msg.sender];

        if (round.cancelled) {
            if (userDeposit == 0) revert InsufficientDeposit();
            delete deposits[roundId][msg.sender];
            roundRemainingCollateral[roundId] -= userDeposit;
            roundUnclaimedCollateral[roundId] -= userDeposit;
            usdc.safeTransfer(msg.sender, userDeposit);
            emit Redeemed(roundId, msg.sender, userDeposit);
            return;
        }

        uint256 claimed = totalCreditsClaimed[roundId][msg.sender];
        if (claimed > userDeposit) revert InsufficientCredits();
        uint256 unclaimed = userDeposit - claimed;
        if (unclaimed > roundUnclaimedCollateral[roundId]) revert InsufficientDeposit();

        uint256 clamped = _clampReturn(round.realisedReturn, round.rMin, round.rMax);
        uint256 piNumer = clamped - uint256(round.rMin);
        uint256 piDenom = uint256(round.rMax) - uint256(round.rMin);
        uint256 scale = market.completeSetScale();
        uint256 payoutScale = scale == 0 ? 1 : scale;
        uint256 creditPayout;
        uint256 outcomePayout;
        bool hasPosition = false;

        for (uint256 proposalId = 0; proposalId < round.proposalCount; proposalId++) {
            address credit = proposalTokens.creditToken(roundId, proposalId);
            address longTokenAddr = proposalTokens.longToken(roundId, proposalId);
            address shortTokenAddr = proposalTokens.shortToken(roundId, proposalId);
            if (credit == address(0) || longTokenAddr == address(0) || shortTokenAddr == address(0)) {
                revert InvalidProposal();
            }

            uint256 creditBal = IERC20(credit).balanceOf(msg.sender);
            uint256 longBal = IERC20(longTokenAddr).balanceOf(msg.sender);
            uint256 shortBal = IERC20(shortTokenAddr).balanceOf(msg.sender);
            if (creditBal > 0) {
                ProposalTokenImpl(credit).burn(msg.sender, creditBal);
                creditPayout += creditBal;
                hasPosition = true;
            }
            if (longBal > 0) {
                ProposalTokenImpl(longTokenAddr).burn(msg.sender, longBal);
                hasPosition = true;
            }
            if (shortBal > 0) {
                ProposalTokenImpl(shortTokenAddr).burn(msg.sender, shortBal);
                hasPosition = true;
            }

            if (proposalId == round.winnerProposalId) {
                outcomePayout += Math.mulDiv(longBal, piNumer, piDenom * payoutScale);
                outcomePayout += Math.mulDiv(shortBal, piDenom - piNumer, piDenom * payoutScale);
            }
        }

        if (userDeposit == 0 && !hasPosition) revert InsufficientDeposit();
        delete deposits[roundId][msg.sender];
        roundUnclaimedCollateral[roundId] -= unclaimed;

        uint256 payout = unclaimed + creditPayout + outcomePayout;
        if (payout > roundRemainingCollateral[roundId]) revert InsufficientSolvencyReserve();
        roundRemainingCollateral[roundId] -= payout;
        if (roundUserLiability(roundId) > roundRemainingCollateral[roundId]) revert InsufficientSolvencyReserve();

        usdc.safeTransfer(msg.sender, payout);
        if (roundUserLiability(roundId) == 0) {
            protocolLiquiditySeed += roundRemainingCollateral[roundId];
            roundRemainingCollateral[roundId] = 0;
            roundWinningSeed[roundId] = 0;
        }

        emit Redeemed(roundId, msg.sender, payout);
    }

    /// @notice Returns remaining deposits, credits and winning outcome-token payouts owed for a settled round.
    function roundUserLiability(uint256 roundId) public view returns (uint256 liability) {
        Round storage round = rounds[roundId];
        if (round.id == 0) return 0;
        if (!round.settled) revert RoundNotSettled();
        if (round.cancelled) return roundUnclaimedCollateral[roundId];

        liability = roundUnclaimedCollateral[roundId];
        for (uint256 proposalId = 0; proposalId < round.proposalCount; proposalId++) {
            address credit = proposalTokens.creditToken(roundId, proposalId);
            liability += IERC20(credit).totalSupply();
        }

        uint256 scale = market.completeSetScale();
        uint256 payoutScale = scale == 0 ? 1 : scale;
        uint256 clamped = _clampReturn(round.realisedReturn, round.rMin, round.rMax);
        uint256 piNumer = clamped - uint256(round.rMin);
        uint256 piDenom = uint256(round.rMax) - uint256(round.rMin);
        address longTokenAddr = proposalTokens.longToken(roundId, round.winnerProposalId);
        address shortTokenAddr = proposalTokens.shortToken(roundId, round.winnerProposalId);
        liability += Math.mulDiv(IERC20(longTokenAddr).totalSupply(), piNumer, piDenom * payoutScale);
        liability += Math.mulDiv(IERC20(shortTokenAddr).totalSupply(), piDenom - piNumer, piDenom * payoutScale);
    }

    function _seedProposalMarket(uint256 roundId, uint256 proposalId, uint256 seedAmount) internal {
        uint256 setScale = market.completeSetScale();
        if (setScale != 0) {
            address credit = proposalTokens.creditToken(roundId, proposalId);
            _requireSixDecimalCredits(credit);
            _mintCompleteSet(roundId, proposalId, address(market), seedAmount * setScale);
        }
        market.seedLiquidity(roundId, proposalId, seedAmount, seedAmount);
    }

    function _mintCompleteSet(uint256 roundId, uint256 proposalId, address recipient, uint256 amount) internal {
        ProposalTokenImpl(proposalTokens.longToken(roundId, proposalId)).mint(recipient, amount);
        ProposalTokenImpl(proposalTokens.shortToken(roundId, proposalId)).mint(recipient, amount);
    }

    function _settleCompleteSetSale(
        uint256 roundId,
        uint256 proposalId,
        uint256 creditsOut,
        address recipient,
        bool soldLong
    ) internal {
        (uint256 longRemainder, uint256 shortRemainder) = market.consumeSellSettlement(roundId, proposalId);
        uint256 matched = creditsOut * market.completeSetScale();
        address longTokenAddr = proposalTokens.longToken(roundId, proposalId);
        address shortTokenAddr = proposalTokens.shortToken(roundId, proposalId);
        if (soldLong) {
            if (shortRemainder < matched) revert InsufficientSolvencyReserve();
            if (matched > 0) ProposalTokenImpl(shortTokenAddr).burn(address(this), matched);
            shortRemainder -= matched;
        } else {
            if (longRemainder < matched) revert InsufficientSolvencyReserve();
            if (matched > 0) ProposalTokenImpl(longTokenAddr).burn(address(this), matched);
            longRemainder -= matched;
        }
        if (longRemainder > 0) IERC20(longTokenAddr).safeTransfer(recipient, longRemainder);
        if (shortRemainder > 0) IERC20(shortTokenAddr).safeTransfer(recipient, shortRemainder);
    }

    function _requireSixDecimalCredits(address credit) internal view {
        if (credit == address(0) || ProposalTokenImpl(credit).decimals() != 6) revert InvalidCreditPrecision();
    }

    /// @notice Finalizes one proposal bond after winner determination.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier to finalize.
    /// @param winnerProposalId Winner proposal identifier for this round.
    /// @param finalTwap Final TWAP used for slash/refund branch.
    function _finalizeProposalBond(uint256 roundId, uint256 proposalId, uint256 winnerProposalId, uint256 finalTwap)
        internal
    {
        Proposal storage proposal = proposals[roundId][proposalId];
        if (proposal.bondRefunded) return;

        proposal.bondRefunded = true;

        if (proposalId == winnerProposalId || finalTwap >= SPAM_THRESHOLD_PRICE) {
            proposerRegistry.refundBond(proposal.proposer, proposal.bondAmount);
            emit BondRefunded(roundId, proposalId, proposal.proposer, proposal.bondAmount);
        } else {
            proposerRegistry.slashBond(proposal.proposer, proposal.bondAmount, treasury);
            emit BondSlashed(roundId, proposalId, proposal.proposer, treasury, proposal.bondAmount);
        }
    }

    /// @notice Validates round/proposal exist and trading is still open.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    function _requireTradingOpen(uint256 roundId, uint256 proposalId) internal view {
        Round storage round = rounds[roundId];
        if (round.id == 0) revert InvalidProposal();
        if (proposalId >= round.proposalCount) revert InvalidProposal();
        if (round.collapsed || block.timestamp >= round.tradingEnd) revert TradingClosed();
    }

    /// @notice Clamps realised return into [rMin, rMax] bounds.
    /// @param realisedReturn Realised return input (can be negative).
    /// @param rMin Minimum bound.
    /// @param rMax Maximum bound.
    /// @return bounded Clamped return value.
    function _clampReturn(int256 realisedReturn, uint96 rMin, uint96 rMax) internal pure returns (uint256 bounded) {
        if (realisedReturn <= int256(uint256(rMin))) return uint256(rMin);
        if (realisedReturn >= int256(uint256(rMax))) return uint256(rMax);
        return uint256(realisedReturn);
    }

    /// @notice Builds deterministic CREDIT symbol for a round+proposal.
    function _creditSymbol(uint256 roundId, uint256 proposalId) internal pure returns (string memory) {
        return string(abi.encodePacked("CR", _toString(roundId), "_", _toString(proposalId)));
    }

    /// @notice Builds deterministic LONG symbol for a round+proposal.
    function _longSymbol(uint256 roundId, uint256 proposalId) internal pure returns (string memory) {
        return string(abi.encodePacked("LO", _toString(roundId), "_", _toString(proposalId)));
    }

    /// @notice Builds deterministic SHORT symbol for a round+proposal.
    function _shortSymbol(uint256 roundId, uint256 proposalId) internal pure returns (string memory) {
        return string(abi.encodePacked("SH", _toString(roundId), "_", _toString(proposalId)));
    }

    /// @notice Converts uint256 to decimal string.
    function _toString(uint256 value) internal pure returns (string memory str) {
        if (value == 0) return "0";

        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint8(value % 10)));
            value /= 10;
        }
        str = string(buffer);
    }
}
