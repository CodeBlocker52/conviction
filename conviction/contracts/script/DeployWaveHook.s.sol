// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { WaveHook } from "../src/WaveHook.sol";

address constant DEPLOY_WAVE_HOOK_POOL_MANAGER = 0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A;
address constant DEPLOY_WAVE_HOOK_CREATE2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
uint256 constant DEPLOY_WAVE_HOOK_CHAIN_ID = 5_042_002;
uint160 constant DEPLOY_WAVE_HOOK_FLAGS = uint160(
    Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
        | Hooks.AFTER_SWAP_FLAG
);

interface IWaveHookMarket {
    function owner() external view returns (address);
    function setWaveHook(WaveHook hook) external;
}

contract DeployWaveHook is Script {
    error WrongChain();
    error MarketOwnerMismatch();
    error HookAddressMismatch();

    function run() external {
        if (block.chainid != DEPLOY_WAVE_HOOK_CHAIN_ID) revert WrongChain();

        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPk);
        IWaveHookMarket market = IWaveHookMarket(vm.envAddress("WAVE_V4_MARKET"));
        if (market.owner() != deployer) revert MarketOwnerMismatch();

        IPoolManager poolManager = IPoolManager(DEPLOY_WAVE_HOOK_POOL_MANAGER);
        bytes memory constructorArgs = abi.encode(poolManager, address(market));
        (address expectedHook, bytes32 salt) = HookMiner.find(
            DEPLOY_WAVE_HOOK_CREATE2_FACTORY, DEPLOY_WAVE_HOOK_FLAGS, type(WaveHook).creationCode, constructorArgs
        );

        vm.startBroadcast(deployerPk);
        WaveHook hook = new WaveHook{ salt: salt }(poolManager, address(market));
        if (address(hook) != expectedHook) revert HookAddressMismatch();
        market.setWaveHook(hook);
        vm.stopBroadcast();

        console2.log("WaveHook:", address(hook));
        console2.log("Hook salt:", uint256(salt));
        console2.log("Record this WaveHook address in the approved Phase B deployment config.");
    }
}
