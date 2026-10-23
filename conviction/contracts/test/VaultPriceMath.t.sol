// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { VaultPriceMath } from "../src/VaultPriceMath.sol";

contract VaultPriceMathHarness {
    function fromSqrtPriceX96(uint160 sqrtPriceX96, bool usdcIsCurrency0) external pure returns (uint256) {
        return VaultPriceMath.fromSqrtPriceX96(sqrtPriceX96, usdcIsCurrency0);
    }

    function fromOracle(int256 answer, uint8 decimals) external pure returns (uint256) {
        return VaultPriceMath.fromOracle(answer, decimals);
    }

    function withinSlippage(uint256 expected, uint256 actual, uint16 maxSlippageBps) external pure returns (bool) {
        return VaultPriceMath.withinSlippage(expected, actual, maxSlippageBps);
    }
}

contract VaultPriceMathTest is Test {
    VaultPriceMathHarness private harness;

    uint256 private constant Q192 = 1 << 192;
    uint256 private constant ONE_ETH = 1e18;
    uint256 private constant THREE_THOUSAND_USDC = 3_000e6;

    function setUp() public {
        harness = new VaultPriceMathHarness();
    }

    function test_SqrtPrice_ConvertsThreeThousandUsdBothOrientations() public view {
        uint160 usdcCurrency0Price = uint160(_sqrt((ONE_ETH * Q192) / THREE_THOUSAND_USDC));
        uint160 usdcCurrency1Price = uint160(_sqrt((THREE_THOUSAND_USDC * Q192) / ONE_ETH));

        assertApproxEqAbs(harness.fromSqrtPriceX96(usdcCurrency0Price, true), THREE_THOUSAND_USDC, 2);
        assertApproxEqAbs(harness.fromSqrtPriceX96(usdcCurrency1Price, false), THREE_THOUSAND_USDC, 2);
    }

    function test_Oracle_ConvertsEightDecimalAnswerToUsdcBaseUnits() public view {
        assertEq(harness.fromOracle(300_000_000_000, 8), THREE_THOUSAND_USDC);
    }

    function test_Oracle_RejectsNonPositivePrice() public {
        vm.expectRevert(VaultPriceMath.InvalidOraclePrice.selector);
        harness.fromOracle(0, 8);
        vm.expectRevert(VaultPriceMath.InvalidOraclePrice.selector);
        harness.fromOracle(-1, 8);
    }

    function test_Oracle_RejectsUnsupportedDecimals() public {
        vm.expectRevert(VaultPriceMath.UnsupportedOracleDecimals.selector);
        harness.fromOracle(1, 37);
    }

    function test_Slippage_EnforcesFivePercentBoundary() public view {
        assertTrue(harness.withinSlippage(1_000_000, 950_000, 500));
        assertFalse(harness.withinSlippage(1_000_000, 949_999, 500));
        assertTrue(harness.withinSlippage(1_000_000, 1_010_000, 500));
    }

    function _sqrt(uint256 x) private pure returns (uint256 result) {
        if (x == 0) return 0;
        result = x;
        uint256 z = (x + 1) / 2;
        while (z < result) {
            result = z;
            z = (x / z + z) / 2;
        }
    }
}
