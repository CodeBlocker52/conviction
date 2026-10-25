// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { SwapMath } from "@uniswap/v4-core/src/libraries/SwapMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { ProtocolFeeLibrary } from "@uniswap/v4-core/src/libraries/ProtocolFeeLibrary.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IProposalMarket } from "./IProposalMarket.sol";
import { ProposalTokens } from "./ProposalTokens.sol";
import { WaveHook } from "./WaveHook.sol";

interface IQuantumRoundTiming {
    function marketTiming(uint256 roundId) external view returns (uint64 tradingEnd, uint32 twapWindow);
}

/// @title WaveV4ProposalMarket
/// @notice Protocol-owned Uniswap v4 LONG/SHORT pools for Phase B proposal markets.
contract WaveV4ProposalMarket is IProposalMarket, IUnlockCallback {
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using ProtocolFeeLibrary for uint24;
    using ProtocolFeeLibrary for uint16;
    using PoolIdLibrary for PoolKey;

    uint256 public constant COMPLETE_SET_SCALE = 1e12;
    uint160 private constant INITIAL_SQRT_PRICE_X96 = 1 << 96;
    int24 private constant LOWER_TICK = -45_900;
    int24 private constant UPPER_TICK = 45_900;
    int24 private constant TICK_SPACING = 60;
    uint24 private constant POOL_FEE = 3_000;
    /// @dev Initialised ticks of the single position, in compressed (tick / spacing) units.
    int256 private constant LOWER_COMPRESSED = -765;
    int256 private constant UPPER_COMPRESSED = 765;
    /// @dev Sell solver stops once the bracket is this many raw token units wide (1e-12 of a token).
    uint256 private constant SELL_SOLVER_TOLERANCE = 1e6;

    enum Action {
        ADD_LIQUIDITY,
        REMOVE_LIQUIDITY,
        SWAP
    }

    struct Market {
        PoolKey key;
        uint128 liquidity;
        uint64 tradingEnd;
        uint256 pendingLongRemainder;
        uint256 pendingShortRemainder;
        bool seeded;
        bool finalized;
    }

    struct SwapSim {
        uint160 sqrtPriceX96;
        int24 tick;
        uint128 liquidity;
        uint24 swapFee;
    }

    struct Operation {
        Action action;
        uint256 roundId;
        uint256 proposalId;
        int256 liquidityDelta;
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    IPoolManager public immutable poolManager;
    ProposalTokens public immutable proposalTokens;
    address public owner;
    WaveHook public waveHook;
    IQuantumRoundTiming public quantumRound;

    mapping(uint256 roundId => mapping(uint256 proposalId => Market)) private _markets;

    error OnlyOwner();
    error OnlyPoolManager();
    error OnlyQuantumRound();
    error InvalidConfiguration();
    error InvalidProposalMarket();
    error HookNotConfigured();
    error AlreadySeeded();
    error NotSeeded();
    error AlreadyFinalized();
    error InvalidOutput();
    error PendingRemainder();
    error TradingNotClosed();

    event MarketInitialized(
        uint256 indexed roundId, uint256 indexed proposalId, address hook, bytes32 poolId, uint128 liquidity
    );
    event MarketFinalized(
        uint256 indexed roundId, uint256 indexed proposalId, uint256 longReturned, uint256 shortReturned
    );
    event QuantumRoundSet(address indexed round);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(IPoolManager poolManager_, ProposalTokens proposalTokens_, address initialOwner) {
        if (address(poolManager_) == address(0) || address(proposalTokens_) == address(0) || initialOwner == address(0))
        {
            revert InvalidConfiguration();
        }
        poolManager = poolManager_;
        proposalTokens = proposalTokens_;
        owner = initialOwner;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyRound() {
        if (msg.sender != address(quantumRound)) revert OnlyQuantumRound();
        _;
    }

    function setQuantumRound(IQuantumRoundTiming round_) external onlyOwner {
        if (address(quantumRound) != address(0) || address(round_) == address(0)) revert InvalidConfiguration();
        quantumRound = round_;
        emit QuantumRoundSet(address(round_));
    }

    function setWaveHook(WaveHook hook_) external onlyOwner {
        if (
            address(waveHook) != address(0) || address(hook_) == address(0) || hook_.adapter() != address(this)
                || address(hook_.poolManager()) != address(poolManager)
        ) revert InvalidConfiguration();
        waveHook = hook_;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidConfiguration();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function tradeBuyLong(uint256 roundId, uint256 proposalId, uint256 creditsIn, uint256 minLongOut)
        external
        onlyRound
        returns (uint256 longOut)
    {
        Market storage market_ = _getMarket(roundId, proposalId);
        uint256 shortBefore = IERC20(proposalTokens.shortToken(roundId, proposalId)).balanceOf(address(this));
        if (shortBefore < creditsIn * COMPLETE_SET_SCALE) revert InvalidOutput();

        BalanceDelta delta = _swap(
            roundId,
            proposalId,
            _isCurrency0(market_.key, proposalTokens.shortToken(roundId, proposalId)),
            -int256(creditsIn * COMPLETE_SET_SCALE)
        );
        int128 longDelta = _currencyDelta(market_.key, proposalTokens.longToken(roundId, proposalId), delta);
        if (longDelta <= 0) revert InvalidOutput();
        // The user receives the minted LONG leg of the complete set plus the LONG bought with the SHORT leg.
        longOut = uint256(uint128(longDelta)) + creditsIn * COMPLETE_SET_SCALE;
        if (longOut < minLongOut || longOut == 0) revert InvalidOutput();
        IERC20(proposalTokens.longToken(roundId, proposalId)).safeTransfer(msg.sender, longOut);
    }

    function tradeBuyShort(uint256 roundId, uint256 proposalId, uint256 creditsIn, uint256 minSetsOut)
        external
        onlyRound
        returns (uint256 setsOut)
    {
        Market storage market_ = _getMarket(roundId, proposalId);
        uint256 longBalance = IERC20(proposalTokens.longToken(roundId, proposalId)).balanceOf(address(this));
        if (longBalance < creditsIn * COMPLETE_SET_SCALE) revert InvalidOutput();

        BalanceDelta delta = _swap(
            roundId,
            proposalId,
            _isCurrency0(market_.key, proposalTokens.longToken(roundId, proposalId)),
            -int256(creditsIn * COMPLETE_SET_SCALE)
        );
        int128 shortDelta = _currencyDelta(market_.key, proposalTokens.shortToken(roundId, proposalId), delta);
        if (shortDelta <= 0) revert InvalidOutput();
        setsOut = uint256(uint128(shortDelta)) + creditsIn * COMPLETE_SET_SCALE;
        if (setsOut < minSetsOut || setsOut == 0) revert InvalidOutput();
        IERC20(proposalTokens.shortToken(roundId, proposalId)).safeTransfer(msg.sender, setsOut);
    }

    function tradeSellLong(uint256 roundId, uint256 proposalId, uint256 longIn, uint256 minCreditsOut)
        external
        onlyRound
        returns (uint256 creditsOut)
    {
        creditsOut = _tradeSell(roundId, proposalId, longIn, minCreditsOut, true);
    }

    function tradeSellShort(uint256 roundId, uint256 proposalId, uint256 setsIn, uint256 minCreditsOut)
        external
        onlyRound
        returns (uint256 creditsOut)
    {
        creditsOut = _tradeSell(roundId, proposalId, setsIn, minCreditsOut, false);
    }

    /// @notice Exact LONG received for `creditsIn` credits, including the complete-set LONG leg.
    function quoteBuyLong(uint256 roundId, uint256 proposalId, uint256 creditsIn)
        external
        view
        returns (uint256 longOut)
    {
        return _quoteBuy(roundId, proposalId, creditsIn, true);
    }

    /// @notice Exact SHORT received for `creditsIn` credits, including the complete-set SHORT leg.
    function quoteBuyShort(uint256 roundId, uint256 proposalId, uint256 creditsIn)
        external
        view
        returns (uint256 shortOut)
    {
        return _quoteBuy(roundId, proposalId, creditsIn, false);
    }

    /// @notice Exact credits (and returned dust) for selling `longIn` LONG.
    function quoteSellLong(uint256 roundId, uint256 proposalId, uint256 longIn)
        external
        view
        returns (uint256 creditsOut, uint256 longDust, uint256 shortDust)
    {
        (creditsOut, longDust, shortDust,,) = _quoteSell(roundId, proposalId, longIn, true);
    }

    /// @notice Exact credits (and returned dust) for selling `shortIn` SHORT.
    function quoteSellShort(uint256 roundId, uint256 proposalId, uint256 shortIn)
        external
        view
        returns (uint256 creditsOut, uint256 longDust, uint256 shortDust)
    {
        (creditsOut, longDust, shortDust,,) = _quoteSell(roundId, proposalId, shortIn, false);
    }

    function _tradeSell(uint256 roundId, uint256 proposalId, uint256 amountIn, uint256 minCreditsOut, bool soldLong)
        private
        returns (uint256 creditsOut)
    {
        Market storage market_ = _getMarket(roundId, proposalId);
        if (market_.pendingLongRemainder != 0 || market_.pendingShortRemainder != 0) revert PendingRemainder();

        (,,, uint256 swapIn,) = _quoteSell(roundId, proposalId, amountIn, soldLong);
        address inToken =
            soldLong ? proposalTokens.longToken(roundId, proposalId) : proposalTokens.shortToken(roundId, proposalId);
        address outToken =
            soldLong ? proposalTokens.shortToken(roundId, proposalId) : proposalTokens.longToken(roundId, proposalId);

        BalanceDelta delta = _swap(roundId, proposalId, _isCurrency0(market_.key, inToken), -int256(swapIn));
        int128 inDelta = _currencyDelta(market_.key, inToken, delta);
        int128 outDelta = _currencyDelta(market_.key, outToken, delta);
        if (inDelta >= 0 || outDelta <= 0) revert InvalidOutput();

        uint256 remainingIn = amountIn - uint256(-int256(inDelta));
        uint256 received = uint256(uint128(outDelta));
        uint256 matched = remainingIn < received ? remainingIn : received;
        creditsOut = matched / COMPLETE_SET_SCALE;
        if (creditsOut < minCreditsOut || creditsOut == 0) revert InvalidOutput();

        // The market now holds `remainingIn` of the sold side and `received` of the other side. The round burns
        // matched complete sets for credits and returns only the unmatched dust to the seller.
        (market_.pendingLongRemainder, market_.pendingShortRemainder) =
            soldLong ? (remainingIn, received) : (received, remainingIn);
    }

    function _quoteBuy(uint256 roundId, uint256 proposalId, uint256 creditsIn, bool buyLong)
        private
        view
        returns (uint256 out)
    {
        Market storage market_ = _getMarket(roundId, proposalId);
        // Buying LONG swaps the SHORT leg in, so SHORT is the input currency.
        bool zeroForOne = _isCurrency0(
            market_.key,
            buyLong ? proposalTokens.shortToken(roundId, proposalId) : proposalTokens.longToken(roundId, proposalId)
        );
        SwapSim memory sim = _loadSim(market_.key, zeroForOne);
        uint256 amountIn = creditsIn * COMPLETE_SET_SCALE;
        (uint256 consumed, uint256 swapOut) = _simulate(sim, zeroForOne, amountIn);
        if (consumed != amountIn || swapOut == 0) revert InvalidOutput();
        out = swapOut + amountIn;
    }

    function _quoteSell(uint256 roundId, uint256 proposalId, uint256 amountIn, bool soldLong)
        private
        view
        returns (uint256 creditsOut, uint256 longDust, uint256 shortDust, uint256 swapIn, uint256 received)
    {
        Market storage market_ = _getMarket(roundId, proposalId);
        bool zeroForOne = _isCurrency0(
            market_.key,
            soldLong ? proposalTokens.longToken(roundId, proposalId) : proposalTokens.shortToken(roundId, proposalId)
        );
        SwapSim memory sim = _loadSim(market_.key, zeroForOne);

        // Find the smallest swap whose output covers the input left over, so leftover input pairs with output.
        uint256 lo;
        uint256 hi = amountIn;
        while (hi - lo > SELL_SOLVER_TOLERANCE) {
            uint256 mid = (lo + hi) / 2;
            (uint256 consumedMid, uint256 outMid) = _simulate(sim, zeroForOne, mid);
            if (outMid >= amountIn - consumedMid) hi = mid;
            else lo = mid;
        }
        swapIn = hi;
        uint256 consumed;
        (consumed, received) = _simulate(sim, zeroForOne, swapIn);
        uint256 remainingIn = amountIn - consumed;
        if (received == 0 || received < remainingIn) revert InvalidOutput();

        uint256 matched = remainingIn;
        creditsOut = matched / COMPLETE_SET_SCALE;
        uint256 leftoverIn = remainingIn - creditsOut * COMPLETE_SET_SCALE;
        uint256 leftoverOut = received - creditsOut * COMPLETE_SET_SCALE;
        (longDust, shortDust) = soldLong ? (leftoverIn, leftoverOut) : (leftoverOut, leftoverIn);
    }

    function _loadSim(PoolKey storage key, bool zeroForOne) private view returns (SwapSim memory sim) {
        PoolId id = key.toId();
        (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) = poolManager.getSlot0(id);
        uint16 directional = zeroForOne ? protocolFee.getZeroForOneFee() : protocolFee.getOneForZeroFee();
        sim = SwapSim({
            sqrtPriceX96: sqrtPriceX96,
            tick: tick,
            liquidity: poolManager.getLiquidity(id),
            swapFee: directional == 0 ? lpFee : directional.calculateSwapFee(lpFee)
        });
    }

    /// @dev Mirrors Pool.swap for an exact-input swap through the single position's tick bitmap.
    function _simulate(SwapSim memory sim, bool zeroForOne, uint256 amountIn)
        private
        pure
        returns (uint256 consumed, uint256 amountOut)
    {
        if (amountIn == 0) return (0, 0);
        int256 remaining = -int256(amountIn);
        uint160 sqrtPrice = sim.sqrtPriceX96;
        int24 tick = sim.tick;
        uint128 liquidity = sim.liquidity;
        uint160 limit =
            zeroForOne ? TickMath.getSqrtPriceAtTick(LOWER_TICK) + 1 : TickMath.getSqrtPriceAtTick(UPPER_TICK) - 1;
        if (zeroForOne ? limit >= sqrtPrice : limit <= sqrtPrice) revert InvalidOutput();

        while (remaining != 0 && sqrtPrice != limit) {
            uint160 start = sqrtPrice;
            (int24 tickNext, bool initialized) = _nextTick(tick, zeroForOne);
            if (tickNext <= TickMath.MIN_TICK) tickNext = TickMath.MIN_TICK;
            if (tickNext >= TickMath.MAX_TICK) tickNext = TickMath.MAX_TICK;
            uint160 sqrtNext = TickMath.getSqrtPriceAtTick(tickNext);

            uint256 stepIn;
            uint256 stepOut;
            uint256 stepFee;
            (sqrtPrice, stepIn, stepOut, stepFee) = SwapMath.computeSwapStep(
                sqrtPrice, SwapMath.getSqrtPriceTarget(zeroForOne, sqrtNext, limit), liquidity, remaining, sim.swapFee
            );
            remaining += int256(stepIn + stepFee);
            amountOut += stepOut;

            if (sqrtPrice == sqrtNext) {
                // Both initialised ticks are the edges of the only position, so crossing leaves zero liquidity.
                if (initialized) liquidity = 0;
                tick = zeroForOne ? tickNext - 1 : tickNext;
            } else if (sqrtPrice != start) {
                tick = TickMath.getTickAtSqrtPrice(sqrtPrice);
            }
        }
        consumed = amountIn - uint256(-remaining);
    }

    /// @dev TickBitmap.nextInitializedTickWithinOneWord for a bitmap holding only the two position edges.
    function _nextTick(int24 tick, bool lte) private pure returns (int24 next, bool initialized) {
        int256 compressed = int256(tick) / int256(TICK_SPACING);
        if (tick < 0 && int256(tick) % int256(TICK_SPACING) != 0) compressed--;
        if (lte) {
            int256 word = compressed >> 8;
            int256 bitPos = compressed - (word << 8);
            int256 hit = type(int256).min;
            if (LOWER_COMPRESSED <= compressed && (LOWER_COMPRESSED >> 8) == word) hit = LOWER_COMPRESSED;
            if (UPPER_COMPRESSED <= compressed && (UPPER_COMPRESSED >> 8) == word && UPPER_COMPRESSED > hit) {
                hit = UPPER_COMPRESSED;
            }
            initialized = hit != type(int256).min;
            next = int24((initialized ? hit : compressed - bitPos) * int256(TICK_SPACING));
        } else {
            int256 from = compressed + 1;
            int256 word = from >> 8;
            int256 bitPos = from - (word << 8);
            int256 hit = type(int256).max;
            if (LOWER_COMPRESSED >= from && (LOWER_COMPRESSED >> 8) == word) hit = LOWER_COMPRESSED;
            if (UPPER_COMPRESSED >= from && (UPPER_COMPRESSED >> 8) == word && UPPER_COMPRESSED < hit) {
                hit = UPPER_COMPRESSED;
            }
            initialized = hit != type(int256).max;
            next = int24((initialized ? hit : from + (255 - bitPos)) * int256(TICK_SPACING));
        }
    }

    function spotPrice(uint256 roundId, uint256 proposalId) external view returns (uint256) {
        Market storage market_ = _getMarket(roundId, proposalId);
        uint256 probability = waveHook.pLong(market_.key);
        return (probability * 1e18) / (1e18 - probability);
    }

    function probabilities(uint256 roundId, uint256 proposalId)
        external
        view
        returns (uint256 longProbability, uint256 shortProbability)
    {
        Market storage market_ = _getMarket(roundId, proposalId);
        longProbability = waveHook.pLong(market_.key);
        shortProbability = waveHook.pShort(market_.key);
    }

    function twap(uint256 roundId, uint256 proposalId, uint256, uint256) external view returns (uint256 priceTwap) {
        return waveHook.finalWindowPriceTwap(_getMarket(roundId, proposalId).key);
    }

    function probabilityTwap(uint256 roundId, uint256 proposalId, uint256, uint256)
        external
        view
        returns (uint256 probability)
    {
        return waveHook.finalWindowTwap(_getMarket(roundId, proposalId).key);
    }

    function seedLiquidity(uint256 roundId, uint256 proposalId, uint256 creditAmount, uint256) external onlyRound {
        Market storage market_ = _markets[roundId][proposalId];
        if (market_.seeded) revert AlreadySeeded();
        WaveHook hook_ = waveHook;
        if (address(hook_) == address(0)) revert HookNotConfigured();

        address longTokenAddr = proposalTokens.longToken(roundId, proposalId);
        address shortTokenAddr = proposalTokens.shortToken(roundId, proposalId);
        if (longTokenAddr == address(0) || shortTokenAddr == address(0) || longTokenAddr == shortTokenAddr) {
            revert InvalidProposalMarket();
        }

        (uint64 tradingEnd, uint32 twapWindow) = quantumRound.marketTiming(roundId);
        uint64 now64 = uint64(block.timestamp);
        uint64 finalWindow = uint64(twapWindow);
        if (finalWindow > tradingEnd - now64) revert InvalidConfiguration();

        Currency longCurrency = Currency.wrap(longTokenAddr);
        Currency shortCurrency = Currency.wrap(shortTokenAddr);
        bool longIsCurrency0 = Currency.unwrap(longCurrency) < Currency.unwrap(shortCurrency);
        PoolKey memory key = PoolKey({
            currency0: longIsCurrency0 ? longCurrency : shortCurrency,
            currency1: longIsCurrency0 ? shortCurrency : longCurrency,
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook_))
        });

        market_.key = key;
        market_.tradingEnd = tradingEnd;
        market_.seeded = true;
        hook_.registerPool(key, roundId, proposalId, longTokenAddr, now64, tradingEnd, finalWindow, uint256(0.5e18));
        poolManager.initialize(key, INITIAL_SQRT_PRICE_X96);

        uint256 liquidityAmount = creditAmount * COMPLETE_SET_SCALE;
        if (liquidityAmount == 0 || liquidityAmount > type(uint128).max) revert InvalidConfiguration();
        market_.liquidity = uint128(liquidityAmount);
        _modifyLiquidity(roundId, proposalId, int256(liquidityAmount));

        emit MarketInitialized(
            roundId, proposalId, address(hook_), keccak256(abi.encode(key)), uint128(liquidityAmount)
        );
    }

    function closeTwapWindow(uint256, uint256, uint256) external view onlyRound { }

    function completeSetScale() external pure returns (uint256) {
        return COMPLETE_SET_SCALE;
    }

    function poolKey(uint256 roundId, uint256 proposalId) external view returns (PoolKey memory) {
        return _getMarket(roundId, proposalId).key;
    }

    function consumeSellSettlement(uint256 roundId, uint256 proposalId)
        external
        onlyRound
        returns (uint256 longRemainder, uint256 shortRemainder)
    {
        Market storage market_ = _getMarket(roundId, proposalId);
        longRemainder = market_.pendingLongRemainder;
        shortRemainder = market_.pendingShortRemainder;
        market_.pendingLongRemainder = 0;
        market_.pendingShortRemainder = 0;

        IERC20(proposalTokens.longToken(roundId, proposalId)).safeTransfer(msg.sender, longRemainder);
        IERC20(proposalTokens.shortToken(roundId, proposalId)).safeTransfer(msg.sender, shortRemainder);
    }

    function finalizeProposal(uint256 roundId, uint256 proposalId)
        external
        onlyRound
        returns (uint256 longReturned, uint256 shortReturned)
    {
        Market storage market_ = _getMarket(roundId, proposalId);
        if (block.timestamp < market_.tradingEnd) revert TradingNotClosed();
        if (market_.finalized) revert AlreadyFinalized();
        if (market_.pendingLongRemainder != 0 || market_.pendingShortRemainder != 0) revert PendingRemainder();

        _modifyLiquidity(roundId, proposalId, -int256(uint256(market_.liquidity)));

        address longTokenAddr = proposalTokens.longToken(roundId, proposalId);
        address shortTokenAddr = proposalTokens.shortToken(roundId, proposalId);
        longReturned = IERC20(longTokenAddr).balanceOf(address(this));
        shortReturned = IERC20(shortTokenAddr).balanceOf(address(this));
        IERC20(longTokenAddr).safeTransfer(msg.sender, longReturned);
        IERC20(shortTokenAddr).safeTransfer(msg.sender, shortReturned);
        market_.finalized = true;

        emit MarketFinalized(roundId, proposalId, longReturned, shortReturned);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        Operation memory operation = abi.decode(data, (Operation));
        Market storage market_ = _getMarket(operation.roundId, operation.proposalId);

        if (operation.action == Action.SWAP) {
            BalanceDelta swapDelta = poolManager.swap(
                market_.key,
                SwapParams({
                    zeroForOne: operation.zeroForOne,
                    amountSpecified: operation.amountSpecified,
                    sqrtPriceLimitX96: operation.sqrtPriceLimitX96
                }),
                ""
            );
            _settleOrTake(market_.key.currency0, swapDelta.amount0());
            _settleOrTake(market_.key.currency1, swapDelta.amount1());
            return abi.encode(swapDelta);
        }

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            market_.key,
            ModifyLiquidityParams({
                tickLower: LOWER_TICK, tickUpper: UPPER_TICK, liquidityDelta: operation.liquidityDelta, salt: bytes32(0)
            }),
            ""
        );
        _settleOrTake(market_.key.currency0, delta.amount0());
        _settleOrTake(market_.key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _swap(uint256 roundId, uint256 proposalId, bool zeroForOne, int256 amountSpecified)
        private
        returns (BalanceDelta delta)
    {
        _getMarket(roundId, proposalId);
        uint160 priceLimit =
            zeroForOne ? TickMath.getSqrtPriceAtTick(LOWER_TICK) + 1 : TickMath.getSqrtPriceAtTick(UPPER_TICK) - 1;
        bytes memory result = poolManager.unlock(
            abi.encode(
                Operation({
                    action: Action.SWAP,
                    roundId: roundId,
                    proposalId: proposalId,
                    liquidityDelta: 0,
                    zeroForOne: zeroForOne,
                    amountSpecified: amountSpecified,
                    sqrtPriceLimitX96: priceLimit
                })
            )
        );
        delta = abi.decode(result, (BalanceDelta));
    }

    function _modifyLiquidity(uint256 roundId, uint256 proposalId, int256 liquidityDelta) private {
        poolManager.unlock(
            abi.encode(
                Operation({
                    action: liquidityDelta > 0 ? Action.ADD_LIQUIDITY : Action.REMOVE_LIQUIDITY,
                    roundId: roundId,
                    proposalId: proposalId,
                    liquidityDelta: liquidityDelta,
                    zeroForOne: false,
                    amountSpecified: 0,
                    sqrtPriceLimitX96: 0
                })
            )
        );
    }

    function _getMarket(uint256 roundId, uint256 proposalId) private view returns (Market storage market_) {
        market_ = _markets[roundId][proposalId];
        if (!market_.seeded) revert NotSeeded();
        if (market_.finalized) revert AlreadyFinalized();
    }

    function _isCurrency0(PoolKey storage key, address token) private view returns (bool) {
        return Currency.unwrap(key.currency0) == token;
    }

    function _currencyDelta(PoolKey storage key, address token, BalanceDelta delta) private view returns (int128) {
        return Currency.unwrap(key.currency0) == token ? delta.amount0() : delta.amount1();
    }

    function _settleOrTake(Currency currency, int128 delta) private {
        if (delta < 0) {
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), uint256(-int256(delta)));
            poolManager.settle();
        } else if (delta > 0) {
            poolManager.take(currency, address(this), uint256(uint128(delta)));
        }
    }
}
