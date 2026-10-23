// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @notice Minimal resolver interface used by WavefundVault.
interface IResolver {
    /// @notice Submits a realised return for a round.
    /// @param roundId Round identifier.
    /// @param realisedReturn Return ratio in 1e18 fixed-point.
    function submitReturn(uint256 roundId, int256 realisedReturn) external;
}

/// @title WavefundVault
/// @notice Phase A vault that rebalances USDC/tETH exposure and reports realised returns to Resolver.
/// @dev Uses Uniswap v4 PoolManager unlock-callback swap flow; also supports admin mock pricing for deterministic demos.
contract WavefundVault is AccessControl, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;

    /// @notice Keeper role for round execution/reporting actions.
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    /// @notice QuantumRound role for round-originated vault deposits.
    bytes32 public constant QUANTUM_ROUND_ROLE = keccak256("QUANTUM_ROUND_ROLE");

    /// @notice Arc testnet USDC token address (6 decimals).
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    /// @notice Uniswap v4 pool fee tier for USDC/tETH (3000 = 0.3%).
    uint24 public constant POOL_FEE = 3_000;

    /// @notice Uniswap v4 pool tick spacing for USDC/tETH pool.
    int24 public constant POOL_TICK_SPACING = 60;

    /// @notice 2^96 used for Q64.96 math.
    uint256 private constant Q96 = 2 ** 96;

    /// @notice 1e18 fixed-point scalar.
    uint256 private constant ONE_E18 = 1e18;

    /// @notice Snapshot state for a round at trade execution time.
    struct RoundState {
        /// @notice Vault USDC-equivalent value (6-decimal USDC units) at executeTrade.
        uint256 startValueUsdc;
        /// @notice Vault tETH balance (18 decimals) at executeTrade.
        uint256 tEthAtStart;
        /// @notice Vault USDC balance (6 decimals) at executeTrade.
        uint256 usdcAtStart;
        /// @notice True once executeTrade ran for this round.
        bool executed;
        /// @notice True once reportReturn ran for this round.
        bool reported;
    }

    /// @notice Swap callback state staged before `poolManager.unlock`.
    struct SwapCallbackData {
        /// @notice True for USDC->tETH, false for tETH->USDC.
        bool usdcForTEth;
        /// @notice Exact-input amount sent into swap (token base units).
        uint256 amountIn;
        /// @notice True while a callback-authorized swap is active.
        bool active;
    }

    /// @notice Thrown when trade execution is attempted more than once for the same round.
    error TradeAlreadyExecuted();

    /// @notice Thrown when reportReturn is attempted more than once for the same round.
    error ReturnAlreadyReported();

    /// @notice Thrown when reportReturn is called before executeTrade.
    error TradeNotExecuted();

    /// @notice Thrown when vault lacks required balance for a requested action.
    error InsufficientVaultFunds();

    /// @notice Thrown when an address argument is zero.
    error ZeroAddress();

    /// @notice Thrown when an amount argument is zero.
    error ZeroAmount();

    /// @notice Thrown when caller is not authorized for restricted callback/admin flows.
    error Unauthorized();

    /// @notice Thrown when a usable price cannot be obtained.
    error PriceUnavailable();

    /// @notice Emitted when USDC is deposited from QuantumRound.
    /// @param amount USDC amount in 6-decimal base units.
    event Deposited(uint256 amount);

    /// @notice Emitted when admin funds the vault.
    /// @param amount USDC amount in 6-decimal base units.
    event VaultFunded(uint256 amount);

    /// @notice Emitted once a round trade is executed.
    /// @param roundId Round identifier.
    /// @param winnerTEthBps Target tETH allocation in basis points.
    /// @param deltaUsdc USDC delta (negative when USDC sold, positive when USDC bought).
    /// @param deltaTEth tETH delta (positive when tETH bought, negative when tETH sold).
    event TradeExecuted(uint256 indexed roundId, uint16 winnerTEthBps, int256 deltaUsdc, int256 deltaTEth);

    /// @notice Emitted when return is reported to resolver.
    /// @param roundId Round identifier.
    /// @param realisedReturn Realised return ratio in 1e18 fixed-point.
    event ReturnReported(uint256 indexed roundId, int256 realisedReturn);

    /// @notice Emitted when mock pricing mode is updated.
    /// @param priceUsdc Mock USDC-per-1-tETH price in 6-decimal USDC units.
    /// @param useMock Whether mock mode is enabled.
    event MockPriceSet(uint256 priceUsdc, bool useMock);

    /// @notice Emitted after each swap callback execution.
    /// @param usdcForTEth True when the executed direction is USDC->tETH.
    /// @param amountInUsed Actual input amount consumed by the pool.
    /// @param amountOutReceived Actual output amount received from the pool.
    event SwapExecuted(bool usdcForTEth, uint256 amountInUsed, uint256 amountOutReceived);

    /// @notice Pool manager used for v4 unlock/callback swaps.
    IPoolManager public immutable poolManager;

    /// @notice tETH token traded against USDC.
    IERC20 public immutable tEth;

    /// @notice Resolver receiving realised returns.
    IResolver public immutable resolver;

    /// @notice True when USDC is sorted as currency0 in pool key.
    bool public immutable usdcIsCurrency0;

    /// @notice Pool currency0 (lower address by sort order).
    Currency public immutable currency0;

    /// @notice Pool currency1 (higher address by sort order).
    Currency public immutable currency1;

    /// @notice Current vault USDC holdings tracked in 6-decimal units.
    uint256 public totalVaultUsdc;

    /// @notice Current vault tETH holdings tracked in 18-decimal units.
    uint256 public totalVaultTEth;

    /// @notice Per-round execution/reporting snapshots.
    mapping(uint256 roundId => RoundState) public roundState;

    /// @notice Toggle for mock price usage in spotPriceTEthInUsdc.
    bool public useMockPrice;

    /// @notice Mock USDC-per-1-tETH price (6-decimal USDC units).
    uint256 public mockTEthPriceUsdc;

    /// @notice Staged swap callback data used by `unlockCallback`.
    SwapCallbackData private pendingSwap;

    /// @notice Deploys Phase A WavefundVault.
    /// @param poolManager_ Uniswap v4 PoolManager address.
    /// @param tEth_ tETH ERC20 token address.
    /// @param resolver_ Resolver contract address.
    /// @param initialAdmin Initial admin/keeper role grantee.
    constructor(address poolManager_, address tEth_, address resolver_, address initialAdmin) {
        if (poolManager_ == address(0) || tEth_ == address(0) || resolver_ == address(0) || initialAdmin == address(0)) {
            revert ZeroAddress();
        }

        poolManager = IPoolManager(poolManager_);
        tEth = IERC20(tEth_);
        resolver = IResolver(resolver_);

        Currency usdcCurrency = Currency.wrap(USDC);
        Currency tEthCurrency = Currency.wrap(tEth_);

        if (Currency.unwrap(usdcCurrency) < Currency.unwrap(tEthCurrency)) {
            currency0 = usdcCurrency;
            currency1 = tEthCurrency;
            usdcIsCurrency0 = true;
        } else {
            currency0 = tEthCurrency;
            currency1 = usdcCurrency;
            usdcIsCurrency0 = false;
        }

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(KEEPER_ROLE, initialAdmin);
    }

    /// @notice Pulls USDC from QuantumRound into the vault (Phase B hook, retained in Phase A API).
    /// @param amount USDC amount in 6-decimal base units.
    function depositFromRound(uint256 amount) external nonReentrant onlyRole(QUANTUM_ROUND_ROLE) {
        if (amount == 0) revert ZeroAmount();

        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
        totalVaultUsdc += amount;

        emit Deposited(amount);
    }

    /// @notice Admin-funds the vault with USDC for demo/bootstrap liquidity.
    /// @param amount USDC amount in 6-decimal base units.
    function fundVault(uint256 amount) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == 0) revert ZeroAmount();

        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
        totalVaultUsdc += amount;

        emit VaultFunded(amount);
    }

    /// @notice Executes one round rebalance toward winner target tETH allocation.
    /// @param roundId Round identifier.
    /// @param winnerTEthBps Winner target allocation in basis points (0..10000).
    function executeTrade(uint256 roundId, uint16 winnerTEthBps) external nonReentrant onlyRole(KEEPER_ROLE) {
        RoundState storage state = roundState[roundId];
        if (state.executed) revert TradeAlreadyExecuted();
        if (winnerTEthBps > 10_000) revert PriceUnavailable();

        uint256 priceUsdcPerTEth = spotPriceTEthInUsdc();
        uint256 currentTEthValueUsdc = _tEthValueInUsdc(totalVaultTEth, priceUsdcPerTEth);
        uint256 totalValueUsdc = totalVaultUsdc + currentTEthValueUsdc;

        uint256 targetTEthValueUsdc = FullMath.mulDiv(totalValueUsdc, winnerTEthBps, 10_000);

        int256 deltaUsdc;
        int256 deltaTEth;

        if (targetTEthValueUsdc > currentTEthValueUsdc) {
            uint256 buyValueUsdc = targetTEthValueUsdc - currentTEthValueUsdc;
            if (buyValueUsdc > totalVaultUsdc) revert InsufficientVaultFunds();

            uint256 tEthOut = _swapUsdcForTEth(buyValueUsdc);
            deltaUsdc = -int256(buyValueUsdc);
            deltaTEth = int256(tEthOut);
        } else if (targetTEthValueUsdc < currentTEthValueUsdc) {
            uint256 sellValueUsdc = currentTEthValueUsdc - targetTEthValueUsdc;
            uint256 tEthIn = FullMath.mulDiv(sellValueUsdc, ONE_E18, priceUsdcPerTEth);
            if (tEthIn > totalVaultTEth) revert InsufficientVaultFunds();

            if (tEthIn > 0) {
                uint256 usdcOut = _swapTEthForUsdc(tEthIn);
                deltaUsdc = int256(usdcOut);
                deltaTEth = -int256(tEthIn);
            }
        }

        state.startValueUsdc = totalValueUsdc;
        state.tEthAtStart = totalVaultTEth;
        state.usdcAtStart = totalVaultUsdc;
        state.executed = true;
        state.reported = false;

        emit TradeExecuted(roundId, winnerTEthBps, deltaUsdc, deltaTEth);
    }

    /// @notice Reports realised return for a round to Resolver.
    /// @param roundId Round identifier.
    function reportReturn(uint256 roundId) external nonReentrant onlyRole(KEEPER_ROLE) {
        RoundState storage state = roundState[roundId];
        if (!state.executed) revert TradeNotExecuted();
        if (state.reported) revert ReturnAlreadyReported();
        if (state.startValueUsdc == 0) revert PriceUnavailable();

        uint256 currentValueUsdc = _vaultValueUsdc();
        uint256 realisedReturnU18 = FullMath.mulDiv(currentValueUsdc, ONE_E18, state.startValueUsdc);

        state.reported = true;

        int256 realisedReturn = int256(realisedReturnU18);
        resolver.submitReturn(roundId, realisedReturn);

        emit ReturnReported(roundId, realisedReturn);
    }

    /// @notice Returns spot price of tETH in USDC units per 1e18 tETH units.
    /// @dev Return scale is 6-decimal USDC base units (e.g., 2500 USDC => 2_500_000_000).
    /// @return priceUsdc USDC base units per 1e18 tETH.
    function spotPriceTEthInUsdc() public view returns (uint256 priceUsdc) {
        if (useMockPrice) {
            if (mockTEthPriceUsdc == 0) revert PriceUnavailable();
            return mockTEthPriceUsdc;
        }

        PoolKey memory key = _poolKey();
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, poolId);

        if (sqrtPriceX96 == 0) revert PriceUnavailable();

        // priceRaw = token1_units / token0_units = sqrtPriceX96^2 / 2^192
        uint256 priceRaw = FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), Q96);
        priceRaw = FullMath.mulDiv(priceRaw, 1, Q96);
        if (priceRaw == 0) revert PriceUnavailable();

        if (usdcIsCurrency0) {
            // priceRaw = tETH_units / USDC_units => invert to USDC_units per 1e18 tETH.
            priceUsdc = FullMath.mulDiv(ONE_E18, ONE_E18, priceRaw);
        } else {
            // priceRaw = USDC_units / tETH_units => scale by 1e18 tETH units.
            priceUsdc = FullMath.mulDiv(priceRaw, ONE_E18, 1);
        }

        if (priceUsdc == 0) revert PriceUnavailable();
    }

    /// @notice Sets mock pricing mode for deterministic Phase A demo operation.
    /// @param priceUsdc Mock USDC-per-1-tETH price in 6-decimal USDC base units.
    /// @param useMock Whether to use mock price in spotPriceTEthInUsdc.
    function setMockPrice(uint256 priceUsdc, bool useMock) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        if (priceUsdc == 0) revert ZeroAmount();

        mockTEthPriceUsdc = priceUsdc;
        useMockPrice = useMock;

        emit MockPriceSet(priceUsdc, useMock);
    }

    /// @notice Uniswap v4 unlock callback used to run and settle/take a staged swap.
    /// @dev Restricted to PoolManager and only while `pendingSwap.active` is true.
    /// @param data Unused unlock payload (kept for interface compatibility).
    /// @return result ABI-encoded `(amountInUsed, amountOutReceived)` for caller-side accounting.
    function unlockCallback(bytes calldata data) external override returns (bytes memory result) {
        data;

        if (msg.sender != address(poolManager)) revert Unauthorized();
        if (!pendingSwap.active) revert Unauthorized();

        PoolKey memory key = _poolKey();
        bool zeroForOne = pendingSwap.usdcForTEth ? usdcIsCurrency0 : !usdcIsCurrency0;

        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(pendingSwap.amountIn),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });

        BalanceDelta delta = poolManager.swap(key, params, "");

        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();

        if (amount0 < 0) {
            uint256 pay0 = uint256(uint128(-amount0));
            _syncTransferAndSettle(key.currency0, pay0);
        } else if (amount0 > 0) {
            poolManager.take(key.currency0, address(this), uint256(uint128(amount0)));
        }

        if (amount1 < 0) {
            uint256 pay1 = uint256(uint128(-amount1));
            _syncTransferAndSettle(key.currency1, pay1);
        } else if (amount1 > 0) {
            poolManager.take(key.currency1, address(this), uint256(uint128(amount1)));
        }

        (int128 usdcDelta, int128 tEthDelta) = usdcIsCurrency0 ? (amount0, amount1) : (amount1, amount0);

        uint256 amountInUsed;
        uint256 amountOutReceived;

        if (pendingSwap.usdcForTEth) {
            amountInUsed = usdcDelta < 0 ? uint256(uint128(-usdcDelta)) : 0;
            amountOutReceived = tEthDelta > 0 ? uint256(uint128(tEthDelta)) : 0;
        } else {
            amountInUsed = tEthDelta < 0 ? uint256(uint128(-tEthDelta)) : 0;
            amountOutReceived = usdcDelta > 0 ? uint256(uint128(usdcDelta)) : 0;
        }

        emit SwapExecuted(pendingSwap.usdcForTEth, amountInUsed, amountOutReceived);
        return abi.encode(amountInUsed, amountOutReceived);
    }

    /// @notice Swaps USDC for tETH via PoolManager unlock callback flow.
    /// @param usdcAmountIn USDC exact-input amount (6-decimal base units).
    /// @return tEthOut tETH amount received (18-decimal base units).
    function _swapUsdcForTEth(uint256 usdcAmountIn) internal returns (uint256 tEthOut) {
        if (usdcAmountIn == 0) revert ZeroAmount();
        if (usdcAmountIn > totalVaultUsdc) revert InsufficientVaultFunds();

        pendingSwap = SwapCallbackData({usdcForTEth: true, amountIn: usdcAmountIn, active: true});
        bytes memory unlockResult = poolManager.unlock(abi.encode(usdcAmountIn));
        pendingSwap.active = false;

        (uint256 usdcInUsed, uint256 tEthReceived) = abi.decode(unlockResult, (uint256, uint256));
        if (usdcInUsed > totalVaultUsdc) revert InsufficientVaultFunds();

        totalVaultUsdc -= usdcInUsed;
        totalVaultTEth += tEthReceived;

        return tEthReceived;
    }

    /// @notice Swaps tETH for USDC via PoolManager unlock callback flow.
    /// @param tEthAmountIn tETH exact-input amount (18-decimal base units).
    /// @return usdcOut USDC amount received (6-decimal base units).
    function _swapTEthForUsdc(uint256 tEthAmountIn) internal returns (uint256 usdcOut) {
        if (tEthAmountIn == 0) revert ZeroAmount();
        if (tEthAmountIn > totalVaultTEth) revert InsufficientVaultFunds();

        pendingSwap = SwapCallbackData({usdcForTEth: false, amountIn: tEthAmountIn, active: true});
        bytes memory unlockResult = poolManager.unlock(abi.encode(tEthAmountIn));
        pendingSwap.active = false;

        (uint256 tEthInUsed, uint256 usdcReceived) = abi.decode(unlockResult, (uint256, uint256));
        if (tEthInUsed > totalVaultTEth) revert InsufficientVaultFunds();

        totalVaultTEth -= tEthInUsed;
        totalVaultUsdc += usdcReceived;

        return usdcReceived;
    }

    /// @notice Returns vault total value in 6-decimal USDC units using current spot price source.
    /// @return valueUsdc Vault value in USDC base units.
    function _vaultValueUsdc() internal view returns (uint256 valueUsdc) {
        uint256 tEthValueUsdc = _tEthValueInUsdc(totalVaultTEth, spotPriceTEthInUsdc());
        return totalVaultUsdc + tEthValueUsdc;
    }

    /// @notice Converts tETH amount to USDC value using provided USDC-per-tETH price.
    /// @param tEthAmount tETH amount in 18-decimal units.
    /// @param priceUsdcPerTEth USDC units per 1e18 tETH.
    /// @return valueUsdc USDC value in 6-decimal base units.
    function _tEthValueInUsdc(uint256 tEthAmount, uint256 priceUsdcPerTEth) internal pure returns (uint256 valueUsdc) {
        if (priceUsdcPerTEth == 0) revert PriceUnavailable();
        return FullMath.mulDiv(tEthAmount, priceUsdcPerTEth, ONE_E18);
    }

    /// @notice Builds canonical USDC/tETH pool key.
    /// @return key PoolKey for the USDC/tETH pool.
    function _poolKey() internal view returns (PoolKey memory key) {
        return PoolKey({currency0: currency0, currency1: currency1, fee: POOL_FEE, tickSpacing: POOL_TICK_SPACING, hooks: IHooks(address(0))});
    }

    /// @notice Syncs a currency balance, transfers owed tokens to PoolManager, then settles owed delta.
    /// @param currency Currency to settle.
    /// @param amount Amount to transfer/settle.
    function _syncTransferAndSettle(Currency currency, uint256 amount) internal {
        if (amount == 0) return;

        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }
}
