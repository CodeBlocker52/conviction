// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { ProposalTokens } from "../src/ProposalTokens.sol";
import { ProposerRegistry } from "../src/ProposerRegistry.sol";
import { QuantumLP } from "../src/QuantumLP.sol";
import { QuantumRound } from "../src/QuantumRound.sol";
import { Resolver } from "../src/Resolver.sol";
import { WavefundVault } from "../src/WavefundVault.sol";
import { WaveV4ProposalMarket } from "../src/WaveV4ProposalMarket.sol";

address constant WIRE_REGISTRY = 0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346;
address constant WIRE_QUANTUM_LP = 0x885512902D1f5d05f81A678FdFFE0e339623c415;
address constant WIRE_OLD_ROUND = 0x82a666Fc211c6A9a2509F941eA974AB0a7dDDb41;
address constant WIRE_OLD_VAULT = 0xe4CEE84aBfaB433E11E0F6C3845901D3Fb58b84D;
address constant WIRE_OLD_RESOLVER = 0xeA89585fb62e6eB63D101409093D88A94A936A4C;
uint256 constant WIRE_SEED_PER_PROPOSAL = 5_000_000;

/// @notice Step 3 of the Phase B cutover: hands the market to the round and wires every role. No USDC moves.
/// @dev Requires the hook to be set already (DeployWaveHook.s.sol) because the round owns the market afterwards.
contract WirePhaseB is Script {
    error WrongChain();
    error HookNotSet();
    error RoleMissing(string name);
    error RoleStillGranted(string name);

    function run() external {
        if (block.chainid != 5_042_002) revert WrongChain();
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address keeper = vm.envAddress("KEEPER_ADDR");
        ProposalTokens tokens = ProposalTokens(vm.envAddress("NEW_PROPOSAL_TOKENS"));
        WaveV4ProposalMarket market = WaveV4ProposalMarket(vm.envAddress("NEW_MARKET"));
        QuantumRound round = QuantumRound(vm.envAddress("NEW_QUANTUM_ROUND"));
        Resolver resolver = Resolver(vm.envAddress("NEW_RESOLVER"));
        WavefundVault vault = WavefundVault(vm.envAddress("NEW_VAULT"));
        ProposerRegistry registry = ProposerRegistry(WIRE_REGISTRY);
        QuantumLP lp = QuantumLP(WIRE_QUANTUM_LP);
        if (address(market.waveHook()) == address(0)) revert HookNotSet();

        bytes32 qrRole = keccak256("QUANTUM_ROUND_ROLE");
        bytes32 keeperRole = keccak256("KEEPER_ROLE");
        bytes32 vaultRole = keccak256("VAULT_ROLE");
        bytes32 resolverRole = keccak256("RESOLVER_ROLE");

        vm.startBroadcast(deployerPk);
        market.transferOwnership(address(round));
        tokens.grantRole(qrRole, address(round));
        registry.grantRole(qrRole, address(round));
        lp.grantRole(qrRole, address(round));
        round.grantRole(keeperRole, keeper);
        round.grantRole(vaultRole, address(vault));
        round.setInitialLiquidityPerProposal(WIRE_SEED_PER_PROPOSAL);
        resolver.grantRole(resolverRole, address(vault));
        vault.grantRole(qrRole, address(round));
        vault.grantRole(keeperRole, keeper);
        registry.revokeRole(qrRole, WIRE_OLD_ROUND);
        lp.revokeRole(qrRole, WIRE_OLD_ROUND);
        QuantumRound(WIRE_OLD_ROUND).revokeRole(vaultRole, WIRE_OLD_VAULT);
        Resolver(WIRE_OLD_RESOLVER).revokeRole(resolverRole, WIRE_OLD_VAULT);
        vm.stopBroadcast();

        if (market.owner() != address(round)) revert RoleMissing("market owner");
        if (!tokens.hasRole(qrRole, address(round))) revert RoleMissing("tokens round");
        if (!registry.hasRole(qrRole, address(round))) revert RoleMissing("registry round");
        if (!lp.hasRole(qrRole, address(round))) revert RoleMissing("lp round");
        if (!round.hasRole(keeperRole, keeper)) revert RoleMissing("round keeper");
        if (!round.hasRole(vaultRole, address(vault))) revert RoleMissing("round vault");
        if (!resolver.hasRole(resolverRole, address(vault))) revert RoleMissing("resolver vault");
        if (!vault.hasRole(qrRole, address(round))) revert RoleMissing("vault round");
        if (!vault.hasRole(keeperRole, keeper)) revert RoleMissing("vault keeper");
        if (registry.hasRole(qrRole, WIRE_OLD_ROUND)) revert RoleStillGranted("registry old round");
        if (lp.hasRole(qrRole, WIRE_OLD_ROUND)) revert RoleStillGranted("lp old round");
        if (QuantumRound(WIRE_OLD_ROUND).hasRole(vaultRole, WIRE_OLD_VAULT)) {
            revert RoleStillGranted("old round vault");
        }
        if (Resolver(WIRE_OLD_RESOLVER).hasRole(resolverRole, WIRE_OLD_VAULT)) {
            revert RoleStillGranted("old resolver vault");
        }
        if (tokens.creditDecimals() != 6) revert RoleMissing("credit decimals");

        console2.log("Phase B wiring complete and verified.");
    }
}
