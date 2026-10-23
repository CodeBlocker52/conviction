// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { SwapParams, ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

address constant POOL_MANAGER = 0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A;
address constant USDC = 0x3600000000000000000000000000000000000000;
address constant TETH = 0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d;

/// @title V4SmokeTest
/// @notice Deploys the owner-restricted callback used by the viem-based Arc v4 smoke test.
/// @dev This script only deploys code; all USDC-moving pool operations use the real RPC via viem.
contract V4SmokeTest is Script {
    IPoolManager public poolManager = IPoolManager(POOL_MANAGER);
    TestCallback public callback;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);
        callback = new TestCallback(POOL_MANAGER, USDC, TETH, deployer);
        vm.stopBroadcast();
        console2.log("V4 smoke callback:", address(callback));
    }
}

/// @dev Callback contract that wraps PoolManager.unlock() for the smoke test.
/// PoolManager.unlock() calls back into unlockCallback(bytes) on this contract.
contract TestCallback {
    using SafeERC20 for IERC20;

    enum Action {
        ADD_LIQUIDITY,
        SWAP,
        REMOVE_LIQUIDITY
    }

    IPoolManager public immutable pm;
    address public immutable usdc;
    address public immutable tEth;
    address public immutable owner;

    error NotOwner();
    error ZeroAddress();

    constructor(address pm_, address usdc_, address tEth_, address owner_) {
        if (pm_ == address(0) || usdc_ == address(0) || tEth_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        pm = IPoolManager(pm_);
        usdc = usdc_;
        tEth = tEth_;
        owner = owner_;
    }

    function execute(bytes calldata data) external returns (bytes memory result) {
        if (msg.sender != owner) revert NotOwner();
        result = pm.unlock(data);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "only PM");
        (Action action) = abi.decode(data[:32], (Action));

        if (action == Action.ADD_LIQUIDITY) {
            return _addLiquidity(data);
        } else if (action == Action.SWAP) {
            return _swap(data);
        } else if (action == Action.REMOVE_LIQUIDITY) {
            return _removeLiquidity(data);
        }
        revert("unknown action");
    }

    function _addLiquidity(bytes calldata data) internal returns (bytes memory) {
        (, // action
            PoolKey memory key,
            address sender,
            int24 tickLower,
            int24 tickUpper,
            int256 liquidityDelta,
            uint256 maxAmount0,
            uint256 maxAmount1
        ) = abi.decode(data, (Action, PoolKey, address, int24, int24, int256, uint256, uint256));

        (BalanceDelta delta,) = pm.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: liquidityDelta, salt: bytes32(0)
            }),
            ""
        );

        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();

        // Settle: positive delta means we owe tokens to the pool
        if (d0 < 0) {
            address token0 = Currency.unwrap(key.currency0);
            uint256 amt = uint256(uint128(-d0));
            require(amt <= maxAmount0, "max amount0 exceeded");
            pm.sync(key.currency0);
            IERC20(token0).safeTransferFrom(sender, address(pm), amt);
            pm.settle();
        }
        if (d1 < 0) {
            address token1 = Currency.unwrap(key.currency1);
            uint256 amt = uint256(uint128(-d1));
            require(amt <= maxAmount1, "max amount1 exceeded");
            pm.sync(key.currency1);
            IERC20(token1).safeTransferFrom(sender, address(pm), amt);
            pm.settle();
        }

        return abi.encode(d0, d1);
    }

    function _swap(bytes calldata data) internal returns (bytes memory) {
        (, // action
            PoolKey memory key,
            address sender,
            bool zeroForOne,
            int256 amountSpecified,
            uint160 sqrtPriceLimitX96
        ) = abi.decode(data, (Action, PoolKey, address, bool, int256, uint160));

        BalanceDelta delta = pm.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -amountSpecified, // negative = exactIn
                sqrtPriceLimitX96: sqrtPriceLimitX96
            }),
            ""
        );

        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();

        // Pay input token
        address tokenIn = zeroForOne ? Currency.unwrap(key.currency0) : Currency.unwrap(key.currency1);
        int128 amtIn = zeroForOne ? d0 : d1;
        if (amtIn < 0) {
            pm.sync(Currency.wrap(tokenIn));
            IERC20(tokenIn).safeTransferFrom(sender, address(pm), uint256(uint128(-amtIn)));
            pm.settle();
        }

        // Take output token
        address tokenOut = zeroForOne ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0);
        int128 amtOut = zeroForOne ? d1 : d0;
        if (amtOut > 0) {
            pm.take(Currency.wrap(tokenOut), sender, uint256(uint128(amtOut)));
        }

        return abi.encode(d0, d1);
    }

    function _removeLiquidity(bytes calldata data) internal returns (bytes memory) {
        (, PoolKey memory key, address recipient, int24 tickLower, int24 tickUpper, uint128 liquidity) =
            abi.decode(data, (Action, PoolKey, address, int24, int24, uint128));

        (BalanceDelta delta,) = pm.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: -int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            ""
        );

        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 > 0) pm.take(key.currency0, recipient, uint256(uint128(d0)));
        if (d1 > 0) pm.take(key.currency1, recipient, uint256(uint128(d1)));

        return abi.encode(d0, d1);
    }
}
