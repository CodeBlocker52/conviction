// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {TestAsset} from "../src/TestAsset.sol";
import {ProposalTokens} from "../src/ProposalTokens.sol";
import {ProposerRegistry} from "../src/ProposerRegistry.sol";
import {ConstantProductMarket} from "../src/ConstantProductMarket.sol";
import {QuantumRound} from "../src/QuantumRound.sol";
import {Resolver} from "../src/Resolver.sol";
import {QuantumLP} from "../src/QuantumLP.sol";
import {WavefundVault} from "../src/WavefundVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Deployer constants
address constant USDC = 0x3600000000000000000000000000000000000000;
address constant POOL_MANAGER = 0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A;

/// @title Deploy
/// @notice Deploys all Phase A Wavefund contracts to Arc testnet.
/// Requires: DEPLOYER_PK, KEEPER_ADDR env vars
contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPk);
        address keeper = vm.envAddress("KEEPER_ADDR");

        console2.log("Deployer:", deployer);
        console2.log("Keeper:", keeper);
        console2.log("USDC balance:", IERC20(USDC).balanceOf(deployer));

        vm.startBroadcast(deployerPk);

        // 1. TestAsset (tETH mock)
        TestAsset tEth = new TestAsset(deployer);
        console2.log("TestAsset (tETH):", address(tEth));

        // 2. ProposalTokens factory
        ProposalTokens proposalTokens = new ProposalTokens(deployer);
        console2.log("ProposalTokens:", address(proposalTokens));

        // 3. ProposerRegistry
        ProposerRegistry registry = new ProposerRegistry(USDC, deployer);
        console2.log("ProposerRegistry:", address(registry));

        // 4. ConstantProductMarket (0.3% fee = 30 bps)
        // Owner will be QuantumRound — deploy with deployer first, transfer after
        ConstantProductMarket market = new ConstantProductMarket(30, deployer);
        console2.log("ConstantProductMarket:", address(market));

        // 5. Resolver — needs QuantumRound address; use address(0) as placeholder,
        //    then we deploy QR and set resolver on QR after
        //    Actually: deploy a temporary Resolver pointing to a placeholder; we'll
        //    redeploy with the real QR address after. Better: deploy QR with
        //    deployer as resolver placeholder, then deploy real Resolver and set it.
        //    Use a 2-step: deploy QR with deployer as temp resolver, then deploy
        //    real Resolver, then call qr.setResolver(resolver).

        // 5a. Deploy QuantumRound with deployer as temp resolver
        QuantumRound qr = new QuantumRound(
            address(proposalTokens),
            address(market),
            address(registry),
            deployer,       // initialAdmin
            deployer,       // treasury
            deployer        // resolver placeholder (updated below)
        );
        console2.log("QuantumRound:", address(qr));

        // 5b. Deploy real Resolver pointing to QR
        Resolver resolver = new Resolver(address(qr), deployer);
        console2.log("Resolver:", address(resolver));

        // 5c. Update QR resolver to real Resolver
        qr.setResolver(address(resolver));
        console2.log("QuantumRound.resolver set to:", address(resolver));

        // 6. Transfer CPM ownership to QuantumRound
        market.transferOwnership(address(qr));
        console2.log("ConstantProductMarket ownership transferred to QuantumRound");

        // 7. Grant QUANTUM_ROUND_ROLE on ProposalTokens and Registry to QuantumRound
        bytes32 QR_ROLE = keccak256("QUANTUM_ROUND_ROLE");
        proposalTokens.grantRole(QR_ROLE, address(qr));
        registry.grantRole(QR_ROLE, address(qr));
        console2.log("QUANTUM_ROUND_ROLE granted to QuantumRound on ProposalTokens and Registry");

        // 8. Grant KEEPER_ROLE to keeper wallet
        bytes32 KEEPER_ROLE = keccak256("KEEPER_ROLE");
        qr.grantRole(KEEPER_ROLE, keeper);
        console2.log("KEEPER_ROLE granted to keeper:", keeper);

        // 9. Grant RESOLVER_ROLE to resolver on Resolver contract
        bytes32 RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
        resolver.grantRole(RESOLVER_ROLE, keeper); // keeper can submit returns in Phase A
        console2.log("RESOLVER_ROLE granted to keeper on Resolver");

        // 10. Mint tETH to deployer for testing
        tEth.grantRole(keccak256("PEG_KEEPER_ROLE"), deployer);
        tEth.mint(deployer, 10_000 ether);
        console2.log("Minted 10,000 tETH to deployer");

        // 11. Deploy WavefundVault
        WavefundVault vault = new WavefundVault(
            POOL_MANAGER,
            address(tEth),
            address(resolver),
            deployer
        );
        console2.log("WavefundVault:", address(vault));

        // 12. Grant KEEPER_ROLE on vault to keeper
        vault.grantRole(KEEPER_ROLE, keeper);
        console2.log("KEEPER_ROLE granted to keeper on WavefundVault");

        // 13. Set demo-scale liquidity per proposal (5 USDC instead of 500 USDC for testnet)
        qr.setInitialLiquidityPerProposal(5_000_000); // 5 USDC per proposal
        console2.log("initialLiquidityPerProposal set to 5 USDC for testnet demo");

        // NOTE: USDC transfers (addProtocolLiquiditySeed, fundVault) must be done via
        // cast send post-deploy because Arc's blocklist precompile (0x1800...0001) is not
        // available in forge's local simulation. See scripts/seed-post-deploy.sh

        // 15. Deploy QuantumLP stub
        QuantumLP lp = new QuantumLP(deployer);
        console2.log("QuantumLP:", address(lp));
        lp.grantRole(QR_ROLE, address(qr));

        vm.stopBroadcast();

        // Print summary
        console2.log("\n=== DEPLOYMENT SUMMARY ===");
        console2.log("Chain: Arc Testnet (5042002)");
        console2.log("TestAsset (tETH):", address(tEth));
        console2.log("ProposalTokens:", address(proposalTokens));
        console2.log("ProposerRegistry:", address(registry));
        console2.log("ConstantProductMarket:", address(market));
        console2.log("QuantumRound:", address(qr));
        console2.log("Resolver:", address(resolver));
        console2.log("WavefundVault:", address(vault));
        console2.log("QuantumLP:", address(lp));
        console2.log("PoolManager (existing):", POOL_MANAGER);
        console2.log("USDC (existing):", USDC);
        console2.log("Deployer/Admin:", deployer);
        console2.log("Keeper:", keeper);
    }
}
