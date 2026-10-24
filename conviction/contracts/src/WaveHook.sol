// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { BeforeSwapDelta, BeforeSwapDeltaLibrary } from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { BaseHook } from "@uniswap/v4-periphery/src/utils/BaseHook.sol";

contract WaveHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 public constant MIN_PROBABILITY = 1e16;
    uint256 public constant MAX_PROBABILITY = 99e16;
    int24 public constant MIN_POSITION_TICK = -45_900;
    int24 public constant MAX_POSITION_TICK = 45_900;
    int24 public constant REQUIRED_TICK_SPACING = 60;
    uint256 private constant Q192 = 1 << 192;

    address public immutable adapter;
    address public immutable longToken;
    uint64 public immutable tradingStart;
    uint64 public immutable tradingEnd;
    uint64 public immutable finalWindowSeconds;

    uint64 public lastObservationTime;
    uint256 public lastProbabilityX18;
    uint256 public finalWindowCumulativeX18;

    error InvalidConfiguration();
    error InvalidPoolKey();
    error InvalidLiquidityRange();
    error InvalidLiquidityAction();
    error OnlyAdapter();
    error TradingWindowClosed();
    error ProbabilityOutOfBounds();

    event FinalWindowObservation(
        PoolId indexed poolId, uint64 timestamp, uint256 probabilityX18, uint256 cumulativeProbabilitySecondsX18
    );

    constructor(
        IPoolManager manager_,
        address adapter_,
        address longToken_,
        uint64 tradingStart_,
        uint64 tradingEnd_,
        uint64 finalWindowSeconds_,
        uint256 initialProbabilityX18_
    ) BaseHook(manager_) {
        if (
            adapter_ == address(0) || longToken_ == address(0) || tradingEnd_ <= tradingStart_
                || finalWindowSeconds_ == 0 || finalWindowSeconds_ > tradingEnd_ - tradingStart_
                || initialProbabilityX18_ < MIN_PROBABILITY || initialProbabilityX18_ > MAX_PROBABILITY
        ) revert InvalidConfiguration();

        adapter = adapter_;
        longToken = longToken_;
        tradingStart = tradingStart_;
        tradingEnd = tradingEnd_;
        finalWindowSeconds = finalWindowSeconds_;
        lastObservationTime = tradingStart_;
        lastProbabilityX18 = initialProbabilityX18_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: true,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function pLong(PoolKey calldata key) external view returns (uint256) {
        _validatePoolKey(key);
        return _probabilityX18(key);
    }

    function pShort(PoolKey calldata key) external view returns (uint256) {
        _validatePoolKey(key);
        return 1e18 - _probabilityX18(key);
    }

    function finalWindowTwap() external view returns (uint256) {
        uint64 windowStart = tradingEnd - finalWindowSeconds;
        uint64 from = lastObservationTime > windowStart ? lastObservationTime : windowStart;
        uint256 cumulative = finalWindowCumulativeX18;
        if (tradingEnd > from) {
            cumulative += lastProbabilityX18 * (tradingEnd - from);
        }
        return cumulative / finalWindowSeconds;
    }

    function _beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata
    ) internal view override returns (bytes4) {
        _requireAdapterAndTrading(sender);
        _validatePoolKey(key);
        if (params.liquidityDelta <= 0) revert InvalidLiquidityAction();
        if (
            params.tickLower < MIN_POSITION_TICK || params.tickUpper > MAX_POSITION_TICK
                || params.tickLower >= params.tickUpper
        ) revert InvalidLiquidityRange();
        _requireProbabilityInBounds(key);
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata
    ) internal view override returns (bytes4) {
        _requireAdapterAndTrading(sender);
        _validatePoolKey(key);
        if (params.liquidityDelta >= 0) revert InvalidLiquidityAction();
        if (
            params.tickLower < MIN_POSITION_TICK || params.tickUpper > MAX_POSITION_TICK
                || params.tickLower >= params.tickUpper
        ) revert InvalidLiquidityRange();
        return BaseHook.beforeRemoveLiquidity.selector;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _requireAdapterAndTrading(sender);
        _validatePoolKey(key);
        _requireProbabilityInBounds(key);
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        _requireAdapterAndTrading(sender);
        _validatePoolKey(key);
        uint256 probability = _requireProbabilityInBounds(key);
        uint64 timestamp = uint64(block.timestamp);
        uint64 windowStart = tradingEnd - finalWindowSeconds;
        uint64 from = lastObservationTime > windowStart ? lastObservationTime : windowStart;
        if (timestamp > tradingEnd) timestamp = tradingEnd;
        if (timestamp > from) {
            finalWindowCumulativeX18 += lastProbabilityX18 * (timestamp - from);
        }
        lastObservationTime = timestamp;
        lastProbabilityX18 = probability;
        emit FinalWindowObservation(key.toId(), timestamp, probability, finalWindowCumulativeX18);
        return (BaseHook.afterSwap.selector, 0);
    }

    function _requireAdapterAndTrading(address sender) private view {
        if (sender != adapter) revert OnlyAdapter();
        if (block.timestamp < tradingStart || block.timestamp >= tradingEnd) revert TradingWindowClosed();
    }

    function _validatePoolKey(PoolKey calldata key) private view {
        if (
            address(key.hooks) != address(this) || key.tickSpacing != REQUIRED_TICK_SPACING
                || (Currency.unwrap(key.currency0) != longToken && Currency.unwrap(key.currency1) != longToken)
        ) revert InvalidPoolKey();
    }

    function _requireProbabilityInBounds(PoolKey calldata key) private view returns (uint256 probability) {
        probability = _probabilityX18(key);
        if (probability < MIN_PROBABILITY || probability > MAX_PROBABILITY) revert ProbabilityOutOfBounds();
    }

    function _probabilityX18(PoolKey calldata key) private view returns (uint256) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(key.toId());
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(MIN_POSITION_TICK);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(MAX_POSITION_TICK);
        if (sqrtPriceX96 < sqrtLower || sqrtPriceX96 > sqrtUpper) revert ProbabilityOutOfBounds();

        uint256 priceX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
        uint256 denominator = priceX192 + Q192;
        if (Currency.unwrap(key.currency0) == longToken) {
            return FullMath.mulDiv(priceX192, 1e18, denominator);
        }
        return FullMath.mulDiv(Q192, 1e18, denominator);
    }
}
