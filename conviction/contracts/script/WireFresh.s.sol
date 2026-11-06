// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { ProposalTokens } from "../src/ProposalTokens.sol";
import { ProposerRegistry } from "../src/ProposerRegistry.sol";
import { QuantumRound } from "../src/QuantumRound.sol";
import { Resolver } from "../src/Resolver.sol";
import { WavefundVault } from "../src/WavefundVault.sol";
import { WaveV4ProposalMarket } from "../src/WaveV4ProposalMarket.sol";

contract WireFresh is Script {
    error WrongChain();
    error HookNotSet();
    error WiringCheckFailed(string name);

    function run() external {
        if (block.chainid != 5_042_002) revert WrongChain();

        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address keeper = vm.envAddress("KEEPER_ADDR");
        ProposalTokens tokens = ProposalTokens(vm.envAddress("NEW_PROPOSAL_TOKENS"));
        ProposerRegistry registry = ProposerRegistry(vm.envAddress("NEW_PROPOSER_REGISTRY"));
        WaveV4ProposalMarket market = WaveV4ProposalMarket(vm.envAddress("NEW_MARKET"));
        QuantumRound round = QuantumRound(vm.envAddress("NEW_QUANTUM_ROUND"));
        Resolver resolver = Resolver(vm.envAddress("NEW_RESOLVER"));
        WavefundVault vault = WavefundVault(vm.envAddress("NEW_VAULT"));

        if (address(market.waveHook()) == address(0)) revert HookNotSet();

        bytes32 qrRole = keccak256("QUANTUM_ROUND_ROLE");
        bytes32 keeperRole = keccak256("KEEPER_ROLE");
        bytes32 vaultRole = keccak256("VAULT_ROLE");
        bytes32 resolverRole = keccak256("RESOLVER_ROLE");

        vm.startBroadcast(deployerPk);
        market.transferOwnership(address(round));
        tokens.grantRole(qrRole, address(round));
        registry.grantRole(qrRole, address(round));
        round.grantRole(keeperRole, keeper);
        round.grantRole(vaultRole, address(vault));
        round.setInitialLiquidityPerProposal(5_000_000);
        round.setAllocationSource(address(vault));
        resolver.grantRole(resolverRole, address(vault));
        vault.grantRole(qrRole, address(round));
        vault.grantRole(keeperRole, keeper);
        vm.stopBroadcast();

        if (market.owner() != address(round)) revert WiringCheckFailed("market owner");
        if (!tokens.hasRole(qrRole, address(round))) revert WiringCheckFailed("proposal tokens round role");
        if (!registry.hasRole(qrRole, address(round))) revert WiringCheckFailed("registry round role");
        if (!round.hasRole(keeperRole, keeper)) revert WiringCheckFailed("round keeper role");
        if (!round.hasRole(vaultRole, address(vault))) revert WiringCheckFailed("round vault role");
        if (address(round.allocationSource()) != address(vault)) revert WiringCheckFailed("allocation source");
        if (!resolver.hasRole(resolverRole, address(vault))) revert WiringCheckFailed("resolver vault role");
        if (!vault.hasRole(qrRole, address(round))) revert WiringCheckFailed("vault round role");
        if (!vault.hasRole(keeperRole, keeper)) revert WiringCheckFailed("vault keeper role");
        if (tokens.creditDecimals() != 6) revert WiringCheckFailed("credit decimals");

        console2.log("Fresh deployment roles and wiring verified.");
    }
}
