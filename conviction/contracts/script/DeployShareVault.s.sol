// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";

import { QuantumRound } from "../src/QuantumRound.sol";
import { Resolver } from "../src/Resolver.sol";
import { WavefundVault } from "../src/WavefundVault.sol";

address constant SHARE_VAULT_POOL_MANAGER = 0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A;
address constant SHARE_VAULT_TETH = 0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d;
address constant SHARE_VAULT_RESOLVER = 0xeA89585fb62e6eB63D101409093D88A94A936A4C;
address constant SHARE_VAULT_QUANTUM_ROUND = 0x82a666Fc211c6A9a2509F941eA974AB0a7dDDb41;
address constant SHARE_VAULT_ORACLE = 0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d;
address constant LEGACY_SHARE_VAULT = 0x65648366C96Af7b3c2ECdC1B78A06d975A1505F3;
address constant EXPECTED_DEPLOYER = 0xDA026fbF1F9a98632F52AA23F92c0041d6Ef3ac2;
address constant EXPECTED_KEEPER = 0xE7DD9a5fafa5739B466C61914311e39717f7192c;

contract DeployShareVault is Script {
    error WrongChain();
    error WrongDeployer();
    error ExistingRounds();
    error MissingAdminRole();
    error LegacyVaultNotAuthorized();

    function run() external {
        if (block.chainid != 5_042_002) revert WrongChain();

        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPk);
        address keeper = vm.envAddress("KEEPER_ADDR");
        if (deployer != EXPECTED_DEPLOYER) revert WrongDeployer();
        if (keeper != EXPECTED_KEEPER) revert WrongDeployer();

        QuantumRound quantumRound = QuantumRound(SHARE_VAULT_QUANTUM_ROUND);
        Resolver resolver = Resolver(SHARE_VAULT_RESOLVER);
        bytes32 adminRole = bytes32(0);
        bytes32 vaultRole = quantumRound.VAULT_ROLE();
        bytes32 resolverRole = resolver.RESOLVER_ROLE();
        bytes32 keeperRole = keccak256("KEEPER_ROLE");

        if (quantumRound.roundCount() != 0) revert ExistingRounds();
        if (!quantumRound.hasRole(adminRole, deployer) || !resolver.hasRole(adminRole, deployer)) {
            revert MissingAdminRole();
        }
        if (!quantumRound.hasRole(vaultRole, LEGACY_SHARE_VAULT)) revert LegacyVaultNotAuthorized();

        vm.startBroadcast(deployerPk);

        WavefundVault vault = new WavefundVault(
            SHARE_VAULT_POOL_MANAGER,
            SHARE_VAULT_TETH,
            SHARE_VAULT_RESOLVER,
            SHARE_VAULT_QUANTUM_ROUND,
            SHARE_VAULT_ORACLE,
            500,
            deployer
        );

        vault.grantRole(vault.QUANTUM_ROUND_ROLE(), SHARE_VAULT_QUANTUM_ROUND);
        vault.grantRole(keeperRole, keeper);
        resolver.grantRole(resolverRole, address(vault));
        quantumRound.grantRole(vaultRole, address(vault));

        resolver.revokeRole(resolverRole, LEGACY_SHARE_VAULT);
        quantumRound.revokeRole(vaultRole, LEGACY_SHARE_VAULT);

        vm.stopBroadcast();

        console2.log("New share vault:", address(vault));
        console2.log("QuantumRound:", SHARE_VAULT_QUANTUM_ROUND);
        console2.log("Legacy vault superseded:", LEGACY_SHARE_VAULT);
    }
}
