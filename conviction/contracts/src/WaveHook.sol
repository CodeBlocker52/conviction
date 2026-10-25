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
    uint24 public constant REQUIRED_POOL_FEE = 3_000;
    uint256 private constant Q192 = 1 << 192;

    struct PoolState {
        uint256 roundId;
        uint256 proposalId;
        address longToken;
        uint64 tradingStart;
        uint64 tradingEnd;
        uint64 finalWindowSeconds;
        uint64 lastObservationTime;
        uint256 lastProbabilityX18;
        uint256 finalWindowCumulativeX18;
        uint256 lastPriceX18;
        uint256 finalWindowCumulativePriceX18;
        bool registered;
    }

    address public immutable adapter;
    mapping(PoolId poolId => PoolState state) private _poolStates;

    error InvalidConfiguration();
    error InvalidPoolKey();
    error InvalidLiquidityRange();
    error InvalidLiquidityAction();
    error OnlyAdapter();
    error TradingWindowClosed();
    error ProbabilityOutOfBounds();
    error PoolAlreadyRegistered();
    error UnregisteredPool();

    event PoolRegistered(
        PoolId indexed poolId,
        uint256 indexed roundId,
        uint256 indexed proposalId,
        address longToken,
        uint64 tradingStart,
        uint64 tradingEnd,
        uint64 finalWindowSeconds
    );
    event FinalWindowObservation(
        PoolId indexed poolId, uint64 timestamp, uint256 probabilityX18, uint256 cumulativeProbabilitySecondsX18
    );

    constructor(IPoolManager manager_, address adapter_) BaseHook(manager_) {
        if (address(manager_) == address(0) || adapter_ == address(0)) revert InvalidConfiguration();
        adapter = adapter_;
    }

    modifier onlyAdapter() {
        if (msg.sender != adapter) revert OnlyAdapter();
        _;
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

    function registerPool(
        PoolKey calldata key,
        uint256 roundId,
        uint256 proposalId,
        address longToken,
        uint64 tradingStart,
        uint64 tradingEnd,
        uint64 finalWindowSeconds,
        uint256 initialProbabilityX18
    ) external onlyAdapter {
        if (
            address(key.hooks) != address(this) || key.fee != REQUIRED_POOL_FEE
                || key.tickSpacing != REQUIRED_TICK_SPACING || longToken == address(0)
                || (Currency.unwrap(key.currency0) != longToken && Currency.unwrap(key.currency1) != longToken)
                || tradingEnd <= tradingStart || tradingStart > block.timestamp || finalWindowSeconds == 0
                || finalWindowSeconds > tradingEnd - tradingStart || initialProbabilityX18 < MIN_PROBABILITY
                || initialProbabilityX18 > MAX_PROBABILITY
        ) revert InvalidConfiguration();

        PoolId poolId = key.toId();
        PoolState storage state = _poolStates[poolId];
        if (state.registered) revert PoolAlreadyRegistered();

        state.roundId = roundId;
        state.proposalId = proposalId;
        state.longToken = longToken;
        state.tradingStart = tradingStart;
        state.tradingEnd = tradingEnd;
        state.finalWindowSeconds = finalWindowSeconds;
        state.lastObservationTime = tradingStart;
        state.lastProbabilityX18 = initialProbabilityX18;
        state.lastPriceX18 = _probabilityToPrice(initialProbabilityX18);
        state.registered = true;

        emit PoolRegistered(poolId, roundId, proposalId, longToken, tradingStart, tradingEnd, finalWindowSeconds);
    }

    function poolDetails(PoolId poolId)
        external
        view
        returns (
            uint256 roundId,
            uint256 proposalId,
            address longToken,
            uint64 tradingStart,
            uint64 tradingEnd,
            uint64 finalWindowSeconds,
            bool registered
        )
    {
        PoolState storage state = _poolStates[poolId];
        return (
            state.roundId,
            state.proposalId,
            state.longToken,
            state.tradingStart,
            state.tradingEnd,
            state.finalWindowSeconds,
            state.registered
        );
    }

    function pLong(PoolKey calldata key) external view returns (uint256) {
        return _requireProbabilityInBounds(key);
    }

    function pShort(PoolKey calldata key) external view returns (uint256) {
        return 1e18 - _requireProbabilityInBounds(key);
    }

    function finalWindowTwap(PoolKey calldata key) external view returns (uint256) {
        PoolState storage state = _poolState(key);
        uint64 windowStart = state.tradingEnd - state.finalWindowSeconds;
        uint64 from = state.lastObservationTime > windowStart ? state.lastObservationTime : windowStart;
        uint256 cumulative = state.finalWindowCumulativeX18;
        if (state.tradingEnd > from) {
            cumulative += state.lastProbabilityX18 * (state.tradingEnd - from);
        }
        return cumulative / state.finalWindowSeconds;
    }

    function finalWindowPriceTwap(PoolKey calldata key) external view returns (uint256) {
        PoolState storage state = _poolState(key);
        uint64 windowStart = state.tradingEnd - state.finalWindowSeconds;
        uint64 from = state.lastObservationTime > windowStart ? state.lastObservationTime : windowStart;
        uint256 cumulative = state.finalWindowCumulativePriceX18;
        if (state.tradingEnd > from) {
            cumulative += state.lastPriceX18 * (state.tradingEnd - from);
        }
        return cumulative / state.finalWindowSeconds;
    }

    function _beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata
    ) internal view override returns (bytes4) {
        PoolState storage state = _poolState(key);
        _requireAdapterAndTrading(sender, state);
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
        PoolState storage state = _poolState(key);
        if (sender != adapter) revert OnlyAdapter();
        if (block.timestamp < state.tradingEnd) revert TradingWindowClosed();
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
        PoolState storage state = _poolState(key);
        _requireAdapterAndTrading(sender, state);
        _requireProbabilityInBounds(key);
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        PoolState storage state = _poolState(key);
        _requireAdapterAndTrading(sender, state);
        uint256 probability = _requireProbabilityInBounds(key);
        uint64 timestamp = uint64(block.timestamp);
        uint64 windowStart = state.tradingEnd - state.finalWindowSeconds;
        uint64 from = state.lastObservationTime > windowStart ? state.lastObservationTime : windowStart;
        if (timestamp > state.tradingEnd) timestamp = state.tradingEnd;
        if (timestamp > from) {
            state.finalWindowCumulativeX18 += state.lastProbabilityX18 * (timestamp - from);
            state.finalWindowCumulativePriceX18 += state.lastPriceX18 * (timestamp - from);
        }
        state.lastObservationTime = timestamp;
        state.lastProbabilityX18 = probability;
        state.lastPriceX18 = _probabilityToPrice(probability);
        emit FinalWindowObservation(key.toId(), timestamp, probability, state.finalWindowCumulativeX18);
        return (BaseHook.afterSwap.selector, 0);
    }

    function _requireAdapterAndTrading(address sender, PoolState storage state) private view {
        if (sender != adapter) revert OnlyAdapter();
        if (block.timestamp < state.tradingStart || block.timestamp >= state.tradingEnd) revert TradingWindowClosed();
    }

    function _poolState(PoolKey calldata key) private view returns (PoolState storage state) {
        if (
            address(key.hooks) != address(this) || key.fee != REQUIRED_POOL_FEE
                || key.tickSpacing != REQUIRED_TICK_SPACING
        ) revert InvalidPoolKey();
        state = _poolStates[key.toId()];
        if (!state.registered) revert UnregisteredPool();
        if (Currency.unwrap(key.currency0) != state.longToken && Currency.unwrap(key.currency1) != state.longToken) {
            revert InvalidPoolKey();
        }
    }

    function _requireProbabilityInBounds(PoolKey calldata key) private view returns (uint256 probability) {
        probability = _probabilityX18(key);
        if (probability < MIN_PROBABILITY || probability > MAX_PROBABILITY) revert ProbabilityOutOfBounds();
    }

    function _probabilityX18(PoolKey calldata key) private view returns (uint256) {
        PoolState storage state = _poolState(key);
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(key.toId());
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(MIN_POSITION_TICK);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(MAX_POSITION_TICK);
        if (sqrtPriceX96 < sqrtLower || sqrtPriceX96 > sqrtUpper) revert ProbabilityOutOfBounds();

        uint256 priceX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
        uint256 denominator = priceX192 + Q192;
        if (Currency.unwrap(key.currency0) == state.longToken) {
            return FullMath.mulDiv(priceX192, 1e18, denominator);
        }
        return FullMath.mulDiv(Q192, 1e18, denominator);
    }

    function _probabilityToPrice(uint256 probability) private pure returns (uint256) {
        return FullMath.mulDiv(probability, 1e18, 1e18 - probability);
    }
}
