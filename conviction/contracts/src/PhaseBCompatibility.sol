// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { WaveHook } from "./WaveHook.sol";

contract PhaseBCompatibilityToken is ERC20 {
    address public immutable minter;

    error OnlyMinter();

    constructor(string memory name_, string memory symbol_, address minter_) ERC20(name_, symbol_) {
        minter = minter_;
    }

    function mint(address recipient, uint256 amount) external {
        if (msg.sender != minter) revert OnlyMinter();
        _mint(recipient, amount);
    }
}

contract PhaseBCompatibilityAdapter is IUnlockCallback {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;

    uint160 private constant Q96 = 1 << 96;
    int24 private constant LOWER_TICK = -45_900;
    int24 private constant UPPER_TICK = 45_900;
    int24 private constant TICK_SPACING = 60;
    uint24 private constant POOL_FEE = 3_000;
    uint128 private constant TEST_LIQUIDITY = 1e18;
    uint256 private constant TOKEN_INVENTORY = 10e18;
    uint256 private constant TEST_SWAP_AMOUNT = 1e16;

    enum Action {
        ADD_LIQUIDITY,
        SWAP
    }

    IPoolManager public immutable poolManager;
    address public immutable owner;
    PhaseBCompatibilityToken public immutable longToken;
    PhaseBCompatibilityToken public immutable shortToken;
    WaveHook public hook;
    PoolKey private _poolKey;
    bool private configured;

    error OnlyOwner();
    error OnlyPoolManager();
    error AlreadyConfigured();
    error NotConfigured();
    error InvalidPoolKey();

    constructor(IPoolManager poolManager_, address owner_) {
        if (address(poolManager_) == address(0) || owner_ == address(0)) revert InvalidPoolKey();
        poolManager = poolManager_;
        owner = owner_;
        longToken = new PhaseBCompatibilityToken("Phase B Test LONG", "tLONG", address(this));
        shortToken = new PhaseBCompatibilityToken("Phase B Test SHORT", "tSHORT", address(this));
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    function configure(WaveHook hook_, uint64 tradingStart, uint64 tradingEnd, uint64 finalWindowSeconds)
        external
        onlyOwner
    {
        if (configured) revert AlreadyConfigured();
        if (hook_.adapter() != address(this) || address(hook_.poolManager()) != address(poolManager)) {
            revert InvalidPoolKey();
        }

        Currency longCurrency = Currency.wrap(address(longToken));
        Currency shortCurrency = Currency.wrap(address(shortToken));
        bool longIsCurrency0 = Currency.unwrap(longCurrency) < Currency.unwrap(shortCurrency);
        _poolKey = PoolKey({
            currency0: longIsCurrency0 ? longCurrency : shortCurrency,
            currency1: longIsCurrency0 ? shortCurrency : longCurrency,
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook_))
        });
        hook = hook_;
        configured = true;
        hook_.registerPool(
            _poolKey, 0, 0, address(longToken), tradingStart, tradingEnd, finalWindowSeconds, uint256(0.5e18)
        );
    }

    function initializeAndAddLiquidity() external onlyOwner {
        if (!configured) revert NotConfigured();

        poolManager.initialize(_poolKey, Q96);
        longToken.mint(address(this), TOKEN_INVENTORY);
        shortToken.mint(address(this), TOKEN_INVENTORY);
        poolManager.unlock(abi.encode(Action.ADD_LIQUIDITY, TEST_LIQUIDITY));
    }

    function compatibilitySwap() external onlyOwner returns (uint256 probabilityBefore, uint256 probabilityAfter) {
        if (!configured) revert NotConfigured();
        probabilityBefore = hook.pLong(_poolKey);
        bool zeroForOne = Currency.unwrap(_poolKey.currency0) != address(longToken);
        uint160 sqrtPriceLimitX96 =
            zeroForOne ? TickMath.getSqrtPriceAtTick(LOWER_TICK) + 1 : TickMath.getSqrtPriceAtTick(UPPER_TICK) - 1;
        poolManager.unlock(abi.encode(Action.SWAP, TEST_SWAP_AMOUNT, zeroForOne, sqrtPriceLimitX96));
        probabilityAfter = hook.pLong(_poolKey);
    }

    function pLong() external view returns (uint256) {
        if (!configured) revert NotConfigured();
        return hook.pLong(_poolKey);
    }

    function pShort() external view returns (uint256) {
        if (!configured) revert NotConfigured();
        return hook.pShort(_poolKey);
    }

    function poolKey() external view returns (PoolKey memory) {
        if (!configured) revert NotConfigured();
        return _poolKey;
    }

    function _unlockCallback(bytes calldata data) private returns (bytes memory) {
        (Action action) = abi.decode(data[:32], (Action));
        if (action == Action.ADD_LIQUIDITY) {
            (, uint128 liquidity) = abi.decode(data, (Action, uint128));
            (BalanceDelta liquidityDelta,) = poolManager.modifyLiquidity(
                _poolKey,
                ModifyLiquidityParams({
                    tickLower: LOWER_TICK,
                    tickUpper: UPPER_TICK,
                    liquidityDelta: int256(uint256(liquidity)),
                    salt: bytes32(0)
                }),
                ""
            );
            _settleOrTake(_poolKey.currency0, liquidityDelta.amount0());
            _settleOrTake(_poolKey.currency1, liquidityDelta.amount1());
            return abi.encode(liquidityDelta);
        }

        (, uint256 amountIn, bool zeroForOne, uint160 sqrtPriceLimitX96) =
            abi.decode(data, (Action, uint256, bool, uint160));
        BalanceDelta swapDelta = poolManager.swap(
            _poolKey,
            SwapParams({
                zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: sqrtPriceLimitX96
            }),
            ""
        );
        _settleOrTake(_poolKey.currency0, swapDelta.amount0());
        _settleOrTake(_poolKey.currency1, swapDelta.amount1());
        return abi.encode(swapDelta);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        return _unlockCallback(data);
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
