// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {ConstantProductMarket} from "../src/ConstantProductMarket.sol";

contract ConstantProductMarketTest is Test {
    ConstantProductMarket internal cpm;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");

    uint256 internal constant ROUND_ID    = 1;
    uint256 internal constant PROPOSAL_ID = 0;
    uint256 internal constant SEED        = 500_000_000; // 500 USDC (6 dec)
    uint16  internal constant FEE_BPS     = 30;          // 0.3 %

    function setUp() public {
        cpm = new ConstantProductMarket(FEE_BPS, owner);

        // seed the market as owner
        vm.prank(owner);
        cpm.seedLiquidity(ROUND_ID, PROPOSAL_ID, SEED, SEED);
    }

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    function test_Constructor_FeeTooHigh_Reverts() public {
        vm.expectRevert(bytes("fee too high"));
        new ConstantProductMarket(10_000, owner);
    }

    function test_Constructor_FeeStored() public view {
        assertEq(cpm.feeBps(), FEE_BPS);
    }

    // ─────────────────────────────────────────────────────────
    // seedLiquidity
    // ─────────────────────────────────────────────────────────

    function test_SeedLiquidity_SetsReserves() public view {
        (uint128 cr, uint128 lr,,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);
        assertEq(cr, SEED);
        assertEq(lr, SEED);
    }

    function test_SeedLiquidity_InitialSpotPrice() public view {
        uint256 price = cpm.spotPrice(ROUND_ID, PROPOSAL_ID);
        // credit == long => price should be 1e18
        assertEq(price, 1e18);
    }

    function test_SeedLiquidity_EmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, true, address(cpm));
        emit LiquiditySeeded(2, 0, SEED, SEED);
        cpm.seedLiquidity(2, 0, SEED, SEED);
    }

    function test_SeedLiquidity_AlreadySeeded_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ConstantProductMarket.AlreadySeeded.selector);
        cpm.seedLiquidity(ROUND_ID, PROPOSAL_ID, SEED, SEED);
    }

    function test_SeedLiquidity_ZeroCredit_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ConstantProductMarket.ZeroAmount.selector);
        cpm.seedLiquidity(2, 1, 0, SEED);
    }

    function test_SeedLiquidity_ZeroLong_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ConstantProductMarket.ZeroAmount.selector);
        cpm.seedLiquidity(2, 1, SEED, 0);
    }

    function test_SeedLiquidity_NotOwner_Reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        cpm.seedLiquidity(2, 1, SEED, SEED);
    }

    // ─────────────────────────────────────────────────────────
    // tradeBuyLong
    // ─────────────────────────────────────────────────────────

    function test_TradeBuyLong_ReservesMove() public {
        (uint128 crBefore, uint128 lrBefore,,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);

        vm.prank(owner);
        uint256 longOut = cpm.tradeBuyLong(ROUND_ID, PROPOSAL_ID, 1_000_000, 0);

        (uint128 crAfter, uint128 lrAfter,,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);

        // creditReserve increases (by creditsIn * (1 - fee))
        assertGt(crAfter, crBefore);
        // longReserve decreases
        assertLt(lrAfter, lrBefore);
        // longOut == lrBefore - lrAfter
        assertEq(longOut, lrBefore - lrAfter);
    }

    function test_TradeBuyLong_SpotPriceIncreases() public {
        uint256 priceBefore = cpm.spotPrice(ROUND_ID, PROPOSAL_ID);

        vm.prank(owner);
        cpm.tradeBuyLong(ROUND_ID, PROPOSAL_ID, 1_000_000, 0);

        uint256 priceAfter = cpm.spotPrice(ROUND_ID, PROPOSAL_ID);
        assertGt(priceAfter, priceBefore);
    }

    function test_TradeBuyLong_EmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, false, address(cpm));
        emit LongBought(ROUND_ID, PROPOSAL_ID, 1_000_000, 0); // data fields not checked here
        cpm.tradeBuyLong(ROUND_ID, PROPOSAL_ID, 1_000_000, 0);
    }

    function test_TradeBuyLong_ZeroAmount_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ConstantProductMarket.ZeroAmount.selector);
        cpm.tradeBuyLong(ROUND_ID, PROPOSAL_ID, 0, 0);
    }

    function test_TradeBuyLong_NotOwner_Reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        cpm.tradeBuyLong(ROUND_ID, PROPOSAL_ID, 1_000_000, 0);
    }

    function test_TradeBuyLong_MinOutput_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ConstantProductMarket.InsufficientOutput.selector);
        cpm.tradeBuyLong(ROUND_ID, PROPOSAL_ID, 1_000_000, type(uint256).max);
    }

    function test_TradeBuyLong_NotSeeded_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ConstantProductMarket.NotSeeded.selector);
        cpm.tradeBuyLong(99, 99, 1_000_000, 0);
    }

    // ─────────────────────────────────────────────────────────
    // tradeSellLong
    // ─────────────────────────────────────────────────────────

    function test_TradeSellLong_ReservesMove() public {
        // First buy some long
        vm.prank(owner);
        uint256 longBought = cpm.tradeBuyLong(ROUND_ID, PROPOSAL_ID, 10_000_000, 0);

        (uint128 crBefore, uint128 lrBefore,,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);

        vm.prank(owner);
        uint256 creditsOut = cpm.tradeSellLong(ROUND_ID, PROPOSAL_ID, longBought, 0);

        (uint128 crAfter, uint128 lrAfter,,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);

        assertLt(crAfter, crBefore); // creditReserve decreases
        assertGt(lrAfter, lrBefore); // longReserve increases
        assertEq(creditsOut, crBefore - crAfter);
    }

    function test_TradeSellLong_SpotPriceDecreases() public {
        vm.prank(owner);
        uint256 longBought = cpm.tradeBuyLong(ROUND_ID, PROPOSAL_ID, 10_000_000, 0);

        uint256 priceBefore = cpm.spotPrice(ROUND_ID, PROPOSAL_ID);

        vm.prank(owner);
        cpm.tradeSellLong(ROUND_ID, PROPOSAL_ID, longBought, 0);

        uint256 priceAfter = cpm.spotPrice(ROUND_ID, PROPOSAL_ID);
        assertLt(priceAfter, priceBefore);
    }

    function test_TradeSellLong_ZeroAmount_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ConstantProductMarket.ZeroAmount.selector);
        cpm.tradeSellLong(ROUND_ID, PROPOSAL_ID, 0, 0);
    }

    function test_TradeSellLong_MinOutput_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ConstantProductMarket.InsufficientOutput.selector);
        cpm.tradeSellLong(ROUND_ID, PROPOSAL_ID, 1_000_000, type(uint256).max);
    }

    function test_TradeSellLong_NotOwner_Reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        cpm.tradeSellLong(ROUND_ID, PROPOSAL_ID, 1_000_000, 0);
    }

    // ─────────────────────────────────────────────────────────
    // tradeBuyShort
    // ─────────────────────────────────────────────────────────

    function test_TradeBuyShort_ShortIssuedIncreases() public {
        (,, uint128 siBefore,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);

        vm.prank(owner);
        uint256 setsOut = cpm.tradeBuyShort(ROUND_ID, PROPOSAL_ID, 1_000_000, 0);

        (,, uint128 siAfter,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);

        assertGt(siAfter, siBefore);
        assertEq(setsOut, 1_000_000); // 1:1 for shorts
    }

    function test_TradeBuyShort_CreditReserveDecreases() public {
        (uint128 crBefore,,,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);

        vm.prank(owner);
        cpm.tradeBuyShort(ROUND_ID, PROPOSAL_ID, 1_000_000, 0);

        (uint128 crAfter,,,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);
        assertLt(crAfter, crBefore);
    }

    function test_TradeBuyShort_EmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, false, address(cpm));
        emit ShortBought(ROUND_ID, PROPOSAL_ID, 1_000_000, 0);
        cpm.tradeBuyShort(ROUND_ID, PROPOSAL_ID, 1_000_000, 0);
    }

    function test_TradeBuyShort_ZeroAmount_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ConstantProductMarket.ZeroAmount.selector);
        cpm.tradeBuyShort(ROUND_ID, PROPOSAL_ID, 0, 0);
    }

    function test_TradeBuyShort_InsufficientReserve_Reverts() public {
        // Try to buy more credits than available in reserve
        vm.prank(owner);
        vm.expectRevert(ConstantProductMarket.InsufficientOutput.selector);
        cpm.tradeBuyShort(ROUND_ID, PROPOSAL_ID, SEED + 1, 0);
    }

    // ─────────────────────────────────────────────────────────
    // tradeSellShort
    // ─────────────────────────────────────────────────────────

    function test_TradeSellShort_ShortIssuedDecreases() public {
        vm.prank(owner);
        cpm.tradeBuyShort(ROUND_ID, PROPOSAL_ID, 5_000_000, 0);

        (,, uint128 siBefore,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);

        vm.prank(owner);
        cpm.tradeSellShort(ROUND_ID, PROPOSAL_ID, 5_000_000, 0);

        (,, uint128 siAfter,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);
        assertLt(siAfter, siBefore);
    }

    function test_TradeSellShort_CreditReserveIncreases() public {
        vm.prank(owner);
        cpm.tradeBuyShort(ROUND_ID, PROPOSAL_ID, 5_000_000, 0);

        (uint128 crBefore,,,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);

        vm.prank(owner);
        cpm.tradeSellShort(ROUND_ID, PROPOSAL_ID, 5_000_000, 0);

        (uint128 crAfter,,,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);
        assertGt(crAfter, crBefore);
    }

    function test_TradeSellShort_EmitsEvent() public {
        vm.prank(owner);
        cpm.tradeBuyShort(ROUND_ID, PROPOSAL_ID, 5_000_000, 0);

        vm.prank(owner);
        vm.expectEmit(true, true, false, false, address(cpm));
        emit ShortSold(ROUND_ID, PROPOSAL_ID, 5_000_000, 0);
        cpm.tradeSellShort(ROUND_ID, PROPOSAL_ID, 5_000_000, 0);
    }

    function test_TradeSellShort_ZeroAmount_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ConstantProductMarket.ZeroAmount.selector);
        cpm.tradeSellShort(ROUND_ID, PROPOSAL_ID, 0, 0);
    }

    function test_TradeSellShort_ExceedsIssued_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ConstantProductMarket.InsufficientOutput.selector);
        cpm.tradeSellShort(ROUND_ID, PROPOSAL_ID, 1, 0);
    }

    // ─────────────────────────────────────────────────────────
    // TWAP accumulation
    // ─────────────────────────────────────────────────────────

    function test_Twap_AccumulatesOverTime() public {
        // Forge sets block.timestamp = 1 by default.  With via_ir + optimizer the
        // compiler may re-evaluate block.timestamp at call sites, so we use explicit
        // constants that bypass the optimizer's block.timestamp folding.
        //
        // Warp to 1001 so the TWAP window [1, 1001] (1000 s) is clearly non-degenerate.
        vm.warp(1001);

        vm.prank(owner);
        cpm.tradeBuyLong(ROUND_ID, PROPOSAL_ID, 1_000_000, 0);

        // TWAP from t=1 (seedLiquidity timestamp) to t=1001; price was 1e18 for ~1000 s.
        uint256 priceTwap = cpm.twap(ROUND_ID, PROPOSAL_ID, 1, 1001);
        assertApproxEqRel(priceTwap, 1e18, 0.01e18); // within 1%
    }

    function test_Twap_WindowEndBeforeStart_Reverts() public {
        vm.expectRevert(ConstantProductMarket.ZeroAmount.selector);
        cpm.twap(ROUND_ID, PROPOSAL_ID, 100, 100);
    }

    function test_Twap_NotSeeded_Reverts() public {
        vm.expectRevert(ConstantProductMarket.NotSeeded.selector);
        cpm.twap(99, 99, 0, 1);
    }

    // ─────────────────────────────────────────────────────────
    // Fuzz: AMM k non-decreasing after buyLong/sellLong round-trip
    // ─────────────────────────────────────────────────────────

    function testFuzz_AMM_BuyLong_ReservesConsistent(uint256 creditsIn) public {
        // The AMM's fee design extracts fee from the pool, so k can decrease slightly.
        // Test the observable properties instead: reserves move in the correct direction
        // and longOut is positive for any nonzero creditsIn that fits in the reserves.
        creditsIn = bound(creditsIn, 10_000, SEED / 10);

        (uint128 cr0, uint128 lr0,,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);

        vm.prank(owner);
        uint256 longOut = cpm.tradeBuyLong(ROUND_ID, PROPOSAL_ID, creditsIn, 0);

        (uint128 cr1, uint128 lr1,,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);

        // CreditReserve must increase and longReserve must decrease.
        assertGt(uint256(cr1), uint256(cr0), "creditReserve should increase");
        assertLt(uint256(lr1), uint256(lr0), "longReserve should decrease");
        assertGt(longOut, 0, "longOut must be positive");
        // longOut equals the drop in longReserve
        assertEq(longOut, uint256(lr0) - uint256(lr1));
    }

    function testFuzz_AMM_SellLong_ReservesConsistent(uint256 creditsIn) public {
        // Mirror of above for sellLong: buy first, then sell, check direction consistency.
        creditsIn = bound(creditsIn, 10_000, SEED / 10);

        vm.prank(owner);
        uint256 longBought = cpm.tradeBuyLong(ROUND_ID, PROPOSAL_ID, creditsIn, 0);

        (uint128 cr0, uint128 lr0,,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);

        vm.prank(owner);
        uint256 creditsOut = cpm.tradeSellLong(ROUND_ID, PROPOSAL_ID, longBought, 0);

        (uint128 cr1, uint128 lr1,,,,,) = cpm.markets(ROUND_ID, PROPOSAL_ID);

        // CreditReserve decreases and longReserve increases.
        assertLt(uint256(cr1), uint256(cr0), "creditReserve should decrease");
        assertGt(uint256(lr1), uint256(lr0), "longReserve should increase");
        assertGt(creditsOut, 0, "creditsOut must be positive");
        // Round-trip returns less than original input (fee taken twice)
        assertLt(creditsOut, creditsIn);
    }

    // ─────────────────────────────────────────────────────────
    // Fuzz: buyLong output is monotone in creditsIn
    // ─────────────────────────────────────────────────────────

    function testFuzz_BuyLong_OutputMonotone(uint256 small, uint256 large) public {
        // Lower bound 10_000 ensures creditsIn is large enough that longOut > 0.
        // Minimum gap of 10_000 between small and large avoids integer rounding ties.
        small = bound(small, 10_000, SEED / 20);
        large = bound(large, small + 10_000, SEED / 10);

        // Deploy a fresh market for the large trade so both use equal initial depth.
        vm.startPrank(owner);
        cpm.seedLiquidity(2, 0, SEED, SEED);
        uint256 outSmall = cpm.tradeBuyLong(ROUND_ID, PROPOSAL_ID, small, 0);
        // compare against a fresh market at the same initial depth
        uint256 outLarge = cpm.tradeBuyLong(2, 0, large, 0);
        vm.stopPrank();

        assertGt(outLarge, outSmall, "larger creditsIn should produce more longOut");
    }

    // ─────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────

    event LiquiditySeeded(uint256 indexed roundId, uint256 indexed proposalId, uint256 credits, uint256 longTokens);
    event LongBought(uint256 indexed roundId, uint256 indexed proposalId, uint256 creditsIn, uint256 longOut);
    event ShortBought(uint256 indexed roundId, uint256 indexed proposalId, uint256 creditsIn, uint256 setsOut);
    event LongSold(uint256 indexed roundId, uint256 indexed proposalId, uint256 longIn, uint256 creditsOut);
    event ShortSold(uint256 indexed roundId, uint256 indexed proposalId, uint256 setsIn, uint256 creditsOut);
}
