// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { BalanceDeltaLibrary } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";

import { IPriceOracle } from "./IPriceOracle.sol";
import { VaultPriceMath } from "./VaultPriceMath.sol";

/// @notice Minimal resolver interface used by WavefundVault.
interface IResolver {
    /// @notice Submits a realised return for a round.
    /// @param roundId Round identifier.
    /// @param realisedReturn Return ratio in 1e18 fixed-point.
    function submitReturn(uint256 roundId, int256 realisedReturn) external;
}

interface IQuantumRoundVault {
    function cancelRound(uint256 roundId) external;
    function roundEvaluationEnd(uint256 roundId) external view returns (uint64);
}

/// @title WavefundVault
/// @notice Phase A vault that rebalances USDC/tETH exposure and reports realised returns to Resolver.
/// @dev Uses oracle-marked NAV and Uniswap v4 PoolManager unlock-callback swaps.
contract WavefundVault is AccessControl, ERC20, ReentrancyGuard, IUnlockCallback {
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

    /// @notice 1e18 fixed-point scalar.
    uint256 private constant ONE_E18 = 1e18;

    /// @notice One USDC in base units; the initial share price is 1 USDC per share.
    uint256 private constant INITIAL_SHARE_PRICE_USDC = 1_000_000;

    /// @notice Maximum age of an oracle update accepted at execution or resolution.
    uint64 public constant MAX_ORACLE_AGE = 5 minutes;

    /// @notice Snapshot state for a round at trade execution time.
    struct RoundState {
        /// @notice Oracle-marked NAV immediately before the attempted trade (6-decimal USDC units).
        uint256 startValueUsdc;
        /// @notice Vault tETH balance (18 decimals) immediately before the trade.
        uint256 tEthAtStart;
        /// @notice Vault USDC balance (6 decimals) immediately before the trade.
        uint256 usdcAtStart;
        /// @notice Oracle ETH/USD price in 6-decimal USDC per 1e18 tETH at the start mark.
        uint256 startPriceUsdc;
        /// @notice Timestamp of the pre-trade NAV mark.
        uint64 navTimestamp;
        /// @notice True once executeTrade ran for this round.
        bool executed;
        /// @notice True once reportReturn ran for this round.
        bool reported;
        /// @notice True when a swap exceeded the slippage cap and the round was canceled.
        bool cancelled;
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

    /// @notice Thrown when the configured slippage cap is invalid.
    error InvalidSlippageCap();

    /// @notice Thrown when the price update is stale, future-dated, or predates evaluation end.
    error StaleOraclePrice();

    /// @notice Thrown when a trade exceeds the configured oracle-relative slippage cap.
    error SlippageCapExceeded(uint256 expectedOut, uint256 actualOut);

    /// @notice Thrown when a round is canceled and cannot be reported or traded.
    error RoundCancelled();

    /// @notice Thrown when a deposit would mint no shares or shares cannot be priced.
    error InvalidShareAmount();

    /// @notice Thrown when an asset or amount is not eligible for admin rescue.
    error NotUnallocatedFunds();

    /// @notice Thrown when the vault cannot satisfy a queued withdrawal.
    error InsufficientWithdrawalLiquidity();

    /// @notice Thrown when the private atomic rebalance helper is called by anyone except this contract.
    error OnlySelf();

    /// @notice Emitted when USDC is deposited from QuantumRound.
    /// @param amount USDC amount in 6-decimal base units.
    event Deposited(uint256 amount);

    /// @notice Emitted when admin funds the vault.
    /// @param amount USDC amount in 6-decimal base units.
    event VaultFunded(uint256 amount);

    /// @notice Emitted when a user queues a USDC deposit for the next trade boundary.
    event DepositRequested(address indexed account, uint256 amountUsdc);

    /// @notice Emitted when a queued USDC deposit is priced and issued as vault shares.
    event DepositProcessed(address indexed account, uint256 amountUsdc, uint256 shares);

    /// @notice Emitted when a user queues vault shares for withdrawal at the next trade boundary.
    event WithdrawalRequested(address indexed account, uint256 shares);

    /// @notice Emitted when queued shares are burned and their oracle-marked value is paid.
    event WithdrawalProcessed(address indexed account, uint256 shares, uint256 amountUsdc);

    /// @notice Emitted when a queued deposit is canceled and its USDC is returned.
    event DepositRequestCanceled(address indexed account, uint256 amountUsdc);

    /// @notice Emitted when a queued withdrawal is canceled and its shares are returned.
    event WithdrawalRequestCanceled(address indexed account, uint256 shares);

    /// @notice Emitted when admin capital is recognized as vault shares.
    event AdminBalanceMigrated(address indexed account, uint256 amountUsdc, uint256 shares);

    /// @notice Emitted when admin rescues tokens not accounted for as user assets.
    event UnallocatedFundsRescued(address indexed token, address indexed recipient, uint256 amount);

    /// @notice Emitted once a round trade is executed.
    /// @param roundId Round identifier.
    /// @param winnerTEthBps Target tETH allocation in basis points.
    /// @param deltaUsdc USDC delta (negative when USDC sold, positive when USDC bought).
    /// @param deltaTEth tETH delta (positive when tETH bought, negative when tETH sold).
    event TradeExecuted(uint256 indexed roundId, uint16 winnerTEthBps, int256 deltaUsdc, int256 deltaTEth);

    /// @notice Emitted immediately before the round rebalance using the current oracle price.
    event NAVMarked(uint256 indexed roundId, uint256 navUsdc, uint256 priceUsdcPerTEth, uint64 publishedAt);

    /// @notice Emitted when the atomic rebalance exceeds the oracle-relative slippage cap.
    event SlippageBreach(uint256 indexed roundId, uint256 expectedOut, uint256 actualOut, uint16 maxSlippageBps);

    /// @notice Emitted after the round is canceled and all deposits become redeemable at par.
    event TradeCancelled(uint256 indexed roundId);

    /// @notice Emitted when return is reported to resolver.
    /// @param roundId Round identifier.
    /// @param realisedReturn Realised return ratio in 1e18 fixed-point.
    event ReturnReported(uint256 indexed roundId, int256 realisedReturn);

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

    /// @notice QuantumRound that can be canceled after a failed slippage check.
    IQuantumRoundVault public immutable quantumRound;

    /// @notice ETH/USD oracle; its converted answer is USDC base units per 1e18 tETH.
    IPriceOracle public immutable priceOracle;

    /// @notice Maximum permitted execution slippage relative to the oracle price.
    uint16 public immutable maxSlippageBps;

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

    /// @notice USDC deposits held for users until the next decision boundary.
    uint256 public totalQueuedDepositUsdc;

    /// @notice Shares held in escrow for withdrawals at the next decision boundary.
    uint256 public totalQueuedWithdrawalShares;

    /// @notice Per-user USDC deposits awaiting the next decision boundary.
    mapping(address account => uint256 amountUsdc) public queuedDepositUsdc;

    /// @notice Per-user shares held in escrow for withdrawal.
    mapping(address account => uint256 shares) public queuedWithdrawalShares;

    mapping(address account => bool queued) private _isQueuedAccount;
    address[] private _queuedAccounts;

    /// @notice Per-round execution/reporting snapshots.
    mapping(uint256 roundId => RoundState) public roundState;

    /// @notice Staged swap callback data used by `unlockCallback`.
    SwapCallbackData private pendingSwap;

    /// @notice Deploys Phase A WavefundVault.
    /// @param poolManager_ Uniswap v4 PoolManager address.
    /// @param tEth_ tETH ERC20 token address.
    /// @param resolver_ Resolver contract address.
    /// @param quantumRound_ Round contract authorized to cancel on slippage breach.
    /// @param priceOracle_ ETH/USD price source.
    /// @param maxSlippageBps_ Maximum permitted swap slippage in basis points.
    /// @param initialAdmin Initial admin/keeper role grantee.
    constructor(
        address poolManager_,
        address tEth_,
        address resolver_,
        address quantumRound_,
        address priceOracle_,
        uint16 maxSlippageBps_,
        address initialAdmin
    ) ERC20("Wavefund Vault Share", "WAVE") {
        if (
            poolManager_ == address(0) || tEth_ == address(0) || resolver_ == address(0) || quantumRound_ == address(0)
                || priceOracle_ == address(0) || initialAdmin == address(0)
        ) {
            revert ZeroAddress();
        }
        if (maxSlippageBps_ > 10_000) revert InvalidSlippageCap();

        poolManager = IPoolManager(poolManager_);
        tEth = IERC20(tEth_);
        resolver = IResolver(resolver_);
        quantumRound = IQuantumRoundVault(quantumRound_);
        priceOracle = IPriceOracle(priceOracle_);
        maxSlippageBps = maxSlippageBps_;

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

    /// @notice Admin-funds the vault and issues shares at the current oracle-marked NAV.
    /// @param amount USDC amount in 6-decimal base units.
    function fundVault(uint256 amount) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == 0) revert ZeroAmount();

        uint256 shares = _sharesForAdminFunding(amount);
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
        totalVaultUsdc += amount;
        _mint(msg.sender, shares);

        emit VaultFunded(amount);
    }

    /// @notice Imports admin-owned USDC into this vault and records it as share-backed assets.
    /// @dev The legacy deployed vault has no withdrawal path; this cannot pull funds from it.
    ///      Admin must first hold the migratable USDC and approve this contract.
    /// @param amount USDC amount in 6-decimal base units.
    function migrateAdminFundedBalance(uint256 amount) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == 0) revert ZeroAmount();

        uint256 shares = _sharesForAdminFunding(amount);
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
        totalVaultUsdc += amount;
        _mint(msg.sender, shares);

        emit AdminBalanceMigrated(msg.sender, amount, shares);
    }

    /// @notice Queues a USDC deposit to be priced and issued as shares at the next decision boundary.
    /// @param amount USDC amount in 6-decimal base units.
    function requestDeposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
        queuedDepositUsdc[msg.sender] += amount;
        totalQueuedDepositUsdc += amount;
        _queueAccount(msg.sender);

        emit DepositRequested(msg.sender, amount);
    }

    /// @notice Queues shares for withdrawal at the next decision boundary.
    /// @param shares Amount of 18-decimal WAVE shares to withdraw.
    function requestWithdraw(uint256 shares) external nonReentrant {
        if (shares == 0) revert ZeroAmount();

        _transfer(msg.sender, address(this), shares);
        queuedWithdrawalShares[msg.sender] += shares;
        totalQueuedWithdrawalShares += shares;
        _queueAccount(msg.sender);

        emit WithdrawalRequested(msg.sender, shares);
    }

    /// @notice Cancels the caller's pending deposit and returns its USDC.
    function cancelDepositRequest() external nonReentrant {
        uint256 amount = queuedDepositUsdc[msg.sender];
        if (amount == 0) revert ZeroAmount();

        delete queuedDepositUsdc[msg.sender];
        totalQueuedDepositUsdc -= amount;
        _removeQueueAccountIfEmpty(msg.sender);
        IERC20(USDC).safeTransfer(msg.sender, amount);

        emit DepositRequestCanceled(msg.sender, amount);
    }

    /// @notice Cancels the caller's pending withdrawal and returns escrowed shares.
    function cancelWithdrawRequest() external nonReentrant {
        uint256 shares = queuedWithdrawalShares[msg.sender];
        if (shares == 0) revert ZeroAmount();

        delete queuedWithdrawalShares[msg.sender];
        totalQueuedWithdrawalShares -= shares;
        _removeQueueAccountIfEmpty(msg.sender);
        _transfer(address(this), msg.sender, shares);

        emit WithdrawalRequestCanceled(msg.sender, shares);
    }

    /// @notice Rescues only token balances not accounted for as assets owed to vault shareholders.
    /// @param token USDC or the configured tETH token.
    /// @param amount Token amount to rescue.
    /// @param recipient Destination for the rescued tokens.
    function rescueUnallocatedFunds(address token, uint256 amount, address recipient)
        external
        nonReentrant
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();

        uint256 protectedAmount;
        if (token == USDC) {
            protectedAmount = totalQueuedDepositUsdc;
            if (totalSupply() > 0) protectedAmount += totalVaultUsdc;
            else if (amount <= totalVaultUsdc) totalVaultUsdc -= amount;
            else totalVaultUsdc = 0;
        } else if (token == address(tEth)) {
            if (totalSupply() > 0) protectedAmount = totalVaultTEth;
            else if (amount <= totalVaultTEth) totalVaultTEth -= amount;
            else totalVaultTEth = 0;
        } else {
            revert NotUnallocatedFunds();
        }

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < protectedAmount || amount > balance - protectedAmount) {
            revert NotUnallocatedFunds();
        }

        IERC20(token).safeTransfer(recipient, amount);
        emit UnallocatedFundsRescued(token, recipient, amount);
    }

    /// @notice Executes one round rebalance toward winner target tETH allocation.
    /// @param roundId Round identifier.
    /// @param winnerTEthBps Winner target allocation in basis points (0..10000).
    function executeTrade(uint256 roundId, uint16 winnerTEthBps) external nonReentrant onlyRole(KEEPER_ROLE) {
        RoundState storage state = roundState[roundId];
        if (state.executed || state.cancelled) revert TradeAlreadyExecuted();
        if (winnerTEthBps > 10_000) revert PriceUnavailable();
        if (quantumRound.roundEvaluationEnd(roundId) == 0) revert PriceUnavailable();

        (uint256 priceUsdcPerTEth, uint64 publishedAt) = _readFreshOraclePrice();
        _processQueuedRequests(priceUsdcPerTEth);

        uint256 currentTEthValueUsdc = _tEthValueInUsdc(totalVaultTEth, priceUsdcPerTEth);
        uint256 totalValueUsdc = totalVaultUsdc + currentTEthValueUsdc;
        if (totalValueUsdc == 0) revert PriceUnavailable();

        state.startValueUsdc = totalValueUsdc;
        state.tEthAtStart = totalVaultTEth;
        state.usdcAtStart = totalVaultUsdc;
        state.startPriceUsdc = priceUsdcPerTEth;
        state.navTimestamp = uint64(block.timestamp);
        state.reported = false;

        emit NAVMarked(roundId, totalValueUsdc, priceUsdcPerTEth, publishedAt);

        try this.performTrade(winnerTEthBps, priceUsdcPerTEth) returns (int256 deltaUsdc, int256 deltaTEth) {
            state.executed = true;
            emit TradeExecuted(roundId, winnerTEthBps, deltaUsdc, deltaTEth);
        } catch (bytes memory reason) {
            bytes4 errorSelector = bytes4(0);
            if (reason.length >= 4) {
                assembly ("memory-safe") {
                    errorSelector := mload(add(reason, 32))
                }
            }
            if (errorSelector != SlippageCapExceeded.selector || reason.length != 68) {
                assembly ("memory-safe") {
                    revert(add(reason, 32), mload(reason))
                }
            }

            uint256 expectedOut;
            uint256 actualOut;
            assembly ("memory-safe") {
                expectedOut := mload(add(reason, 36))
                actualOut := mload(add(reason, 68))
            }

            state.cancelled = true;
            quantumRound.cancelRound(roundId);
            emit SlippageBreach(roundId, expectedOut, actualOut, maxSlippageBps);
            emit TradeCancelled(roundId);
        }
    }

    /// @dev Runs as a nested self-call so a slippage breach can roll back the swap, then persist cancellation.
    function performTrade(uint16 winnerTEthBps, uint256 priceUsdcPerTEth)
        external
        returns (int256 deltaUsdc, int256 deltaTEth)
    {
        if (msg.sender != address(this)) revert OnlySelf();

        uint256 currentTEthValueUsdc = _tEthValueInUsdc(totalVaultTEth, priceUsdcPerTEth);
        uint256 totalValueUsdc = totalVaultUsdc + currentTEthValueUsdc;
        uint256 targetTEthValueUsdc = FullMath.mulDiv(totalValueUsdc, winnerTEthBps, 10_000);

        if (targetTEthValueUsdc > currentTEthValueUsdc) {
            uint256 requestedUsdcIn = targetTEthValueUsdc - currentTEthValueUsdc;
            if (requestedUsdcIn > totalVaultUsdc) revert InsufficientVaultFunds();

            (uint256 usdcInUsed, uint256 tEthOut) = _swapUsdcForTEth(requestedUsdcIn);
            uint256 expectedTEthOut = FullMath.mulDiv(requestedUsdcIn, ONE_E18, priceUsdcPerTEth);
            if (
                usdcInUsed != requestedUsdcIn
                    || !VaultPriceMath.withinSlippage(expectedTEthOut, tEthOut, maxSlippageBps)
            ) {
                revert SlippageCapExceeded(expectedTEthOut, tEthOut);
            }
            deltaUsdc = -int256(usdcInUsed);
            deltaTEth = int256(tEthOut);
        } else if (targetTEthValueUsdc < currentTEthValueUsdc) {
            uint256 requestedTEthIn =
                FullMath.mulDiv(currentTEthValueUsdc - targetTEthValueUsdc, ONE_E18, priceUsdcPerTEth);
            if (requestedTEthIn > totalVaultTEth) revert InsufficientVaultFunds();

            if (requestedTEthIn > 0) {
                (uint256 tEthInUsed, uint256 usdcOut) = _swapTEthForUsdc(requestedTEthIn);
                uint256 expectedUsdcOut = FullMath.mulDiv(requestedTEthIn, priceUsdcPerTEth, ONE_E18);
                if (
                    tEthInUsed != requestedTEthIn
                        || !VaultPriceMath.withinSlippage(expectedUsdcOut, usdcOut, maxSlippageBps)
                ) {
                    revert SlippageCapExceeded(expectedUsdcOut, usdcOut);
                }
                deltaUsdc = int256(usdcOut);
                deltaTEth = -int256(tEthInUsed);
            }
        }
    }

    /// @notice Marks evaluation NAV and submits the realized return to Resolver.
    /// @dev The oracle update must be published on or after evaluationEnd and remain fresh.
    function reportReturn(uint256 roundId) external nonReentrant onlyRole(KEEPER_ROLE) {
        RoundState storage state = roundState[roundId];
        if (state.cancelled) revert RoundCancelled();
        if (!state.executed) revert TradeNotExecuted();
        if (state.reported) revert ReturnAlreadyReported();
        if (state.startValueUsdc == 0) revert PriceUnavailable();

        (uint256 priceUsdcPerTEth, uint64 publishedAt) = _readFreshOraclePrice();
        uint64 evaluationEnd = quantumRound.roundEvaluationEnd(roundId);
        if (evaluationEnd == 0 || publishedAt < evaluationEnd) revert StaleOraclePrice();

        uint256 currentValueUsdc = _vaultValueUsdc(priceUsdcPerTEth);
        uint256 realisedReturnU18 = FullMath.mulDiv(currentValueUsdc, ONE_E18, state.startValueUsdc);

        state.reported = true;
        resolver.submitReturn(roundId, int256(realisedReturnU18));

        emit ReturnReported(roundId, int256(realisedReturnU18));
    }

    /// @notice Returns the v4 pool price as 6-decimal USDC per 1e18 tETH.
    function spotPriceTEthInUsdc() public view returns (uint256) {
        PoolId poolId = _poolKey().toId();
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, poolId);
        return VaultPriceMath.fromSqrtPriceX96(sqrtPriceX96, usdcIsCurrency0);
    }

    /// @notice Returns the latest ETH/USD oracle price in 6-decimal USDC per 1e18 tETH.
    function oraclePriceTEthInUsdc() public view returns (uint256) {
        (int256 answer, uint8 answerDecimals,) = priceOracle.latestPrice();
        return VaultPriceMath.fromOracle(answer, answerDecimals);
    }

    /// @notice Returns the current oracle-marked vault NAV in 6-decimal USDC units.
    function totalAssetsUsdc() external view returns (uint256) {
        (uint256 priceUsdcPerTEth,) = _readFreshOraclePrice();
        return _vaultValueUsdc(priceUsdcPerTEth);
    }

    /// @notice Returns USDC base units per WAVE share with 18 additional decimal places.
    /// @dev An empty vault reports the initial price of 1 USDC per share.
    function navPerShare() external view returns (uint256) {
        (uint256 priceUsdcPerTEth,) = _readFreshOraclePrice();
        uint256 supply = totalSupply();
        uint256 navUsdc = _vaultValueUsdc(priceUsdcPerTEth);
        if (supply == 0) return navUsdc == 0 ? INITIAL_SHARE_PRICE_USDC * ONE_E18 : 0;

        return FullMath.mulDiv(navUsdc, ONE_E18 * ONE_E18, supply);
    }

    function _readFreshOraclePrice() internal view returns (uint256 priceUsdcPerTEth, uint64 publishedAt) {
        (int256 answer, uint8 answerDecimals, uint64 updatedAt) = priceOracle.latestPrice();
        if (updatedAt == 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > MAX_ORACLE_AGE) {
            revert StaleOraclePrice();
        }

        priceUsdcPerTEth = VaultPriceMath.fromOracle(answer, answerDecimals);
        publishedAt = updatedAt;
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
    /// @return usdcInUsed USDC input consumed (6-decimal base units).
    /// @return tEthOut tETH amount received (18-decimal base units).
    function _swapUsdcForTEth(uint256 usdcAmountIn) internal returns (uint256 usdcInUsed, uint256 tEthOut) {
        if (usdcAmountIn == 0) revert ZeroAmount();
        if (usdcAmountIn > totalVaultUsdc) revert InsufficientVaultFunds();

        pendingSwap = SwapCallbackData({ usdcForTEth: true, amountIn: usdcAmountIn, active: true });
        bytes memory unlockResult = poolManager.unlock(abi.encode(usdcAmountIn));
        pendingSwap.active = false;

        uint256 tEthReceived;
        (usdcInUsed, tEthReceived) = abi.decode(unlockResult, (uint256, uint256));
        if (usdcInUsed > totalVaultUsdc) revert InsufficientVaultFunds();

        totalVaultUsdc -= usdcInUsed;
        totalVaultTEth += tEthReceived;

        return (usdcInUsed, tEthReceived);
    }

    /// @notice Swaps tETH for USDC via PoolManager unlock callback flow.
    /// @param tEthAmountIn tETH exact-input amount (18-decimal base units).
    /// @return tEthInUsed tETH input consumed (18-decimal base units).
    /// @return usdcOut USDC amount received (6-decimal base units).
    function _swapTEthForUsdc(uint256 tEthAmountIn) internal returns (uint256 tEthInUsed, uint256 usdcOut) {
        if (tEthAmountIn == 0) revert ZeroAmount();
        if (tEthAmountIn > totalVaultTEth) revert InsufficientVaultFunds();

        pendingSwap = SwapCallbackData({ usdcForTEth: false, amountIn: tEthAmountIn, active: true });
        bytes memory unlockResult = poolManager.unlock(abi.encode(tEthAmountIn));
        pendingSwap.active = false;

        uint256 usdcReceived;
        (tEthInUsed, usdcReceived) = abi.decode(unlockResult, (uint256, uint256));
        if (tEthInUsed > totalVaultTEth) revert InsufficientVaultFunds();

        totalVaultTEth -= tEthInUsed;
        totalVaultUsdc += usdcReceived;

        return (tEthInUsed, usdcReceived);
    }

    /// @notice Returns vault total value in 6-decimal USDC units using the supplied oracle price.
    /// @return valueUsdc Vault value in USDC base units.
    function _vaultValueUsdc(uint256 priceUsdcPerTEth) internal view returns (uint256 valueUsdc) {
        uint256 tEthValueUsdc = _tEthValueInUsdc(totalVaultTEth, priceUsdcPerTEth);
        return totalVaultUsdc + tEthValueUsdc;
    }

    function _sharesForAdminFunding(uint256 amount) internal view returns (uint256 shares) {
        uint256 supply = totalSupply();
        if (supply == 0) {
            if (totalVaultUsdc != 0 || totalVaultTEth != 0) revert InvalidShareAmount();
            return FullMath.mulDiv(amount, ONE_E18, INITIAL_SHARE_PRICE_USDC);
        }

        (uint256 priceUsdcPerTEth,) = _readFreshOraclePrice();
        uint256 navUsdc = _vaultValueUsdc(priceUsdcPerTEth);
        if (navUsdc == 0) revert InvalidShareAmount();

        shares = FullMath.mulDiv(amount, supply, navUsdc);
        if (shares == 0) revert InvalidShareAmount();
    }

    function _processQueuedRequests(uint256 priceUsdcPerTEth) internal {
        uint256 accountCount = _queuedAccounts.length;
        if (accountCount == 0) return;

        address[] memory accounts = _queuedAccounts;
        delete _queuedAccounts;

        uint256 navUsdc = _vaultValueUsdc(priceUsdcPerTEth);
        uint256 supply = totalSupply();

        for (uint256 i; i < accountCount; ++i) {
            address account = accounts[i];
            uint256 amountUsdc = queuedDepositUsdc[account];
            if (amountUsdc == 0) continue;

            uint256 shares = _sharesForDeposit(amountUsdc, navUsdc, supply);
            delete queuedDepositUsdc[account];
            totalQueuedDepositUsdc -= amountUsdc;
            totalVaultUsdc += amountUsdc;
            _mint(account, shares);

            emit DepositProcessed(account, amountUsdc, shares);
        }

        for (uint256 i; i < accountCount; ++i) {
            address account = accounts[i];
            uint256 shares = queuedWithdrawalShares[account];
            if (shares == 0) continue;

            uint256 amountUsdc = supply == 0 ? 0 : FullMath.mulDiv(shares, navUsdc, supply);
            delete queuedWithdrawalShares[account];
            totalQueuedWithdrawalShares -= shares;
            _burn(address(this), shares);

            if (amountUsdc > 0) {
                _ensureWithdrawalLiquidity(amountUsdc, priceUsdcPerTEth);
                totalVaultUsdc -= amountUsdc;
                IERC20(USDC).safeTransfer(account, amountUsdc);
            }

            emit WithdrawalProcessed(account, shares, amountUsdc);
        }

        for (uint256 i; i < accountCount; ++i) {
            _isQueuedAccount[accounts[i]] = false;
        }
    }

    function _sharesForDeposit(uint256 amountUsdc, uint256 navUsdc, uint256 supply)
        internal
        pure
        returns (uint256 shares)
    {
        if (supply == 0) {
            if (navUsdc != 0) revert InvalidShareAmount();
            shares = FullMath.mulDiv(amountUsdc, ONE_E18, INITIAL_SHARE_PRICE_USDC);
        } else {
            if (navUsdc == 0) revert InvalidShareAmount();
            shares = FullMath.mulDiv(amountUsdc, supply, navUsdc);
        }

        if (shares == 0) revert InvalidShareAmount();
    }

    function _ensureWithdrawalLiquidity(uint256 amountUsdc, uint256 priceUsdcPerTEth) internal {
        if (totalVaultUsdc >= amountUsdc) return;

        uint256 shortfallUsdc = amountUsdc - totalVaultUsdc;
        uint256 requestedTEthIn = FullMath.mulDiv(shortfallUsdc, ONE_E18, priceUsdcPerTEth);
        if (FullMath.mulDiv(requestedTEthIn, priceUsdcPerTEth, ONE_E18) < shortfallUsdc) {
            ++requestedTEthIn;
        }
        if (requestedTEthIn > totalVaultTEth) revert InsufficientWithdrawalLiquidity();

        (uint256 tEthInUsed, uint256 usdcOut) = _swapTEthForUsdc(requestedTEthIn);
        uint256 expectedUsdcOut = FullMath.mulDiv(tEthInUsed, priceUsdcPerTEth, ONE_E18);
        if (tEthInUsed != requestedTEthIn || !VaultPriceMath.withinSlippage(expectedUsdcOut, usdcOut, maxSlippageBps)) {
            revert SlippageCapExceeded(expectedUsdcOut, usdcOut);
        }
        if (totalVaultUsdc < amountUsdc) revert InsufficientWithdrawalLiquidity();
    }

    function _queueAccount(address account) internal {
        if (_isQueuedAccount[account]) return;

        _isQueuedAccount[account] = true;
        _queuedAccounts.push(account);
    }

    function _removeQueueAccountIfEmpty(address account) internal {
        if (queuedDepositUsdc[account] != 0 || queuedWithdrawalShares[account] != 0) return;
        if (!_isQueuedAccount[account]) return;

        _isQueuedAccount[account] = false;
        uint256 accountCount = _queuedAccounts.length;
        for (uint256 i; i < accountCount; ++i) {
            if (_queuedAccounts[i] != account) continue;

            _queuedAccounts[i] = _queuedAccounts[accountCount - 1];
            _queuedAccounts.pop();
            return;
        }
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
        return PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: POOL_FEE,
            tickSpacing: POOL_TICK_SPACING,
            hooks: IHooks(address(0))
        });
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
