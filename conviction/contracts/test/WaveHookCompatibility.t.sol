// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { BalanceDelta, BalanceDeltaLibrary } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { CurrencySettler } from "@uniswap/v4-core/test/utils/CurrencySettler.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { WaveHook } from "../src/WaveHook.sol";

address constant ARC_TESTNET_POOL_MANAGER = 0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A;
uint256 constant ARC_TESTNET_CHAIN_ID = 5_042_002;
uint160 constant Q96 = 1 << 96;
int24 constant TEST_LOWER_TICK = -45_900;
int24 constant TEST_UPPER_TICK = 45_900;
int24 constant TEST_TICK_SPACING = 60;
uint160 constant WAVE_HOOK_FLAGS = uint160(
    Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
        | Hooks.AFTER_SWAP_FLAG
);

contract WaveHookTestToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) { }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract WaveHookCompatibilityTest is Test, IUnlockCallback {
    using CurrencyLibrary for Currency;
    using BalanceDeltaLibrary for BalanceDelta;

    enum Action {
        ADD_LIQUIDITY,
        SWAP
    }

    struct Operation {
        Action action;
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    IPoolManager private manager;
    WaveHook private hook;
    WaveHookTestToken private longToken;
    WaveHookTestToken private shortToken;
    PoolKey private key;
    uint64 private tradingStart;
    uint64 private tradingEnd;

    function setUp() public {
        manager = block.chainid == ARC_TESTNET_CHAIN_ID
            ? IPoolManager(ARC_TESTNET_POOL_MANAGER)
            : IPoolManager(address(new PoolManager(address(this))));

        longToken = new WaveHookTestToken("Test LONG", "LONG");
        shortToken = new WaveHookTestToken("Test SHORT", "SHORT");
        tradingStart = uint64(block.timestamp + 1);
        tradingEnd = tradingStart + 300;

        bytes memory constructorArgs = abi.encode(
            manager, address(this), address(longToken), tradingStart, tradingEnd, uint64(60), uint256(0.5e18)
        );
        (address expectedHook, bytes32 salt) =
            HookMiner.find(address(this), WAVE_HOOK_FLAGS, type(WaveHook).creationCode, constructorArgs);
        hook = new WaveHook{ salt: salt }(
            manager, address(this), address(longToken), tradingStart, tradingEnd, 60, 0.5e18
        );
        assertEq(address(hook), expectedHook);
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, WAVE_HOOK_FLAGS);

        Currency longCurrency = Currency.wrap(address(longToken));
        Currency shortCurrency = Currency.wrap(address(shortToken));
        key = PoolKey({
            currency0: Currency.unwrap(longCurrency) < Currency.unwrap(shortCurrency) ? longCurrency : shortCurrency,
            currency1: Currency.unwrap(longCurrency) < Currency.unwrap(shortCurrency) ? shortCurrency : longCurrency,
            fee: 3_000,
            tickSpacing: TEST_TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        vm.warp(tradingStart);
        manager.initialize(key, Q96);

        longToken.mint(address(this), 2e18);
        shortToken.mint(address(this), 2e18);
        _modifyLiquidity(TEST_LOWER_TICK, TEST_UPPER_TICK, 1e18);
    }

    function test_LongProbabilityIsBoundedAndComplementary() public {
        assertEq(hook.pLong(key), 0.5e18);
        assertEq(hook.pShort(key), 0.5e18);
        assertEq(hook.finalWindowTwap(), 0.5e18);

        vm.warp(tradingEnd - 30);
        bool zeroForOne = Currency.unwrap(key.currency0) != address(longToken);
        uint160 priceLimit = zeroForOne
            ? TickMath.getSqrtPriceAtTick(TEST_LOWER_TICK) + 1
            : TickMath.getSqrtPriceAtTick(TEST_UPPER_TICK) - 1;
        _swap(zeroForOne, -int256(1e16), priceLimit);

        uint256 pLong = hook.pLong(key);
        uint256 pShort = hook.pShort(key);
        assertGt(pLong, 0.5e18);
        assertGt(pLong, 1e16);
        assertLt(pLong, 99e16);
        assertEq(pLong + pShort, 1e18);

        vm.warp(tradingEnd);
        uint256 expectedTwap = (0.5e18 * 30 + pLong * 30) / 60;
        assertEq(hook.finalWindowTwap(), expectedTwap);
    }

    function test_SwapsAreRejectedOutsideTradingWindow() public {
        vm.warp(tradingEnd);
        vm.expectRevert();
        _swap(true, -int256(1e15), TickMath.getSqrtPriceAtTick(TEST_LOWER_TICK) + 1);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "only pool manager");
        Operation memory operation = abi.decode(data, (Operation));
        if (operation.action == Action.ADD_LIQUIDITY) {
            (BalanceDelta liquidityDelta,) = manager.modifyLiquidity(
                operation.key,
                ModifyLiquidityParams({
                    tickLower: operation.tickLower,
                    tickUpper: operation.tickUpper,
                    liquidityDelta: int256(uint256(operation.liquidity)),
                    salt: bytes32(0)
                }),
                ""
            );
            _settleOrTake(operation.key.currency0, liquidityDelta.amount0());
            _settleOrTake(operation.key.currency1, liquidityDelta.amount1());
            return abi.encode(liquidityDelta);
        }

        BalanceDelta delta = manager.swap(
            operation.key,
            SwapParams({
                zeroForOne: operation.zeroForOne,
                amountSpecified: operation.amountSpecified,
                sqrtPriceLimitX96: operation.sqrtPriceLimitX96
            }),
            ""
        );
        _settleOrTake(operation.key.currency0, delta.amount0());
        _settleOrTake(operation.key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _modifyLiquidity(int24 tickLower, int24 tickUpper, uint128 liquidity) private {
        manager.unlock(
            abi.encode(
                Operation({
                    action: Action.ADD_LIQUIDITY,
                    key: key,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidity: liquidity,
                    zeroForOne: false,
                    amountSpecified: 0,
                    sqrtPriceLimitX96: 0
                })
            )
        );
    }

    function _swap(bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) private {
        manager.unlock(
            abi.encode(
                Operation({
                    action: Action.SWAP,
                    key: key,
                    tickLower: 0,
                    tickUpper: 0,
                    liquidity: 0,
                    zeroForOne: zeroForOne,
                    amountSpecified: amountSpecified,
                    sqrtPriceLimitX96: sqrtPriceLimitX96
                })
            )
        );
    }

    function _settleOrTake(Currency currency, int128 delta) private {
        if (delta < 0) {
            CurrencySettler.settle(currency, manager, address(this), uint256(uint128(-delta)), false);
        } else if (delta > 0) {
            CurrencySettler.take(currency, manager, address(this), uint256(uint128(delta)), false);
        }
    }
}
