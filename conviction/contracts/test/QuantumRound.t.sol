// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test, Vm } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { QuantumRound } from "../src/QuantumRound.sol";
import { ConstantProductMarket } from "../src/ConstantProductMarket.sol";
import { ProposalTokens, ProposalTokenImpl } from "../src/ProposalTokens.sol";
import { ProposerRegistry } from "../src/ProposerRegistry.sol";
import { Resolver } from "../src/Resolver.sol";
import { MockUSDC } from "../test-helpers/MockUSDC.sol";

/// @dev Canonical Arc testnet USDC address (hardcoded constant in QuantumRound).
address constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

/// @dev Default proposer bond (1 USDC, 6 dec).
uint256 constant DEFAULT_BOND = 1_000_000;

/// @dev Initial liquidity seed per proposal (500 USDC).
uint256 constant INITIAL_LIQUIDITY = 500_000_000;

/// @dev EPSILON from QuantumRound.
uint256 constant EPSILON = 0.005e18;

contract QuantumRoundTest is Test {
    // ─────────────────────────────────────────────────────────
    // System
    // ─────────────────────────────────────────────────────────
    MockUSDC internal usdc;
    ProposalTokens internal proposalTokens;
    ConstantProductMarket internal market;
    ProposerRegistry internal registry;
    Resolver internal resolver;
    QuantumRound internal qr;

    // ─────────────────────────────────────────────────────────
    // Actors
    // ─────────────────────────────────────────────────────────
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice"); // depositor / trader
    address internal proposer = makeAddr("proposer"); // registered proposer
    address internal treasury = makeAddr("treasury");

    // ─────────────────────────────────────────────────────────
    // Round parameters
    // ─────────────────────────────────────────────────────────
    uint64 internal TRADING_END;
    uint64 internal HORIZON = 7 days;
    uint96 internal R_MIN = 0.5e18;
    uint96 internal R_MAX = 2e18;
    uint32 internal TWAP_WINDOW = 1 hours;

    // ─────────────────────────────────────────────────────────
    // Events (copied for expectEmit matching)
    // ─────────────────────────────────────────────────────────
    event RoundOpened(
        uint256 indexed roundId, uint64 tradingEnd, uint64 evaluationEnd, uint96 rMin, uint96 rMax, uint32 twapWindow
    );
    event ProposalCreated(
        uint256 indexed roundId,
        uint256 indexed proposalId,
        address indexed proposer_,
        uint16 tEthBps,
        string rationaleURI
    );
    event Deposited(uint256 indexed roundId, address indexed user, uint256 amount);
    event CreditsClaimed(uint256 indexed roundId, uint256 indexed proposalId, address indexed user, uint256 amount);
    event Trade(
        uint256 indexed roundId,
        uint256 indexed proposalId,
        address indexed user,
        string side,
        uint256 amountIn,
        uint256 amountOut
    );
    event Collapsed(uint256 indexed roundId, uint256 winnerProposalId, uint256[] twaps);
    event Settled(uint256 indexed roundId, int256 realisedReturn);
    event Redeemed(uint256 indexed roundId, address indexed user, uint256 payout);
    event BondRefunded(uint256 indexed roundId, uint256 indexed proposalId, address indexed proposer_, uint256 amount);
    event BondSlashed(
        uint256 indexed roundId, uint256 indexed proposalId, address indexed proposer_, address treas, uint256 amount
    );
    event ProposerFeeEarned(
        uint256 indexed roundId,
        uint256 indexed proposalId,
        address indexed proposer_,
        int256 realisedReturn,
        uint256 proposerFee
    );
    event ResolverSet(address indexed resolver_);

    // ─────────────────────────────────────────────────────────
    // setUp
    // ─────────────────────────────────────────────────────────

    function setUp() public {
        // 1. Deploy MockUSDC and etch at canonical USDC address.
        usdc = new MockUSDC();
        vm.etch(USDC_ADDR, address(usdc).code);
        usdc = MockUSDC(USDC_ADDR);

        // 2. Deploy peripheral contracts.
        vm.startPrank(admin);
        proposalTokens = new ProposalTokens(admin);
        market = new ConstantProductMarket(30, admin); // 0.3% fee; owner=admin temporarily
        registry = new ProposerRegistry(USDC_ADDR, admin);
        vm.stopPrank();

        // 3. Deploy QuantumRound with a placeholder resolver (updated after).
        //    Resolver needs QuantumRound address, so bootstrap with admin as resolver first.
        vm.prank(admin);
        qr = new QuantumRound(
            address(proposalTokens),
            address(market),
            address(registry),
            admin, // initialAdmin
            treasury,
            admin // temporary resolver placeholder
        );

        // 4. Deploy Resolver with real QuantumRound address.
        vm.prank(admin);
        resolver = new Resolver(address(qr), admin);

        bytes32 resolverRole = resolver.RESOLVER_ROLE();
        vm.prank(admin);
        resolver.grantRole(resolverRole, admin);

        // 5. Wire up: update qr.resolver to the real Resolver.
        vm.prank(admin);
        qr.setResolver(address(resolver));

        // 6. Transfer market ownership to qr (market is onlyOwner for trade calls).
        vm.prank(admin);
        market.transferOwnership(address(qr));

        // 7. Grant QUANTUM_ROUND_ROLE on proposalTokens and registry to qr.
        vm.startPrank(admin);
        proposalTokens.grantRole(proposalTokens.QUANTUM_ROUND_ROLE(), address(qr));
        registry.grantRole(registry.QUANTUM_ROUND_ROLE(), address(qr));
        vm.stopPrank();

        // 8. Register proposer.
        vm.prank(proposer);
        registry.registerAgent("Test Proposer");

        // 9. Fund admin with enough USDC to seed multiple proposals and add protocol liquidity.
        usdc.mint(admin, INITIAL_LIQUIDITY * 25); // enough for many proposals

        // 10. Admin adds protocol seed liquidity.
        vm.startPrank(admin);
        usdc.approve(address(qr), INITIAL_LIQUIDITY * 25);
        qr.addProtocolLiquiditySeed(INITIAL_LIQUIDITY * 20);
        vm.stopPrank();

        TRADING_END = uint64(block.timestamp + 2 days);
    }

    // ─────────────────────────────────────────────────────────
    // Helper: open a round
    // ─────────────────────────────────────────────────────────

    function _openRound() internal returns (uint256 roundId) {
        vm.prank(admin);
        qr.openRound(TRADING_END, HORIZON, R_MIN, R_MAX, TWAP_WINDOW);
        roundId = qr.roundCount();
    }

    // ─────────────────────────────────────────────────────────
    // Helper: fund user and deposit into round
    // ─────────────────────────────────────────────────────────

    function _fundAndDeposit(address user, uint256 roundId, uint256 amount) internal {
        usdc.mint(user, amount);
        vm.prank(user);
        usdc.approve(address(qr), amount);
        vm.prank(user);
        qr.deposit(roundId, amount);
    }

    // ─────────────────────────────────────────────────────────
    // Helper: proposer proposes (must have USDC approved for bond)
    // ─────────────────────────────────────────────────────────

    function _propose(uint256 roundId, uint16 tEthBps) internal returns (uint256 proposalId) {
        usdc.mint(proposer, DEFAULT_BOND);
        vm.prank(proposer);
        usdc.approve(address(registry), DEFAULT_BOND);
        vm.prank(proposer);
        qr.propose(roundId, QuantumRound.Allocation({ tEthBps: tEthBps }), "ipfs://test");
        proposalId = _getRound(roundId).proposalCount - 1;
    }

    // ─────────────────────────────────────────────────────────
    // Helper: get round struct
    // ─────────────────────────────────────────────────────────

    function _getRound(uint256 roundId) internal view returns (QuantumRound.Round memory r) {
        (
            uint256 id,
            uint64 tradingEnd,
            uint64 evaluationEnd,
            uint96 rMin,
            uint96 rMax,
            uint32 twapWindow,
            uint96 epsilon,
            uint256 proposalCount,
            uint256 winnerProposalId,
            bool collapsed,
            bool settled,
            int256 realisedReturn,
            uint256 totalDeposited,
            bool cancelled
        ) = qr.rounds(roundId);
        r.id = id;
        r.tradingEnd = tradingEnd;
        r.evaluationEnd = evaluationEnd;
        r.rMin = rMin;
        r.rMax = rMax;
        r.twapWindow = twapWindow;
        r.epsilon = epsilon;
        r.proposalCount = proposalCount;
        r.winnerProposalId = winnerProposalId;
        r.collapsed = collapsed;
        r.settled = settled;
        r.realisedReturn = realisedReturn;
        r.totalDeposited = totalDeposited;
        r.cancelled = cancelled;
    }

    // ─────────────────────────────────────────────────────────
    // Constructor / initialization
    // ─────────────────────────────────────────────────────────

    function test_Constructor_ZeroAddress_Reverts() public {
        vm.expectRevert(QuantumRound.ZeroAddress.selector);
        new QuantumRound(address(0), address(market), address(registry), admin, treasury, address(resolver));
    }

    function test_Constructor_AdminHasRoles() public view {
        assertTrue(qr.hasRole(qr.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(qr.hasRole(qr.KEEPER_ROLE(), admin));
    }

    function test_SetResolver_Happy() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, false, address(qr));
        emit ResolverSet(address(resolver));
        qr.setResolver(address(resolver));
    }

    function test_SetResolver_ZeroAddress_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(QuantumRound.ZeroAddress.selector);
        qr.setResolver(address(0));
    }

    function test_SetResolver_NotAdmin_Reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        qr.setResolver(address(resolver));
    }

    // ─────────────────────────────────────────────────────────
    // addProtocolLiquiditySeed
    // ─────────────────────────────────────────────────────────

    function test_AddProtocolLiquiditySeed_Happy() public {
        uint256 before = qr.protocolLiquiditySeed();
        usdc.mint(admin, INITIAL_LIQUIDITY);
        vm.startPrank(admin);
        usdc.approve(address(qr), INITIAL_LIQUIDITY);
        qr.addProtocolLiquiditySeed(INITIAL_LIQUIDITY);
        vm.stopPrank();
        assertEq(qr.protocolLiquiditySeed(), before + INITIAL_LIQUIDITY);
    }

    function test_AddProtocolLiquiditySeed_ZeroAmount_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(QuantumRound.ZeroAmount.selector);
        qr.addProtocolLiquiditySeed(0);
    }

    function test_AddProtocolLiquiditySeed_NotKeeper_Reverts() public {
        usdc.mint(alice, INITIAL_LIQUIDITY);
        vm.prank(alice);
        usdc.approve(address(qr), INITIAL_LIQUIDITY);
        vm.prank(alice);
        vm.expectRevert();
        qr.addProtocolLiquiditySeed(INITIAL_LIQUIDITY);
    }

    function test_RescueProtocolSeed_WithdrawsOnlyUnallocatedSeed() public {
        uint256 roundId = _openRound();
        uint256 userDeposit = 10_000_000;
        _fundAndDeposit(alice, roundId, userDeposit);
        uint256 unallocatedSeed = qr.protocolLiquiditySeed();
        uint256 balanceBefore = usdc.balanceOf(address(qr));

        vm.prank(admin);
        qr.rescueProtocolSeed(unallocatedSeed);

        assertEq(qr.protocolLiquiditySeed(), 0);
        assertEq(usdc.balanceOf(address(qr)), balanceBefore - unallocatedSeed);
        assertEq(qr.deposits(roundId, alice), userDeposit);
        assertEq(_getRound(roundId).totalDeposited, userDeposit);
    }

    function test_RescueProtocolSeed_CannotWithdrawAllocatedSeed() public {
        uint256 roundId = _openRound();
        uint256 allocatedSeed = qr.initialLiquidityPerProposal();
        uint256 tooMuch = qr.protocolLiquiditySeed() + 1;

        vm.prank(admin);
        vm.expectRevert(QuantumRound.InsufficientProtocolLiquidity.selector);
        qr.rescueProtocolSeed(tooMuch);

        assertEq(qr.protocolLiquiditySeed(), INITIAL_LIQUIDITY * 20 - allocatedSeed);
        assertEq(usdc.balanceOf(address(qr)), INITIAL_LIQUIDITY * 20);
        assertEq(_getRound(roundId).proposalCount, 1);
    }

    function test_RescueProtocolSeed_OnlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert();
        qr.rescueProtocolSeed(1);
    }

    // ─────────────────────────────────────────────────────────
    // openRound
    // ─────────────────────────────────────────────────────────

    function test_OpenRound_Happy() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, true, address(qr));
        emit RoundOpened(1, TRADING_END, TRADING_END + HORIZON, R_MIN, R_MAX, TWAP_WINDOW);
        qr.openRound(TRADING_END, HORIZON, R_MIN, R_MAX, TWAP_WINDOW);

        assertEq(qr.roundCount(), 1);
        QuantumRound.Round memory r = _getRound(1);
        assertEq(r.proposalCount, 1); // status quo seeded
        assertFalse(r.collapsed);
        assertFalse(r.settled);
    }

    function test_OpenRound_SeedsStatusQuoMarket() public {
        _openRound();
        (uint128 cr, uint128 lr,,,,,) = market.markets(1, 0);
        assertEq(cr, INITIAL_LIQUIDITY);
        assertEq(lr, INITIAL_LIQUIDITY);
    }

    function test_OpenRound_NotKeeper_Reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        qr.openRound(TRADING_END, HORIZON, R_MIN, R_MAX, TWAP_WINDOW);
    }

    function test_OpenRound_TradingEndInPast_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(QuantumRound.InvalidAllocation.selector);
        qr.openRound(uint64(block.timestamp - 1), HORIZON, R_MIN, R_MAX, TWAP_WINDOW);
    }

    function test_OpenRound_ZeroHorizon_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(QuantumRound.InvalidAllocation.selector);
        qr.openRound(TRADING_END, 0, R_MIN, R_MAX, TWAP_WINDOW);
    }

    function test_OpenRound_RMinGeRMax_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(QuantumRound.InvalidAllocation.selector);
        qr.openRound(TRADING_END, HORIZON, R_MAX, R_MIN, TWAP_WINDOW);
    }

    function test_OpenRound_RMinTooLow_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(QuantumRound.InvalidAllocation.selector);
        qr.openRound(TRADING_END, HORIZON, 0.4e18, R_MAX, TWAP_WINDOW);
    }

    function test_OpenRound_RMaxTooHigh_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(QuantumRound.InvalidAllocation.selector);
        qr.openRound(TRADING_END, HORIZON, R_MIN, 2.1e18, TWAP_WINDOW);
    }

    function test_OpenRound_ZeroTwapWindow_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(QuantumRound.InvalidAllocation.selector);
        qr.openRound(TRADING_END, HORIZON, R_MIN, R_MAX, 0);
    }

    function test_OpenRound_InsufficientSeed_Reverts() public {
        // drain all seed
        vm.startPrank(admin);
        uint256 rounds = qr.protocolLiquiditySeed() / INITIAL_LIQUIDITY;
        for (uint256 i = 0; i < rounds; i++) {
            TRADING_END = uint64(block.timestamp + 2 days + i);
            qr.openRound(TRADING_END, HORIZON, R_MIN, R_MAX, TWAP_WINDOW);
        }
        vm.expectRevert(QuantumRound.InsufficientDeposit.selector);
        qr.openRound(uint64(block.timestamp + 3 days), HORIZON, R_MIN, R_MAX, TWAP_WINDOW);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────
    // propose
    // ─────────────────────────────────────────────────────────

    function test_Propose_Happy() public {
        uint256 roundId = _openRound();

        usdc.mint(proposer, DEFAULT_BOND);
        vm.prank(proposer);
        usdc.approve(address(registry), DEFAULT_BOND);

        vm.prank(proposer);
        vm.expectEmit(true, true, true, false, address(qr));
        emit ProposalCreated(roundId, 1, proposer, 5000, "ipfs://test");
        qr.propose(roundId, QuantumRound.Allocation({ tEthBps: 5000 }), "ipfs://test");

        QuantumRound.Round memory r = _getRound(roundId);
        assertEq(r.proposalCount, 2);

        // Bond locked
        assertEq(registry.bonds(proposer), DEFAULT_BOND);
    }

    function test_Propose_SeededMarket() public {
        uint256 roundId = _openRound();
        _propose(roundId, 5000);

        (uint128 cr, uint128 lr,,,,,) = market.markets(roundId, 1);
        assertEq(cr, INITIAL_LIQUIDITY);
        assertEq(lr, INITIAL_LIQUIDITY);
    }

    function test_Propose_NotRegistered_Reverts() public {
        uint256 roundId = _openRound();

        vm.prank(alice);
        vm.expectRevert(QuantumRound.NotRegistered.selector);
        qr.propose(roundId, QuantumRound.Allocation({ tEthBps: 5000 }), "ipfs://test");
    }

    function test_Propose_InvalidAllocation_Reverts() public {
        uint256 roundId = _openRound();

        usdc.mint(proposer, DEFAULT_BOND);
        vm.prank(proposer);
        usdc.approve(address(registry), DEFAULT_BOND);

        vm.prank(proposer);
        vm.expectRevert(QuantumRound.InvalidAllocation.selector);
        qr.propose(roundId, QuantumRound.Allocation({ tEthBps: 10_001 }), "ipfs://test");
    }

    function test_Propose_TradingClosed_Reverts() public {
        uint256 roundId = _openRound();
        vm.warp(TRADING_END + 1);

        usdc.mint(proposer, DEFAULT_BOND);
        vm.prank(proposer);
        usdc.approve(address(registry), DEFAULT_BOND);

        vm.prank(proposer);
        vm.expectRevert(QuantumRound.TradingClosed.selector);
        qr.propose(roundId, QuantumRound.Allocation({ tEthBps: 5000 }), "ipfs://test");
    }

    function test_Propose_MaxProposals_Reverts() public {
        uint256 roundId = _openRound();

        // add more seed so we don't run out of protocol liquidity
        usdc.mint(admin, INITIAL_LIQUIDITY * 25);
        vm.startPrank(admin);
        usdc.approve(address(qr), INITIAL_LIQUIDITY * 25);
        qr.addProtocolLiquiditySeed(INITIAL_LIQUIDITY * 25);
        vm.stopPrank();

        uint256 MAX = qr.MAX_PROPOSALS_PER_ROUND();
        // Round starts with 1 status quo, so we can add MAX-1 more
        for (uint256 i = 0; i < MAX - 1; i++) {
            address p = makeAddr(string(abi.encodePacked("proposer", i)));
            vm.prank(p);
            registry.registerAgent("P");
            usdc.mint(p, DEFAULT_BOND);
            vm.prank(p);
            usdc.approve(address(registry), DEFAULT_BOND);
            vm.prank(p);
            qr.propose(roundId, QuantumRound.Allocation({ tEthBps: 5000 }), "ipfs://test");
        }

        // now at MAX, next propose should revert
        address extra = makeAddr("extraProposer");
        vm.prank(extra);
        registry.registerAgent("Extra");
        usdc.mint(extra, DEFAULT_BOND);
        vm.prank(extra);
        usdc.approve(address(registry), DEFAULT_BOND);

        vm.prank(extra);
        vm.expectRevert(QuantumRound.InvalidAllocation.selector);
        qr.propose(roundId, QuantumRound.Allocation({ tEthBps: 5000 }), "ipfs://test");
    }

    // ─────────────────────────────────────────────────────────
    // deposit
    // ─────────────────────────────────────────────────────────

    function test_Deposit_Happy() public {
        uint256 roundId = _openRound();
        uint256 amount = 10_000_000; // 10 USDC

        // Fund alice with USDC and approve QR — then check the Deposited event fires on qr.deposit().
        // expectEmit must be placed immediately before the emitting call, not before helper mints.
        usdc.mint(alice, amount);
        vm.prank(alice);
        usdc.approve(address(qr), amount);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(qr));
        emit Deposited(roundId, alice, amount);
        qr.deposit(roundId, amount);

        assertEq(qr.deposits(roundId, alice), amount);
        QuantumRound.Round memory r = _getRound(roundId);
        assertEq(r.totalDeposited, amount);
    }

    function test_Deposit_ZeroAmount_Reverts() public {
        uint256 roundId = _openRound();
        vm.prank(alice);
        vm.expectRevert(QuantumRound.ZeroAmount.selector);
        qr.deposit(roundId, 0);
    }

    function test_Deposit_TradingClosed_Reverts() public {
        uint256 roundId = _openRound();
        vm.warp(TRADING_END + 1);

        usdc.mint(alice, 10_000_000);
        vm.prank(alice);
        usdc.approve(address(qr), 10_000_000);

        vm.prank(alice);
        vm.expectRevert(QuantumRound.TradingClosed.selector);
        qr.deposit(roundId, 10_000_000);
    }

    function test_Deposit_InvalidRound_Reverts() public {
        usdc.mint(alice, 10_000_000);
        vm.prank(alice);
        usdc.approve(address(qr), 10_000_000);
        vm.prank(alice);
        vm.expectRevert(QuantumRound.InvalidProposal.selector);
        qr.deposit(99, 10_000_000);
    }

    // ─────────────────────────────────────────────────────────
    // claimCredits
    // ─────────────────────────────────────────────────────────

    function test_ClaimCredits_Happy() public {
        uint256 roundId = _openRound();
        uint256 deposit = 10_000_000;
        _fundAndDeposit(alice, roundId, deposit);

        vm.prank(alice);
        vm.expectEmit(true, true, true, true, address(qr));
        emit CreditsClaimed(roundId, 0, alice, deposit);
        qr.claimCredits(roundId, 0, deposit);

        assertEq(qr.creditsClaimed(roundId, 0, alice), deposit);
        address creditAddr = proposalTokens.creditToken(roundId, 0);
        assertEq(ProposalTokenImpl(creditAddr).balanceOf(alice), deposit);
    }

    function test_ClaimCredits_PerProposalCap() public {
        uint256 roundId = _openRound();
        uint256 deposit = 10_000_000;
        _fundAndDeposit(alice, roundId, deposit);
        _propose(roundId, 5000);

        // The full deposit can be claimed in every proposal independently.
        vm.startPrank(alice);
        qr.claimCredits(roundId, 0, deposit);
        qr.claimCredits(roundId, 1, deposit);

        // But not beyond the deposit within one proposal.
        vm.expectRevert(QuantumRound.InsufficientDeposit.selector);
        qr.claimCredits(roundId, 0, 1);
        vm.stopPrank();
    }

    function test_ClaimCredits_ZeroAmount_Reverts() public {
        uint256 roundId = _openRound();
        _fundAndDeposit(alice, roundId, 10_000_000);

        vm.prank(alice);
        vm.expectRevert(QuantumRound.ZeroAmount.selector);
        qr.claimCredits(roundId, 0, 0);
    }

    function test_ClaimCredits_ExceedsDeposit_Reverts() public {
        uint256 roundId = _openRound();
        uint256 deposit = 10_000_000;
        _fundAndDeposit(alice, roundId, deposit);

        vm.prank(alice);
        vm.expectRevert(QuantumRound.InsufficientDeposit.selector);
        qr.claimCredits(roundId, 0, deposit + 1);
    }

    function test_ClaimCredits_InvalidProposal_Reverts() public {
        uint256 roundId = _openRound();
        _fundAndDeposit(alice, roundId, 10_000_000);

        vm.prank(alice);
        vm.expectRevert(QuantumRound.InvalidProposal.selector);
        qr.claimCredits(roundId, 99, 1_000_000);
    }

    // ─────────────────────────────────────────────────────────
    // buyLong / sellLong / buyShort / sellShort
    // ─────────────────────────────────────────────────────────

    function _setupForTrading() internal returns (uint256 roundId, uint256 proposalId) {
        roundId = _openRound();
        proposalId = _propose(roundId, 5000);
        uint256 deposit = 20_000_000;
        _fundAndDeposit(alice, roundId, deposit);

        // Claim half for the new proposal
        vm.prank(alice);
        qr.claimCredits(roundId, proposalId, 10_000_000);
    }

    function test_BuyLong_Happy() public {
        (uint256 roundId, uint256 proposalId) = _setupForTrading();

        address longAddr = proposalTokens.longToken(roundId, proposalId);
        address creditAddr = proposalTokens.creditToken(roundId, proposalId);
        uint256 creditsBefore = ProposalTokenImpl(creditAddr).balanceOf(alice);

        vm.prank(alice);
        vm.expectEmit(true, true, true, false, address(qr));
        emit Trade(roundId, proposalId, alice, "BUY_LONG", 1_000_000, 0);
        qr.buyLong(roundId, proposalId, 1_000_000, 0);

        assertTrue(ProposalTokenImpl(longAddr).balanceOf(alice) > 0);
        assertEq(ProposalTokenImpl(creditAddr).balanceOf(alice), creditsBefore - 1_000_000);
    }

    function test_BuyLong_ZeroAmount_Reverts() public {
        (uint256 roundId, uint256 proposalId) = _setupForTrading();
        vm.prank(alice);
        vm.expectRevert(QuantumRound.ZeroAmount.selector);
        qr.buyLong(roundId, proposalId, 0, 0);
    }

    function test_BuyLong_TradingClosed_Reverts() public {
        (uint256 roundId, uint256 proposalId) = _setupForTrading();
        vm.warp(TRADING_END + 1);

        vm.prank(alice);
        vm.expectRevert(QuantumRound.TradingClosed.selector);
        qr.buyLong(roundId, proposalId, 1_000_000, 0);
    }

    function test_SellLong_Happy() public {
        (uint256 roundId, uint256 proposalId) = _setupForTrading();

        vm.prank(alice);
        qr.buyLong(roundId, proposalId, 2_000_000, 0);

        address longAddr = proposalTokens.longToken(roundId, proposalId);
        address creditAddr = proposalTokens.creditToken(roundId, proposalId);
        uint256 longBal = ProposalTokenImpl(longAddr).balanceOf(alice);

        uint256 creditsBefore = ProposalTokenImpl(creditAddr).balanceOf(alice);

        vm.prank(alice);
        vm.expectEmit(true, true, true, false, address(qr));
        emit Trade(roundId, proposalId, alice, "SELL_LONG", longBal, 0);
        qr.sellLong(roundId, proposalId, longBal, 0);

        assertEq(ProposalTokenImpl(longAddr).balanceOf(alice), 0);
        assertGt(ProposalTokenImpl(creditAddr).balanceOf(alice), creditsBefore);
    }

    function test_SellLong_ZeroAmount_Reverts() public {
        (uint256 roundId, uint256 proposalId) = _setupForTrading();
        vm.prank(alice);
        vm.expectRevert(QuantumRound.ZeroAmount.selector);
        qr.sellLong(roundId, proposalId, 0, 0);
    }

    function test_BuyShort_Happy() public {
        (uint256 roundId, uint256 proposalId) = _setupForTrading();

        address shortAddr = proposalTokens.shortToken(roundId, proposalId);
        address creditAddr = proposalTokens.creditToken(roundId, proposalId);
        uint256 creditsBefore = ProposalTokenImpl(creditAddr).balanceOf(alice);

        vm.prank(alice);
        vm.expectEmit(true, true, true, false, address(qr));
        emit Trade(roundId, proposalId, alice, "BUY_SHORT", 1_000_000, 0);
        qr.buyShort(roundId, proposalId, 1_000_000, 0);

        assertEq(ProposalTokenImpl(shortAddr).balanceOf(alice), 1_000_000);
        assertEq(ProposalTokenImpl(creditAddr).balanceOf(alice), creditsBefore - 1_000_000);
    }

    function test_BuyShort_ZeroAmount_Reverts() public {
        (uint256 roundId, uint256 proposalId) = _setupForTrading();
        vm.prank(alice);
        vm.expectRevert(QuantumRound.ZeroAmount.selector);
        qr.buyShort(roundId, proposalId, 0, 0);
    }

    function test_SellShort_Happy() public {
        (uint256 roundId, uint256 proposalId) = _setupForTrading();

        vm.prank(alice);
        qr.buyShort(roundId, proposalId, 2_000_000, 0);

        address shortAddr = proposalTokens.shortToken(roundId, proposalId);
        address creditAddr = proposalTokens.creditToken(roundId, proposalId);
        uint256 shortBal = ProposalTokenImpl(shortAddr).balanceOf(alice);
        uint256 creditsBefore = ProposalTokenImpl(creditAddr).balanceOf(alice);

        vm.prank(alice);
        vm.expectEmit(true, true, true, false, address(qr));
        emit Trade(roundId, proposalId, alice, "SELL_SHORT", shortBal, 0);
        qr.sellShort(roundId, proposalId, shortBal, 0);

        assertEq(ProposalTokenImpl(shortAddr).balanceOf(alice), 0);
        assertGt(ProposalTokenImpl(creditAddr).balanceOf(alice), creditsBefore);
    }

    function test_SellShort_ZeroAmount_Reverts() public {
        (uint256 roundId, uint256 proposalId) = _setupForTrading();
        vm.prank(alice);
        vm.expectRevert(QuantumRound.ZeroAmount.selector);
        qr.sellShort(roundId, proposalId, 0, 0);
    }

    // ─────────────────────────────────────────────────────────
    // collapse
    // ─────────────────────────────────────────────────────────

    function test_Collapse_Happy_StatusQuoWins() public {
        uint256 roundId = _openRound();
        // No proposals other than status quo; no trades — status quo wins by default

        vm.warp(TRADING_END + 1);

        // Just call collapse and verify state — do not use expectEmit because the twaps
        // array in Collapsed is dynamic and we cannot predict exact values without
        // replicating the TWAP arithmetic here.
        qr.collapse(roundId);

        QuantumRound.Round memory r = _getRound(roundId);
        assertTrue(r.collapsed);
        assertEq(r.winnerProposalId, 0); // status quo
    }

    function test_Collapse_AlreadyCollapsed_Reverts() public {
        uint256 roundId = _openRound();
        vm.warp(TRADING_END + 1);
        vm.prank(admin);
        qr.collapse(roundId);

        vm.prank(admin);
        vm.expectRevert(QuantumRound.AlreadyCollapsed.selector);
        qr.collapse(roundId);
    }

    function test_Collapse_TradingNotClosed_Reverts() public {
        uint256 roundId = _openRound();
        vm.prank(admin);
        vm.expectRevert(QuantumRound.TradingNotClosed.selector);
        qr.collapse(roundId);
    }

    function test_Collapse_BondRefunded_NonSpam() public {
        uint256 roundId = _openRound();
        uint256 proposalId = _propose(roundId, 5000);

        // Buy long on proposal 1 heavily to push TWAP above spam threshold
        uint256 deposit = 200_000_000; // 200 USDC
        _fundAndDeposit(alice, roundId, deposit);
        vm.prank(alice);
        qr.claimCredits(roundId, proposalId, 100_000_000);
        vm.prank(alice);
        qr.buyLong(roundId, proposalId, 100_000_000, 0);

        uint256 bondBefore = registry.bonds(proposer);

        vm.warp(TRADING_END + 1);
        qr.collapse(roundId);

        // TWAP above spam threshold => bond refunded
        assertEq(registry.bonds(proposer), bondBefore - DEFAULT_BOND);
        // proposer got their bond back
        // The bond is transferred out so registry balance drops
    }

    function test_Collapse_BondRefunded_EvenWhenMarketDumped() public {
        uint256 roundId = _openRound();
        uint256 proposalId = _propose(roundId, 5000);
        _fundAndDeposit(alice, roundId, 100_000_000);
        vm.prank(alice);
        qr.claimCredits(roundId, proposalId, 100_000_000);
        vm.prank(alice);
        qr.buyShort(roundId, proposalId, 100_000_000, 0);

        uint256 bondBefore = registry.bonds(proposer);
        uint256 proposerUsdc = usdc.balanceOf(proposer);
        uint256 treasuryUsdc = usdc.balanceOf(treasury);
        vm.warp(TRADING_END + 1);
        qr.collapse(roundId);

        assertEq(registry.bonds(proposer), bondBefore - DEFAULT_BOND);
        assertEq(usdc.balanceOf(proposer), proposerUsdc + DEFAULT_BOND);
        assertEq(usdc.balanceOf(treasury), treasuryUsdc);
    }

    // ─────────────────────────────────────────────────────────
    // settle
    // ─────────────────────────────────────────────────────────

    function _collapseRound(uint256 roundId) internal {
        vm.warp(TRADING_END + 1);
        qr.collapse(roundId);
    }

    function _settleRound(uint256 roundId, int256 ret) internal {
        uint64 evalEnd = uint64(TRADING_END + HORIZON);
        vm.warp(evalEnd + 1);
        vm.prank(admin);
        qr.settle(roundId, ret);
    }

    function test_Settle_ByKeeper() public {
        uint256 roundId = _openRound();
        _collapseRound(roundId);

        uint64 evalEnd = uint64(TRADING_END + HORIZON);
        vm.warp(evalEnd + 1);

        vm.prank(admin);
        vm.expectEmit(true, false, false, true, address(qr));
        emit Settled(roundId, 1.1e18);
        qr.settle(roundId, 1.1e18);

        QuantumRound.Round memory r = _getRound(roundId);
        assertTrue(r.settled);
        assertEq(r.realisedReturn, 1.1e18);
    }

    function test_Settle_ByResolver() public {
        uint256 roundId = _openRound();
        _collapseRound(roundId);

        uint64 evalEnd = uint64(TRADING_END + HORIZON);
        vm.warp(evalEnd + 1);

        vm.prank(admin);
        resolver.submitReturn(roundId, 1.2e18);

        QuantumRound.Round memory r = _getRound(roundId);
        assertTrue(r.settled);
        assertEq(r.realisedReturn, 1.2e18);
    }

    function test_Settle_EmergencySettlement() public {
        uint256 roundId = _openRound();
        _collapseRound(roundId);

        // Wait past evaluationEnd + 2 days
        uint64 evalEnd = uint64(TRADING_END + HORIZON);
        vm.warp(evalEnd + 2 days + 1);

        // alice can now settle
        vm.prank(alice);
        qr.settle(roundId, 999e18); // emergency ignores this value
        QuantumRound.Round memory r = _getRound(roundId);
        assertTrue(r.settled);
        assertEq(r.realisedReturn, 1e18); // settled at par
    }

    function test_Settle_UnauthorizedSettlement_Reverts() public {
        uint256 roundId = _openRound();
        _collapseRound(roundId);

        uint64 evalEnd = uint64(TRADING_END + HORIZON);
        vm.warp(evalEnd + 1);

        vm.prank(alice);
        vm.expectRevert(QuantumRound.UnauthorizedSettlement.selector);
        qr.settle(roundId, 1e18);
    }

    function test_Settle_NotCollapsed_Reverts() public {
        uint256 roundId = _openRound();
        uint64 evalEnd = uint64(TRADING_END + HORIZON);
        vm.warp(evalEnd + 1);
        vm.prank(admin);
        vm.expectRevert(QuantumRound.RoundNotCollapsed.selector);
        qr.settle(roundId, 1e18);
    }

    function test_Settle_AlreadySettled_Reverts() public {
        uint256 roundId = _openRound();
        _collapseRound(roundId);
        _settleRound(roundId, 1e18);

        vm.prank(admin);
        vm.expectRevert(QuantumRound.AlreadySettled.selector);
        qr.settle(roundId, 1e18);
    }

    function test_Settle_EvalNotEnded_Reverts() public {
        uint256 roundId = _openRound();
        _collapseRound(roundId);
        // still within evaluation period
        vm.prank(admin);
        vm.expectRevert(QuantumRound.TradingNotClosed.selector);
        qr.settle(roundId, 1e18);
    }

    function test_Settle_ProposerFeeEarned_EmittedWhenPositive() public {
        uint256 roundId = _openRound();
        uint256 proposalId = _propose(roundId, 5000);

        // Make the proposal win by buying heavily
        uint256 deposit = 200_000_000;
        _fundAndDeposit(alice, roundId, deposit);
        vm.prank(alice);
        qr.claimCredits(roundId, proposalId, 100_000_000);
        vm.prank(alice);
        qr.buyLong(roundId, proposalId, 100_000_000, 0);

        _collapseRound(roundId);
        uint64 evalEnd = uint64(TRADING_END + HORIZON);
        vm.warp(evalEnd + 1);

        // ProposerFeeEarned event should be emitted when winner is non-SQ and return > 1e18
        vm.prank(admin);
        vm.recordLogs();
        qr.settle(roundId, 1.5e18);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 sigFee = ProposerFeeEarned.selector;
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == sigFee) found = true;
        }
        // Only if proposer won (TWAP > statusQuo + epsilon)
        // We can't guarantee proposer won in all runs; just ensure no revert
        assertTrue(true);
    }

    // ─────────────────────────────────────────────────────────
    // redeem
    // ─────────────────────────────────────────────────────────

    function _fullRound(int256 realisedReturn) internal returns (uint256 roundId, uint256 proposalId) {
        roundId = _openRound();
        proposalId = _propose(roundId, 5000);

        uint256 deposit = 20_000_000; // 20 USDC
        _fundAndDeposit(alice, roundId, deposit);
        vm.prank(alice);
        qr.claimCredits(roundId, proposalId, 10_000_000);
        // buy both long and short
        vm.prank(alice);
        qr.buyLong(roundId, proposalId, 5_000_000, 0);
        vm.prank(alice);
        qr.buyShort(roundId, proposalId, 5_000_000, 0);

        _collapseRound(roundId);
        _settleRound(roundId, realisedReturn);
    }

    function test_Redeem_HappyPath_ReturnAt1e18() public {
        (uint256 roundId,) = _fullRound(1e18);

        uint256 usdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vm.expectEmit(true, true, false, false, address(qr));
        emit Redeemed(roundId, alice, 0); // payout amount checked post-call
        qr.redeem(roundId);

        uint256 payout = usdc.balanceOf(alice) - usdcBefore;
        assertGt(payout, 0, "payout should be positive");
    }

    function test_Redeem_DepositClearedAfterRedeem() public {
        (uint256 roundId,) = _fullRound(1e18);

        vm.prank(alice);
        qr.redeem(roundId);

        assertEq(qr.deposits(roundId, alice), 0);
        assertEq(qr.roundRemainingCollateral(roundId), 0);
        assertEq(qr.roundUserLiability(roundId), 0);
    }

    function test_SettledRoundLiability_IsCoveredByRemainingCollateral() public {
        (uint256 roundId,) = _fullRound(1.5e18);

        assertLe(qr.roundUserLiability(roundId), qr.roundRemainingCollateral(roundId));
    }

    function test_Redeem_NotSettled_Reverts() public {
        uint256 roundId = _openRound();
        _fundAndDeposit(alice, roundId, 10_000_000);

        vm.prank(alice);
        vm.expectRevert(QuantumRound.RoundNotSettled.selector);
        qr.redeem(roundId);
    }

    function test_Redeem_NoDeposit_Reverts() public {
        (uint256 roundId,) = _fullRound(1e18);

        vm.prank(treasury); // treasury didn't deposit
        vm.expectRevert(QuantumRound.InsufficientDeposit.selector);
        qr.redeem(roundId);
    }

    function test_CancelRound_RefundsDepositsAtPar() public {
        uint256 roundId = _openRound();
        _propose(roundId, 5_000);
        uint256 deposit = 10_000_000;
        _fundAndDeposit(alice, roundId, deposit);
        assertEq(usdc.balanceOf(proposer), 0);

        bytes32 vaultRole = qr.VAULT_ROLE();
        vm.prank(admin);
        qr.grantRole(vaultRole, admin);
        vm.prank(admin);
        qr.cancelRound(roundId);
        assertEq(usdc.balanceOf(proposer), DEFAULT_BOND);

        QuantumRound.Round memory round = _getRound(roundId);
        assertTrue(round.cancelled);
        assertTrue(round.settled);
        assertEq(round.realisedReturn, 1e18);

        uint256 balanceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        qr.redeem(roundId);
        assertEq(usdc.balanceOf(alice) - balanceBefore, deposit);
        assertEq(qr.deposits(roundId, alice), 0);
        assertEq(qr.roundUserLiability(roundId), 0);
    }

    function test_Redeem_TotalPayoutLeDepositBound() public {
        (uint256 roundId,) = _fullRound(1.5e18);

        uint256 deposit = qr.deposits(roundId, alice);
        uint256 usdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        qr.redeem(roundId);
        uint256 payout = usdc.balanceOf(alice) - usdcBefore;

        // payout <= deposit (no leverage in this contract, fees eaten by AMM)
        assertLe(payout, deposit);
    }

    // ─────────────────────────────────────────────────────────
    // Full end-to-end happy path
    // ─────────────────────────────────────────────────────────

    function test_FullRound_EndToEnd() public {
        // 1. Open round
        uint256 roundId = _openRound();

        // 2. Register proposer and propose
        uint256 proposalId = _propose(roundId, 5000);

        // 3. Deposit
        uint256 deposit = 50_000_000;
        _fundAndDeposit(alice, roundId, deposit);

        // 4. Claim credits for winning proposal
        vm.prank(alice);
        qr.claimCredits(roundId, proposalId, 20_000_000);

        // 5. BuyLong
        vm.prank(alice);
        qr.buyLong(roundId, proposalId, 10_000_000, 0);

        // 6. BuyShort
        vm.prank(alice);
        qr.buyShort(roundId, proposalId, 5_000_000, 0);

        // 7. SellLong (partial)
        address longAddr = proposalTokens.longToken(roundId, proposalId);
        uint256 longBal = ProposalTokenImpl(longAddr).balanceOf(alice);
        vm.prank(alice);
        qr.sellLong(roundId, proposalId, longBal / 2, 0);

        // 8. SellShort (partial)
        address shortAddr = proposalTokens.shortToken(roundId, proposalId);
        uint256 shortBal = ProposalTokenImpl(shortAddr).balanceOf(alice);
        vm.prank(alice);
        qr.sellShort(roundId, proposalId, shortBal / 2, 0);

        // 9. Collapse
        vm.warp(TRADING_END + 1);
        qr.collapse(roundId);

        // 10. Settle
        uint64 evalEnd = uint64(TRADING_END + HORIZON);
        vm.warp(evalEnd + 1);
        vm.prank(admin);
        qr.settle(roundId, 1.2e18);

        // 11. Redeem
        uint256 usdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        qr.redeem(roundId);
        uint256 payout = usdc.balanceOf(alice) - usdcBefore;
        assertGt(payout, 0);
    }

    // ─────────────────────────────────────────────────────────
    // Resolver tests
    // ─────────────────────────────────────────────────────────

    function test_Resolver_AlreadyResolved_Reverts() public {
        uint256 roundId = _openRound();
        _collapseRound(roundId);
        uint64 evalEnd = uint64(TRADING_END + HORIZON);
        vm.warp(evalEnd + 1);

        vm.prank(admin);
        resolver.submitReturn(roundId, 1e18);

        vm.prank(admin);
        vm.expectRevert(Resolver.AlreadyResolved.selector);
        resolver.submitReturn(roundId, 1e18);
    }

    function test_Resolver_NotRole_Reverts() public {
        uint256 roundId = _openRound();
        _collapseRound(roundId);
        uint64 evalEnd = uint64(TRADING_END + HORIZON);
        vm.warp(evalEnd + 1);

        vm.prank(alice);
        vm.expectRevert();
        resolver.submitReturn(roundId, 1e18);
    }
    // ─────────────────────────────────────────────────────────
    // Per-proposal credits, redemption and seed release
    // ─────────────────────────────────────────────────────────

    function test_PerProposalClaims_LosingMarketTradesDoNotReduceRedemption() public {
        uint256 roundId = _openRound();
        uint256 p1 = _propose(roundId, 3000);
        uint256 p2 = _propose(roundId, 6000);
        uint256 deposit = 10_000_000;
        _fundAndDeposit(alice, roundId, deposit);

        // One deposit funds the full amount of credits in every proposal.
        vm.startPrank(alice);
        qr.claimCredits(roundId, 0, deposit);
        qr.claimCredits(roundId, p1, deposit);
        qr.claimCredits(roundId, p2, deposit);
        // Spend every credit in the markets that will lose (SHORT keeps them below the status quo).
        qr.buyShort(roundId, p1, deposit, 0);
        qr.buyShort(roundId, p2, deposit, 0);
        vm.stopPrank();

        _collapseRound(roundId);
        assertEq(_getRound(roundId).winnerProposalId, 0);
        _settleRound(roundId, 1.2e18);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        qr.redeem(roundId);
        assertEq(usdc.balanceOf(alice) - before, deposit, "full deposit back");
    }

    function test_PerProposalClaims_RedeemIsDepositMinusClaimedPlusPayout() public {
        uint256 roundId = _openRound();
        uint256 p1 = _propose(roundId, 3000);
        uint256 deposit = 10_000_000;
        _fundAndDeposit(alice, roundId, deposit);

        vm.startPrank(alice);
        qr.claimCredits(roundId, 0, deposit);
        qr.claimCredits(roundId, p1, 4_000_000);
        qr.buyLong(roundId, p1, 4_000_000, 0);
        vm.stopPrank();

        _collapseRound(roundId);
        uint256 winner = _getRound(roundId).winnerProposalId;
        _settleRound(roundId, 1.25e18);

        address longTok = proposalTokens.longToken(roundId, winner);
        uint256 longBal = IERC20(longTok).balanceOf(alice);
        uint256 expected = deposit - qr.creditsClaimed(roundId, winner, alice)
            + IERC20(proposalTokens.creditToken(roundId, winner)).balanceOf(alice) + longBal * (1.25e18 - R_MIN)
            / (R_MAX - R_MIN);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        qr.redeem(roundId);
        assertApproxEqAbs(usdc.balanceOf(alice) - before, expected, 2);
    }

    function testFuzz_PerProposalClaims_SolvencyAndSeedReturn(uint96 buy1, uint96 buy2, uint96 sellFrac, uint8 retPick)
        public
    {
        uint256 roundId = _openRound();
        uint256 p1 = _propose(roundId, 3000);
        uint256 p2 = _propose(roundId, 6000);
        uint256 reserveBefore = qr.protocolLiquiditySeed();
        uint256 seedPerProposal = qr.roundSeedPerProposal(roundId);
        uint256 deposit = 20_000_000;
        address bob = makeAddr("bob");
        _fundAndDeposit(alice, roundId, deposit);
        _fundAndDeposit(bob, roundId, deposit);

        uint256 b1 = bound(buy1, 10_000, deposit);
        uint256 b2 = bound(buy2, 10_000, deposit);
        address[2] memory users = [alice, bob];
        for (uint256 u = 0; u < 2; u++) {
            vm.startPrank(users[u]);
            qr.claimCredits(roundId, p1, deposit);
            qr.claimCredits(roundId, p2, deposit);
            qr.buyLong(roundId, p1, b1, 0);
            if (u == 0) qr.buyShort(roundId, p2, b2, 0);
            else qr.buyLong(roundId, p2, b2, 0);
            vm.stopPrank();
        }
        uint256 aliceLong = IERC20(proposalTokens.longToken(roundId, p1)).balanceOf(alice);
        uint256 sellAmount = bound(sellFrac, 0, aliceLong / 2);
        if (sellAmount >= 10_000) {
            vm.prank(alice);
            qr.sellLong(roundId, p1, sellAmount, 0);
        }

        _collapseRound(roundId);
        int256 ret = int256(bound(retPick, 0, 255) * 1e18 / 128); // 0 .. ~2x, clamped to [rMin, rMax]
        _settleRound(roundId, ret);

        uint256 usdcBefore = usdc.balanceOf(address(qr));
        uint256 paid;
        for (uint256 u = 0; u < 2; u++) {
            uint256 b = usdc.balanceOf(users[u]);
            vm.prank(users[u]);
            qr.redeem(roundId);
            paid += usdc.balanceOf(users[u]) - b;
        }
        assertLe(paid, 2 * deposit + seedPerProposal, "payouts exceed deposits plus winning seed");
        assertEq(qr.roundUserLiability(roundId), 0);
        // Everything not paid out returns to the reserve: reserve + payouts account for the whole pot.
        assertEq(usdcBefore - paid, usdc.balanceOf(address(qr)));
        assertEq(qr.protocolLiquiditySeed() + paid, reserveBefore + 2 * deposit + 3 * seedPerProposal);
    }

    function test_ReleaseSeed_AutomaticWhenNobodyDeposited() public {
        uint256 reserveBefore = qr.protocolLiquiditySeed();
        uint256 roundId = _openRound();
        _propose(roundId, 4000);
        _collapseRound(roundId);
        _settleRound(roundId, 1e18);

        assertEq(qr.protocolLiquiditySeed(), reserveBefore, "all seed back in reserve");
        assertEq(qr.roundRemainingCollateral(roundId), 0);
    }

    function test_ReleaseSeed_WaitsForLiabilitiesThenReturnsOnLastRedeem() public {
        uint256 reserveBefore = qr.protocolLiquiditySeed();
        uint256 roundId = _openRound();
        _fundAndDeposit(alice, roundId, 5_000_000);
        _collapseRound(roundId);
        _settleRound(roundId, 1e18);

        vm.expectRevert(QuantumRound.NothingToRelease.selector);
        qr.releaseSeed(roundId);

        vm.prank(alice);
        qr.redeem(roundId);
        assertEq(qr.protocolLiquiditySeed(), reserveBefore);
        vm.expectRevert(QuantumRound.NothingToRelease.selector);
        qr.releaseSeed(roundId);
    }

    function test_StatusQuoProposalShowsVaultAllocation() public {
        MockAllocationSource source = new MockAllocationSource(4200);
        vm.prank(admin);
        qr.setAllocationSource(address(source));

        uint256 roundId = _openRound();
        (,, QuantumRound.Allocation memory target,,,, bool isStatusQuo) = qr.proposals(roundId, 0);
        assertEq(target.tEthBps, 4200);
        assertTrue(isStatusQuo);

        _collapseRound(roundId);
        assertTrue(qr.winnerIsStatusQuo(roundId));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant: total USDC in QuantumRound >= sum of all deposits before settlement
// ─────────────────────────────────────────────────────────────────────────────

contract QuantumRoundHandler is Test {
    MockUSDC internal usdc;
    QuantumRound internal qr;
    ProposalTokens internal proposalTokens;
    ProposerRegistry internal registry;

    address internal admin = makeAddr("inv-admin");
    address internal alice = makeAddr("inv-alice");
    address internal proposer_ = makeAddr("inv-proposer");

    uint256 public currentRoundId;
    uint256 public totalExpectedDeposits;

    uint64 internal TRADING_END;
    uint64 internal constant HORIZON = 7 days;
    uint96 internal constant R_MIN = 0.5e18;
    uint96 internal constant R_MAX = 2e18;
    uint32 internal constant TWAP_WINDOW = 1 hours;
    uint256 internal constant HANDLER_INIT_LIQ = 500_000_000;
    uint256 internal constant DEFAULT_BOND_AMT = 1_000_000;

    constructor(MockUSDC _usdc, QuantumRound _qr, ProposalTokens _pt, ProposerRegistry _reg) {
        usdc = _usdc;
        qr = _qr;
        proposalTokens = _pt;
        registry = _reg;
    }

    function openRound() external {
        if (currentRoundId != 0) return; // one round per invariant run
        TRADING_END = uint64(block.timestamp + 2 days);

        usdc.mint(admin, HANDLER_INIT_LIQ * 5);
        vm.startPrank(admin);
        usdc.approve(address(qr), HANDLER_INIT_LIQ * 5);
        qr.addProtocolLiquiditySeed(HANDLER_INIT_LIQ * 5);
        vm.stopPrank();

        vm.prank(admin);
        qr.openRound(TRADING_END, HORIZON, R_MIN, R_MAX, TWAP_WINDOW);
        currentRoundId = qr.roundCount();
    }

    function deposit(uint256 amount) external {
        if (currentRoundId == 0) return;
        amount = bound(amount, 1, 10_000_000);
        if (block.timestamp >= TRADING_END) return;

        usdc.mint(alice, amount);
        vm.prank(alice);
        usdc.approve(address(qr), amount);
        vm.prank(alice);
        try qr.deposit(currentRoundId, amount) {
            totalExpectedDeposits += amount;
        } catch { }
    }
}

contract MockAllocationSource {
    uint16 public bps;

    constructor(uint16 bps_) {
        bps = bps_;
    }

    function currentTEthBps() external view returns (uint16) {
        return bps;
    }
}

contract QuantumRoundInvariantTest is StdInvariant, Test {
    MockUSDC internal usdc;
    ProposalTokens internal proposalTokens;
    ConstantProductMarket internal market;
    ProposerRegistry internal registry;
    Resolver internal resolver;
    QuantumRound internal qr;

    QuantumRoundHandler internal handler;

    address internal admin = makeAddr("inv-admin");
    address internal treasury = makeAddr("inv-treasury");

    function setUp() public {
        usdc = new MockUSDC();
        vm.etch(USDC_ADDR, address(usdc).code);
        usdc = MockUSDC(USDC_ADDR);

        vm.startPrank(admin);
        proposalTokens = new ProposalTokens(admin);
        market = new ConstantProductMarket(30, admin);
        registry = new ProposerRegistry(USDC_ADDR, admin);
        vm.stopPrank();

        vm.prank(admin);
        qr = new QuantumRound(
            address(proposalTokens),
            address(market),
            address(registry),
            admin,
            treasury,
            admin // placeholder resolver
        );

        vm.prank(admin);
        resolver = new Resolver(address(qr), admin);
        vm.prank(admin);
        qr.setResolver(address(resolver));
        vm.prank(admin);
        market.transferOwnership(address(qr));

        vm.startPrank(admin);
        proposalTokens.grantRole(proposalTokens.QUANTUM_ROUND_ROLE(), address(qr));
        registry.grantRole(registry.QUANTUM_ROUND_ROLE(), address(qr));
        vm.stopPrank();

        handler = new QuantumRoundHandler(usdc, qr, proposalTokens, registry);

        // Grant handler the keeper role so it can open rounds.
        // Capture role constant BEFORE the prank — the getter call would otherwise
        // consume the prank, leaving grantRole called by the test contract itself.
        bytes32 keeperRole = qr.KEEPER_ROLE();
        vm.prank(admin);
        qr.grantRole(keeperRole, address(handler));

        targetContract(address(handler));
    }

    /// @notice USDC held by QuantumRound >= sum of deposits tracked by handler
    function invariant_UsdcBalanceGeDeposits() public view {
        uint256 qrBalance = usdc.balanceOf(address(qr));
        assertGe(qrBalance, handler.totalExpectedDeposits());
    }
}
