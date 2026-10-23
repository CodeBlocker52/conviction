// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";

import { MockPriceOracle } from "../src/MockPriceOracle.sol";
import { WavefundVault } from "../src/WavefundVault.sol";
import { MockUSDC } from "../test-helpers/MockUSDC.sol";

address constant VAULT_TEST_USDC = 0x3600000000000000000000000000000000000000;

contract VaultTestRound {
    uint64 public evaluationEnd;
    bool public cancelled;

    function setEvaluationEnd(uint64 value) external {
        evaluationEnd = value;
    }

    function roundEvaluationEnd(uint256) external view returns (uint64) {
        return evaluationEnd;
    }

    function cancelRound(uint256) external {
        cancelled = true;
    }
}

contract VaultTestResolver {
    uint256 public lastRound;
    int256 public lastReturn;

    function submitReturn(uint256 roundId, int256 realisedReturn) external {
        lastRound = roundId;
        lastReturn = realisedReturn;
    }
}

contract WavefundVaultTest is Test {
    MockUSDC private usdc;
    MockPriceOracle private oracle;
    VaultTestRound private round;
    VaultTestResolver private resolver;
    WavefundVault private vault;

    function setUp() public {
        MockUSDC mockUsdc = new MockUSDC();
        vm.etch(VAULT_TEST_USDC, address(mockUsdc).code);
        usdc = MockUSDC(VAULT_TEST_USDC);

        oracle = new MockPriceOracle(address(this), address(this));
        oracle.updatePrice(300_000_000_000);

        round = new VaultTestRound();
        round.setEvaluationEnd(uint64(block.timestamp + 1 days));
        resolver = new VaultTestResolver();
        vault = new WavefundVault(
            address(0x1234), address(0x5678), address(resolver), address(round), address(oracle), 500, address(this)
        );

        usdc.mint(address(this), 10_000_000);
        usdc.approve(address(vault), 10_000_000);
        vault.fundVault(10_000_000);
    }

    function test_ExecuteTradeMarksOracleNavBeforeNoopTrade() public {
        vault.executeTrade(1, 0);

        (
            uint256 startValueUsdc,,
            uint256 usdcAtStart,
            uint256 startPriceUsdc,
            uint64 navTimestamp,
            bool executed,
            bool reported,
            bool cancelled
        ) = vault.roundState(1);

        assertEq(startValueUsdc, 10_000_000);
        assertEq(usdcAtStart, 10_000_000);
        assertEq(startPriceUsdc, 3_000_000_000);
        assertEq(navTimestamp, block.timestamp);
        assertTrue(executed);
        assertFalse(reported);
        assertFalse(cancelled);
    }

    function test_ExecuteTradeRejectsStaleOracle() public {
        vm.warp(block.timestamp + vault.MAX_ORACLE_AGE() + 1);

        vm.expectRevert(WavefundVault.StaleOraclePrice.selector);
        vault.executeTrade(1, 0);
    }

    function test_FundingMintsInitialOneDollarShares() public view {
        assertEq(vault.balanceOf(address(this)), 10e18);
        assertEq(vault.totalSupply(), 10e18);
        assertEq(vault.navPerShare(), 1_000_000e18);
        assertEq(vault.totalAssetsUsdc(), 10_000_000);
    }

    function test_QueuedDepositMintsSharesOnlyAtDecisionBoundary() public {
        address depositor = address(0xBEEF);
        usdc.mint(depositor, 2_000_000);

        vm.startPrank(depositor);
        usdc.approve(address(vault), 2_000_000);
        vault.requestDeposit(2_000_000);
        vm.stopPrank();

        assertEq(vault.balanceOf(depositor), 0);
        assertEq(vault.queuedDepositUsdc(depositor), 2_000_000);
        assertEq(vault.totalQueuedDepositUsdc(), 2_000_000);
        assertEq(vault.totalVaultUsdc(), 10_000_000);

        vault.executeTrade(1, 0);

        assertEq(vault.balanceOf(depositor), 2e18);
        assertEq(vault.queuedDepositUsdc(depositor), 0);
        assertEq(vault.totalQueuedDepositUsdc(), 0);
        assertEq(vault.totalVaultUsdc(), 12_000_000);
        assertEq(vault.totalSupply(), 12e18);
    }

    function test_QueuedWithdrawalBurnsSharesAndPaysAtDecisionBoundary() public {
        address depositor = address(0xBEEF);
        usdc.mint(depositor, 2_000_000);

        vm.startPrank(depositor);
        usdc.approve(address(vault), 2_000_000);
        vault.requestDeposit(2_000_000);
        vm.stopPrank();
        vault.executeTrade(1, 0);

        vm.prank(depositor);
        vault.requestWithdraw(1e18);

        assertEq(vault.balanceOf(depositor), 1e18);
        assertEq(vault.balanceOf(address(vault)), 1e18);
        assertEq(vault.queuedWithdrawalShares(depositor), 1e18);

        vault.executeTrade(2, 0);

        assertEq(vault.balanceOf(depositor), 1e18);
        assertEq(vault.balanceOf(address(vault)), 0);
        assertEq(vault.queuedWithdrawalShares(depositor), 0);
        assertEq(usdc.balanceOf(depositor), 1_000_000);
        assertEq(vault.totalVaultUsdc(), 11_000_000);
        assertEq(vault.totalSupply(), 11e18);
    }

    function test_QueuedWithdrawalCanBeCanceledAndRestoresEscrowedShares() public {
        vault.requestWithdraw(1e18);

        assertEq(vault.balanceOf(address(this)), 9e18);
        assertEq(vault.balanceOf(address(vault)), 1e18);

        vault.cancelWithdrawRequest();

        assertEq(vault.balanceOf(address(this)), 10e18);
        assertEq(vault.balanceOf(address(vault)), 0);
        assertEq(vault.queuedWithdrawalShares(address(this)), 0);
        assertEq(vault.totalQueuedWithdrawalShares(), 0);
    }

    function test_QueuedDepositCanBeCanceledAndCannotBeRescued() public {
        address depositor = address(0xBEEF);
        usdc.mint(depositor, 1_000_000);

        vm.startPrank(depositor);
        usdc.approve(address(vault), 1_000_000);
        vault.requestDeposit(1_000_000);
        vm.stopPrank();

        vm.expectRevert(WavefundVault.NotUnallocatedFunds.selector);
        vault.rescueUnallocatedFunds(VAULT_TEST_USDC, 1, address(this));

        vm.prank(depositor);
        vault.cancelDepositRequest();

        assertEq(usdc.balanceOf(depositor), 1_000_000);
        assertEq(vault.totalQueuedDepositUsdc(), 0);
        assertEq(vault.queuedDepositUsdc(depositor), 0);
    }

    function test_AdminCanRescueOnlyUnaccountedTokenBalance() public {
        vm.expectRevert(WavefundVault.NotUnallocatedFunds.selector);
        vault.rescueUnallocatedFunds(VAULT_TEST_USDC, 1, address(this));

        usdc.mint(address(vault), 1_000_000);
        vault.rescueUnallocatedFunds(VAULT_TEST_USDC, 1_000_000, address(this));

        assertEq(vault.totalVaultUsdc(), 10_000_000);
        assertEq(usdc.balanceOf(address(vault)), 10_000_000);
        assertEq(vault.balanceOf(address(this)), 10e18);
    }

    function test_AdminCanImportAvailableLegacyFundingAsShares() public {
        usdc.mint(address(this), 1_000_000);
        usdc.approve(address(vault), 1_000_000);

        vault.migrateAdminFundedBalance(1_000_000);

        assertEq(vault.balanceOf(address(this)), 11e18);
        assertEq(vault.totalSupply(), 11e18);
        assertEq(vault.totalVaultUsdc(), 11_000_000);
    }

    function test_UnownedProtocolDepositDoesNotReportAnInvalidSharePrice() public {
        WavefundVault emptyVault = new WavefundVault(
            address(0x1234), address(0x5678), address(resolver), address(round), address(oracle), 500, address(this)
        );
        emptyVault.grantRole(emptyVault.QUANTUM_ROUND_ROLE(), address(this));
        usdc.mint(address(this), 1_000_000);
        usdc.approve(address(emptyVault), 1_000_000);

        emptyVault.depositFromRound(1_000_000);

        assertEq(emptyVault.totalSupply(), 0);
        assertEq(emptyVault.navPerShare(), 0);
    }

    function test_QueuedSharesUseOracleNavFromEachDecisionBoundaryAndRemainSolvent() public {
        address firstDepositor = address(0xBEEF);
        usdc.mint(firstDepositor, 2_000_000);
        vm.startPrank(firstDepositor);
        usdc.approve(address(vault), 2_000_000);
        vault.requestDeposit(2_000_000);
        vm.stopPrank();
        vault.executeTrade(1, 0);

        _mockUnlock(12_000_000, 4e15);
        vault.executeTrade(2, 10_000);

        oracle.updatePrice(330_000_000_000);
        address secondDepositor = address(0xCAFE);
        usdc.mint(secondDepositor, 1_000_000);
        vm.startPrank(secondDepositor);
        usdc.approve(address(vault), 1_000_000);
        vault.requestDeposit(1_000_000);
        vm.stopPrank();

        _mockUnlock(1_000_000, 303_030_303_030_303);
        vault.executeTrade(3, 10_000);

        assertEq(vault.balanceOf(secondDepositor), 909_090_909_090_909_090);
        assertGt(vault.navPerShare(), 1_099_999e18);
        assertLt(vault.navPerShare(), 1_100_000e18);
        _assertShareSolvency();

        vm.prank(secondDepositor);
        vault.requestWithdraw(0.5e18);

        _mockUnlock(166_666_363_636_364, 549_999);
        _mockUnlock(4_136_363_636_363_636, 13_649_999);
        vault.executeTrade(4, 0);

        assertEq(usdc.balanceOf(secondDepositor), 549_999);
        assertEq(vault.queuedWithdrawalShares(secondDepositor), 0);
        assertEq(vault.totalAssetsUsdc(), 13_649_999);
        _assertShareSolvency();
    }

    function test_SlippageBreachRollsBackSwapAndCancelsRound() public {
        bytes memory unlockPayload = abi.encode(uint256(10_000_000));
        bytes memory unlockResponse = abi.encode(uint256(10_000_000), uint256(3_000_000_000_000_000));
        vm.mockCall(
            address(0x1234), abi.encodeWithSignature("unlock(bytes)", unlockPayload), abi.encode(unlockResponse)
        );

        vault.executeTrade(1, 10_000);

        (,,,,, bool executed,, bool cancelled) = vault.roundState(1);
        assertFalse(executed);
        assertTrue(cancelled);
        assertTrue(round.cancelled());
        assertEq(vault.totalVaultUsdc(), 10_000_000);
        assertEq(vault.totalVaultTEth(), 0);
    }

    function test_ReportReturnRequiresOracleUpdateAtOrAfterEvaluationEnd() public {
        uint64 evaluationEnd = uint64(block.timestamp + 60);
        round.setEvaluationEnd(evaluationEnd);
        vault.executeTrade(1, 0);

        vm.warp(evaluationEnd - 1);
        oracle.updatePrice(300_000_000_000);
        vm.warp(evaluationEnd + 1);

        vm.expectRevert(WavefundVault.StaleOraclePrice.selector);
        vault.reportReturn(1);

        oracle.updatePrice(300_000_000_000);
        vault.reportReturn(1);

        assertEq(resolver.lastRound(), 1);
        assertEq(resolver.lastReturn(), 1e18);
    }

    function _mockUnlock(uint256 amountIn, uint256 amountOut) internal {
        bytes memory payload = abi.encode(amountIn);
        bytes memory response = abi.encode(amountIn, amountOut);
        vm.mockCall(address(0x1234), abi.encodeWithSignature("unlock(bytes)", payload), abi.encode(response));
    }

    function _assertShareSolvency() internal view {
        uint256 representedAssets = vault.navPerShare() * vault.totalSupply() / 1e36;
        uint256 totalAssets = vault.totalAssetsUsdc();
        assertLe(representedAssets, totalAssets);
        assertLe(totalAssets - representedAssets, 1);
    }
}
