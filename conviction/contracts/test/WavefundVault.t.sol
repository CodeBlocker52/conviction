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
}
