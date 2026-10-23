// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @notice Decimal-aware ETH/USD conversion helpers used by WavefundVault.
library VaultPriceMath {
    uint256 internal constant USDC_UNIT = 1e6;
    uint256 internal constant TETH_UNIT = 1e18;
    uint256 private constant Q64 = 1 << 64;
    uint256 private constant Q128 = 1 << 128;

    error InvalidPoolPrice();
    error InvalidOraclePrice();
    error UnsupportedOracleDecimals();
    error InvalidSlippageCap();

    /// @notice Converts a v4 Q64.96 sqrt price to USDC base units per 1e18 tETH.
    /// @dev The raw pool ratio is token1 base units / token0 base units. USDC has 6 decimals;
    ///      tETH has 18 decimals, so the inverse/orientation is applied in raw token units.
    function fromSqrtPriceX96(uint160 sqrtPriceX96, bool usdcIsCurrency0) internal pure returns (uint256) {
        if (sqrtPriceX96 == 0) revert InvalidPoolPrice();

        uint256 ratioX128 = FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), Q64);
        if (ratioX128 == 0) revert InvalidPoolPrice();

        uint256 priceUsdc;
        if (usdcIsCurrency0) {
            priceUsdc = FullMath.mulDiv(TETH_UNIT, Q128, ratioX128);
        } else {
            priceUsdc = FullMath.mulDiv(ratioX128, TETH_UNIT, Q128);
        }

        if (priceUsdc == 0) revert InvalidPoolPrice();
        return priceUsdc;
    }

    /// @notice Converts a positive USD price into 6-decimal USDC units per 1e18 tETH.
    function fromOracle(int256 answer, uint8 answerDecimals) internal pure returns (uint256) {
        if (answer <= 0) revert InvalidOraclePrice();
        if (answerDecimals > 36) revert UnsupportedOracleDecimals();

        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 priceUsdc = FullMath.mulDiv(uint256(answer), USDC_UNIT, 10 ** uint256(answerDecimals));
        if (priceUsdc == 0) revert InvalidOraclePrice();
        return priceUsdc;
    }

    /// @notice Returns false when realized output falls below the configured slippage floor.
    function withinSlippage(uint256 expectedOut, uint256 actualOut, uint16 maxSlippageBps)
        internal
        pure
        returns (bool)
    {
        if (maxSlippageBps > 10_000) revert InvalidSlippageCap();
        if (expectedOut == 0) return actualOut == 0;

        uint256 minimumOut = FullMath.mulDiv(expectedOut, 10_000 - maxSlippageBps, 10_000);
        return actualOut >= minimumOut;
    }
}
