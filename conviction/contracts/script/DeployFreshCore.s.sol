// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { MockPriceOracle } from "../src/MockPriceOracle.sol";
import { ProposalTokens } from "../src/ProposalTokens.sol";
import { ProposerRegistry } from "../src/ProposerRegistry.sol";
import { QuantumRound } from "../src/QuantumRound.sol";
import { Resolver } from "../src/Resolver.sol";
import { TestAsset } from "../src/TestAsset.sol";
import { WavefundVault } from "../src/WavefundVault.sol";
import { IQuantumRoundTiming, WaveV4ProposalMarket } from "../src/WaveV4ProposalMarket.sol";

address constant FRESH_POOL_MANAGER = 0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A;
address constant FRESH_USDC = 0x3600000000000000000000000000000000000000;
uint256 constant FRESH_CHAIN_ID = 5_042_002;

contract DeployFreshCore is Script {
    error WrongChain();

    function run() external {
        if (block.chainid != FRESH_CHAIN_ID) revert WrongChain();

        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPk);
        address keeper = vm.envAddress("KEEPER_ADDR");

        vm.startBroadcast(deployerPk);

        TestAsset testAsset = new TestAsset(deployer);
        MockPriceOracle oracle = new MockPriceOracle(deployer, keeper);
        ProposerRegistry registry = new ProposerRegistry(FRESH_USDC, deployer);
        ProposalTokens tokens = new ProposalTokens(deployer);
        tokens.setCreditDecimals(6);

        WaveV4ProposalMarket market =
            new WaveV4ProposalMarket(IPoolManager(FRESH_POOL_MANAGER), tokens, deployer);
        QuantumRound round =
            new QuantumRound(address(tokens), address(market), address(registry), deployer, deployer, deployer);
        Resolver resolver = new Resolver(address(round), deployer);
        round.setResolver(address(resolver));
        market.setQuantumRound(IQuantumRoundTiming(address(round)));
        WavefundVault vault = new WavefundVault(
            FRESH_POOL_MANAGER, address(testAsset), address(resolver), address(round), address(oracle), 500, deployer
        );
        testAsset.mint(deployer, 1 ether);

        vm.stopBroadcast();

        console2.log("TestAsset:", address(testAsset));
        console2.log("MockPriceOracle:", address(oracle));
        console2.log("ProposerRegistry:", address(registry));
        console2.log("ProposalTokens:", address(tokens));
        console2.log("WaveV4ProposalMarket:", address(market));
        console2.log("QuantumRound:", address(round));
        console2.log("Resolver:", address(resolver));
        console2.log("WavefundVault:", address(vault));
        console2.log("Minted 1 tETH to the deployer for the new pool.");
    }
}
