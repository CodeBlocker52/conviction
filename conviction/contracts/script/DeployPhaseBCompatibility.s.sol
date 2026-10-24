// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { PhaseBCompatibilityAdapter } from "../src/PhaseBCompatibility.sol";
import { WaveHook } from "../src/WaveHook.sol";

address constant ARC_TESTNET_POOL_MANAGER = 0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A;
address constant EXPECTED_DEPLOYER = 0xDA026fbF1F9a98632F52AA23F92c0041d6Ef3ac2;
address constant FOUNDRY_CREATE2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
uint256 constant ARC_TESTNET_CHAIN_ID = 5_042_002;
uint160 constant WAVE_HOOK_FLAGS = uint160(
    Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
        | Hooks.AFTER_SWAP_FLAG
);

contract DeployPhaseBCompatibility is Script {
    function run() external {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) revert("wrong chain");

        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPk);
        if (deployer != EXPECTED_DEPLOYER) revert("unexpected deployer");

        uint64 tradingStart = uint64(block.timestamp);
        uint64 tradingEnd = tradingStart + 3_600;

        vm.startBroadcast(deployerPk);
        PhaseBCompatibilityAdapter adapter =
            new PhaseBCompatibilityAdapter(IPoolManager(ARC_TESTNET_POOL_MANAGER), deployer);
        address longToken = address(adapter.longToken());
        bytes memory constructorArgs = abi.encode(
            IPoolManager(ARC_TESTNET_POOL_MANAGER),
            address(adapter),
            longToken,
            tradingStart,
            tradingEnd,
            uint64(300),
            uint256(0.5e18)
        );
        (address expectedHook, bytes32 salt) =
            HookMiner.find(FOUNDRY_CREATE2_FACTORY, WAVE_HOOK_FLAGS, type(WaveHook).creationCode, constructorArgs);
        WaveHook hook = new WaveHook{ salt: salt }(
            IPoolManager(ARC_TESTNET_POOL_MANAGER), address(adapter), longToken, tradingStart, tradingEnd, 300, 0.5e18
        );
        require(address(hook) == expectedHook, "hook mining mismatch");
        adapter.configure(hook);
        adapter.initializeAndAddLiquidity();
        (uint256 probabilityBefore, uint256 probabilityAfter) = adapter.compatibilitySwap();
        require(probabilityBefore == 0.5e18, "unexpected initial probability");
        require(probabilityAfter > probabilityBefore && probabilityAfter < 99e16, "swap did not move bounded price");
        require(probabilityAfter + hook.pShort(adapter.poolKey()) == 1e18, "probability complement mismatch");
        vm.stopBroadcast();

        console2.log("Compatibility adapter:", address(adapter));
        console2.log("Test LONG token:", longToken);
        console2.log("Test SHORT token:", address(adapter.shortToken()));
        console2.log("WaveHook:", address(hook));
        console2.log("Hook flags:", uint256(uint160(address(hook)) & Hooks.ALL_HOOK_MASK));
        console2.log("pLong before:", probabilityBefore);
        console2.log("pLong after:", probabilityAfter);
    }
}
