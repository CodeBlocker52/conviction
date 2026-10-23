// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ProposalTokens } from "../src/ProposalTokens.sol";
import { ProposerRegistry } from "../src/ProposerRegistry.sol";
import { ConstantProductMarket } from "../src/ConstantProductMarket.sol";
import { QuantumRound } from "../src/QuantumRound.sol";
import { Resolver } from "../src/Resolver.sol";
import { QuantumLP } from "../src/QuantumLP.sol";
import { WavefundVault } from "../src/WavefundVault.sol";
import { MockPriceOracle } from "../src/MockPriceOracle.sol";

address constant DEPLOY_USDC = 0x3600000000000000000000000000000000000000;
address constant DEPLOY_POOL_MANAGER = 0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A;

/// @notice Deploys the price-control upgrade while reusing only contracts without old-round references.
/// @dev Requires DEPLOYER_PK, KEEPER_ADDR, EXISTING_TEST_ASSET, EXISTING_PROPOSAL_TOKENS,
///      EXISTING_PROPOSER_REGISTRY, LEGACY_QUANTUM_LP, LEGACY_QUANTUM_ROUND, LEGACY_RESOLVER.
contract Deploy is Script {
    error LegacyRoundHasOpenOrHistoricalRounds();
    error LegacyLPHasFunds();
    error LegacyRoundAdminMismatch();
    error InsufficientSeedBudget();

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPk);
        address keeper = vm.envAddress("KEEPER_ADDR");
        address tEth = vm.envAddress("EXISTING_TEST_ASSET");
        ProposalTokens proposalTokens = ProposalTokens(vm.envAddress("EXISTING_PROPOSAL_TOKENS"));
        ProposerRegistry registry = ProposerRegistry(vm.envAddress("EXISTING_PROPOSER_REGISTRY"));
        QuantumLP legacyLp = QuantumLP(vm.envAddress("LEGACY_QUANTUM_LP"));
        QuantumRound legacyRound = QuantumRound(vm.envAddress("LEGACY_QUANTUM_ROUND"));
        Resolver legacyResolver = Resolver(vm.envAddress("LEGACY_RESOLVER"));

        if (legacyRound.roundCount() != 0) revert LegacyRoundHasOpenOrHistoricalRounds();
        if (legacyLp.totalLP() != 0 || IERC20(DEPLOY_USDC).balanceOf(address(legacyLp)) != 0) {
            revert LegacyLPHasFunds();
        }
        if (!legacyRound.hasRole(bytes32(0), deployer)) revert LegacyRoundAdminMismatch();

        uint256 availableUsdc = IERC20(DEPLOY_USDC).balanceOf(deployer);
        uint256 seedBudget = (availableUsdc * 8_500) / 10_000;

        vm.startBroadcast(deployerPk);

        ConstantProductMarket market = new ConstantProductMarket(30, deployer);
        QuantumRound qr = new QuantumRound(
            address(proposalTokens), address(market), address(registry), deployer, deployer, deployer
        );
        uint256 liquidityPerProposal = seedBudget / qr.MAX_PROPOSALS_PER_ROUND();
        if (liquidityPerProposal == 0) revert InsufficientSeedBudget();
        uint256 actualSeedBudget = liquidityPerProposal * qr.MAX_PROPOSALS_PER_ROUND();

        Resolver resolver = new Resolver(address(qr), deployer);
        qr.setResolver(address(resolver));
        market.transferOwnership(address(qr));
        QuantumLP lp = new QuantumLP(deployer);
        MockPriceOracle priceOracle = new MockPriceOracle(deployer, keeper);
        WavefundVault vault = new WavefundVault(
            DEPLOY_POOL_MANAGER, tEth, address(resolver), address(qr), address(priceOracle), 500, deployer
        );

        bytes32 qrRole = keccak256("QUANTUM_ROUND_ROLE");
        bytes32 keeperRole = keccak256("KEEPER_ROLE");
        bytes32 resolverRole = keccak256("RESOLVER_ROLE");
        bytes32 vaultRole = keccak256("VAULT_ROLE");
        bytes32 defaultAdminRole = bytes32(0);

        if (proposalTokens.hasRole(qrRole, address(legacyRound))) {
            proposalTokens.revokeRole(qrRole, address(legacyRound));
        }
        if (registry.hasRole(qrRole, address(legacyRound))) {
            registry.revokeRole(qrRole, address(legacyRound));
        }
        if (legacyLp.hasRole(qrRole, address(legacyRound))) {
            legacyLp.revokeRole(qrRole, address(legacyRound));
        }
        if (legacyResolver.hasRole(keccak256("RESOLVER_ROLE"), keeper)) {
            legacyResolver.revokeRole(keccak256("RESOLVER_ROLE"), keeper);
        }
        if (legacyResolver.hasRole(keccak256("RESOLVER_ROLE"), deployer)) {
            legacyResolver.revokeRole(keccak256("RESOLVER_ROLE"), deployer);
        }
        if (legacyRound.hasRole(keeperRole, deployer)) legacyRound.revokeRole(keeperRole, deployer);
        if (legacyRound.hasRole(keeperRole, keeper)) legacyRound.revokeRole(keeperRole, keeper);
        legacyRound.renounceRole(defaultAdminRole, deployer);

        proposalTokens.grantRole(qrRole, address(qr));
        registry.grantRole(qrRole, address(qr));
        lp.grantRole(qrRole, address(qr));
        qr.grantRole(keeperRole, keeper);
        qr.grantRole(vaultRole, address(vault));
        qr.setInitialLiquidityPerProposal(liquidityPerProposal);

        resolver.grantRole(resolverRole, address(vault));
        vault.grantRole(vault.QUANTUM_ROUND_ROLE(), address(qr));
        vault.grantRole(keeperRole, keeper);

        vm.stopBroadcast();

        console2.log("Deployer:", deployer);
        console2.log("Keeper:", keeper);
        console2.log("Available USDC:", availableUsdc);
        console2.log("USDC budgeted to seed 10 proposals:", actualSeedBudget);
        console2.log("USDC retained for fees and follow-up transactions:", availableUsdc - actualSeedBudget);
        console2.log("\n=== PRICE-CONTROL UPGRADE ===");
        console2.log("TestAsset (reused):", tEth);
        console2.log("ProposalTokens (reused):", address(proposalTokens));
        console2.log("ProposerRegistry (reused):", address(registry));
        console2.log("QuantumLP (new):", address(lp));
        console2.log("ConstantProductMarket (new):", address(market));
        console2.log("QuantumRound (new):", address(qr));
        console2.log("Resolver (new):", address(resolver));
        console2.log("WavefundVault (new):", address(vault));
        console2.log("MockPriceOracle (new):", address(priceOracle));
    }
}
