// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { ProposalTokens } from "../src/ProposalTokens.sol";
import { ProposerRegistry } from "../src/ProposerRegistry.sol";
import { QuantumRound } from "../src/QuantumRound.sol";
import { Resolver } from "../src/Resolver.sol";
import { WavefundVault } from "../src/WavefundVault.sol";
import { IQuantumRoundTiming, WaveV4ProposalMarket } from "../src/WaveV4ProposalMarket.sol";

address constant PHASE_B_POOL_MANAGER = 0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A;
address constant PHASE_B_TEST_ASSET = 0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d;
address constant PHASE_B_REGISTRY = 0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346;
address constant PHASE_B_ORACLE = 0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d;
uint256 constant PHASE_B_CHAIN_ID = 5_042_002;

/// @notice Step 1 of the Phase B cutover: deploys the new contracts. Moves no USDC, so forge simulation works.
/// @dev Step 2 is DeployWaveHook.s.sol (needs WAVE_V4_MARKET); step 3 is WirePhaseB.s.sol.
contract DeployPhaseB is Script {
    error WrongChain();

    function run() external {
        if (block.chainid != PHASE_B_CHAIN_ID) revert WrongChain();
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPk);

        vm.startBroadcast(deployerPk);

        // Credit decimals are locked after the first clone, so set them before anything else uses the factory.
        ProposalTokens tokens = new ProposalTokens(deployer);
        tokens.setCreditDecimals(6);

        WaveV4ProposalMarket market = new WaveV4ProposalMarket(IPoolManager(PHASE_B_POOL_MANAGER), tokens, deployer);
        QuantumRound round =
            new QuantumRound(address(tokens), address(market), PHASE_B_REGISTRY, deployer, deployer, deployer);
        Resolver resolver = new Resolver(address(round), deployer);
        round.setResolver(address(resolver));
        market.setQuantumRound(IQuantumRoundTiming(address(round)));
        WavefundVault vault = new WavefundVault(
            PHASE_B_POOL_MANAGER, PHASE_B_TEST_ASSET, address(resolver), address(round), PHASE_B_ORACLE, 500, deployer
        );

        vm.stopBroadcast();

        console2.log("ProposalTokens (new):", address(tokens));
        console2.log("WaveV4ProposalMarket (new):", address(market));
        console2.log("QuantumRound (new):", address(round));
        console2.log("Resolver (new):", address(resolver));
        console2.log("WavefundVault (new):", address(vault));
        console2.log("Next: WAVE_V4_MARKET=<market> forge script DeployWaveHook, then WirePhaseB.");
    }
}
