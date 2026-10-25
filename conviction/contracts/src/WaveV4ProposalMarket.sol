// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
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

    uint256 public constant COMPLETE_SET_SCALE = 1e12;
    uint160 private constant INITIAL_SQRT_PRICE_X96 = 1 << 96;
    int24 private constant LOWER_TICK = -45_900;
    int24 private constant UPPER_TICK = 45_900;
    int24 private constant TICK_SPACING = 60;
    uint24 private constant POOL_FEE = 3_000;

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
        longOut = uint256(uint128(longDelta));
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
        setsOut = uint256(uint128(shortDelta));
        if (setsOut < minSetsOut || setsOut == 0) revert InvalidOutput();
        IERC20(proposalTokens.shortToken(roundId, proposalId)).safeTransfer(msg.sender, setsOut);
    }

    function tradeSellLong(uint256 roundId, uint256 proposalId, uint256 longIn, uint256 minCreditsOut)
        external
        onlyRound
        returns (uint256 creditsOut)
    {
        Market storage market_ = _getMarket(roundId, proposalId);
        if (market_.pendingLongRemainder != 0 || market_.pendingShortRemainder != 0) revert PendingRemainder();

        BalanceDelta delta = _swap(
            roundId,
            proposalId,
            _isCurrency0(market_.key, proposalTokens.longToken(roundId, proposalId)),
            -int256(longIn)
        );
        int128 longDelta = _currencyDelta(market_.key, proposalTokens.longToken(roundId, proposalId), delta);
        if (longDelta >= 0) revert InvalidOutput();
        uint256 longConsumed = uint256(-int256(longDelta));
        int128 shortDelta = _currencyDelta(market_.key, proposalTokens.shortToken(roundId, proposalId), delta);
        if (shortDelta <= 0) revert InvalidOutput();
        uint256 shortOut = uint256(uint128(shortDelta));
        uint256 matched = longConsumed < shortOut ? longConsumed : shortOut;
        creditsOut = matched / COMPLETE_SET_SCALE;
        if (creditsOut < minCreditsOut || creditsOut == 0) revert InvalidOutput();

        market_.pendingLongRemainder = longIn - longConsumed;
        market_.pendingShortRemainder = shortOut;
    }

    function tradeSellShort(uint256 roundId, uint256 proposalId, uint256 setsIn, uint256 minCreditsOut)
        external
        onlyRound
        returns (uint256 creditsOut)
    {
        Market storage market_ = _getMarket(roundId, proposalId);
        if (market_.pendingLongRemainder != 0 || market_.pendingShortRemainder != 0) revert PendingRemainder();

        BalanceDelta delta = _swap(
            roundId,
            proposalId,
            _isCurrency0(market_.key, proposalTokens.shortToken(roundId, proposalId)),
            -int256(setsIn)
        );
        int128 shortDelta = _currencyDelta(market_.key, proposalTokens.shortToken(roundId, proposalId), delta);
        if (shortDelta >= 0) revert InvalidOutput();
        uint256 shortConsumed = uint256(-int256(shortDelta));
        int128 longDelta = _currencyDelta(market_.key, proposalTokens.longToken(roundId, proposalId), delta);
        if (longDelta <= 0) revert InvalidOutput();
        uint256 longOut = uint256(uint128(longDelta));
        uint256 matched = shortConsumed < longOut ? shortConsumed : longOut;
        creditsOut = matched / COMPLETE_SET_SCALE;
        if (creditsOut < minCreditsOut || creditsOut == 0) revert InvalidOutput();

        market_.pendingLongRemainder = longOut;
        market_.pendingShortRemainder = setsIn - shortConsumed;
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
