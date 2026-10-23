// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// PoolManager addresses on Arc testnet (RC2) sourced from Peach testnet docs
// Verified: PositionManager(0x87Dd...).poolManager() == 0x2756... on-chain
address constant POOL_MANAGER = 0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A;
address constant USDC = 0x3600000000000000000000000000000000000000;

/// @title V4SmokeTest
/// @notice Creates a no-hook USDC/tETH pool on Arc testnet, adds liquidity via PoolManager unlock,
///         then swaps. Records which PoolManager address works and the result.
/// @dev Run with: forge script contracts/script/V4SmokeTest.s.sol --rpc-url https://rpc.testnet.arc.io --broadcast
contract V4SmokeTest is Script {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    IPoolManager public poolManager = IPoolManager(POOL_MANAGER);

    /// @dev Minimal callback contract that handles IPoolManager.unlock() callbacks inline.
    /// The script cannot itself be the callback target since it runs in a forge broadcast context.
    TestCallback public callback;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);

        console2.log("=== V4 Smoke Test on Arc Testnet ===");
        console2.log("PoolManager:", POOL_MANAGER);
        console2.log("Deployer:", deployer);
        console2.log("USDC balance:", IERC20(USDC).balanceOf(deployer));

        vm.startBroadcast(pk);

        // 1. Deploy a test tETH token for the smoke test
        MockERC20 tEth = new MockERC20("tETH", "tETH", 18);
        tEth.mint(deployer, 1000 ether);
        console2.log("tETH deployed:", address(tEth));

        // 2. Deploy callback helper
        callback = new TestCallback(POOL_MANAGER, USDC, address(tEth));

        // 3. Sort tokens (currency0 < currency1 numerically)
        (address token0, address token1) = address(tEth) < USDC
            ? (address(tEth), USDC)
            : (USDC, address(tEth));

        console2.log("token0:", token0, "token1:", token1);

        // 4. Build pool key — no hook, 0.3% fee, tickSpacing 60
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        PoolId poolId = key.toId();
        console2.log("PoolId:");
        console2.logBytes32(PoolId.unwrap(poolId));

        // 5. Initialize pool at sqrtPriceX96 corresponding to 1 USDC = 1 tETH
        // sqrtPrice = sqrt(1) * 2^96 = 2^96
        uint160 sqrtPriceX96 = 79228162514264337593543950336; // 2^96 exactly
        try poolManager.initialize(key, sqrtPriceX96) returns (int24 tick) {
            console2.log("Pool initialized at tick:", tick);
        } catch (bytes memory err) {
            console2.log("initialize() reverted (pool may already exist)");
            console2.logBytes(err);
        }

        // 6. Add liquidity via unlock callback
        uint256 usdcAmount = 1000e6; // 1000 USDC
        uint256 tEthAmount = 1000 ether; // 1000 tETH

        IERC20(USDC).approve(address(callback), usdcAmount * 2);
        tEth.approve(address(callback), tEthAmount * 2);

        bytes memory addLiqData = abi.encode(
            TestCallback.Action.ADD_LIQUIDITY,
            key,
            deployer,
            int24(-887220), // lower tick (near min)
            int24(887220),  // upper tick (near max)
            int256(1e18),   // liquidityDelta
            usdcAmount,
            tEthAmount
        );

        try callback.execute(addLiqData) returns (bytes memory result) {
            console2.log("Add liquidity: SUCCESS");
            (int128 delta0, int128 delta1) = abi.decode(result, (int128, int128));
            console2.log("  delta0:"); console2.logInt(int256(delta0));
            console2.log("  delta1:"); console2.logInt(int256(delta1));
        } catch (bytes memory err) {
            console2.log("Add liquidity: FAILED");
            console2.logBytes(err);
        }

        // 7. Swap: sell 100 USDC for tETH
        uint256 swapIn = 100e6; // 100 USDC
        IERC20(USDC).approve(address(callback), swapIn);

        bool zeroForOne = address(USDC) == token0;
        bytes memory swapData = abi.encode(
            TestCallback.Action.SWAP,
            key,
            deployer,
            zeroForOne,
            int256(swapIn), // negative = exactIn
            zeroForOne
                ? uint160(4295128740) // MIN_SQRT_PRICE + 1
                : uint160(1461446703485210103287273052203988822378723970341) // MAX_SQRT_PRICE - 1
        );

        try callback.execute(swapData) returns (bytes memory result) {
            console2.log("Swap 100 USDC -> tETH: SUCCESS");
            (int128 delta0, int128 delta1) = abi.decode(result, (int128, int128));
            console2.log("  delta0:"); console2.logInt(int256(delta0));
            console2.log("  delta1:"); console2.logInt(int256(delta1));
        } catch (bytes memory err) {
            console2.log("Swap: FAILED");
            console2.logBytes(err);
        }

        vm.stopBroadcast();
        console2.log("=== Smoke test complete. Record PoolManager address and results in SOURCES.md ===");
    }
}

/// @dev ERC-20 mock for smoke test only
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(string memory _name, string memory _sym, uint8 _dec) {
        name = _name; symbol = _sym; decimals = _dec;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount; totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount; balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @dev Callback contract that wraps PoolManager.unlock() for the smoke test.
/// PoolManager.unlock() calls back into unlockCallback(bytes) on this contract.
contract TestCallback {
    using SafeERC20 for IERC20;

    enum Action { ADD_LIQUIDITY, SWAP }

    IPoolManager public immutable pm;
    address public immutable usdc;
    address public immutable tEth;

    bytes private _pendingData;

    constructor(address pm_, address usdc_, address tEth_) {
        pm = IPoolManager(pm_);
        usdc = usdc_;
        tEth = tEth_;
    }

    function execute(bytes calldata data) external returns (bytes memory result) {
        _pendingData = data;
        result = pm.unlock(data);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "only PM");
        (Action action) = abi.decode(data[:32], (Action));

        if (action == Action.ADD_LIQUIDITY) {
            return _addLiquidity(data);
        } else if (action == Action.SWAP) {
            return _swap(data);
        }
        revert("unknown action");
    }

    function _addLiquidity(bytes calldata data) internal returns (bytes memory) {
        (
            ,  // action
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
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: liquidityDelta,
                salt: bytes32(0)
            }),
            ""
        );

        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();

        // Settle: positive delta means we owe tokens to the pool
        if (d0 < 0) {
            address token0 = Currency.unwrap(key.currency0);
            uint256 amt = uint256(uint128(-d0));
            IERC20(token0).safeTransferFrom(sender, address(pm), amt);
            pm.settle();
        }
        if (d1 < 0) {
            address token1 = Currency.unwrap(key.currency1);
            uint256 amt = uint256(uint128(-d1));
            IERC20(token1).safeTransferFrom(sender, address(pm), amt);
            pm.settle();
        }

        return abi.encode(d0, d1);
    }

    function _swap(bytes calldata data) internal returns (bytes memory) {
        (
            ,  // action
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
}
