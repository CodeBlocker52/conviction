// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { ProposalTokens } from "../src/ProposalTokens.sol";
import { ProposerRegistry } from "../src/ProposerRegistry.sol";
import { QuantumRound } from "../src/QuantumRound.sol";
import { IQuantumRoundTiming, WaveV4ProposalMarket } from "../src/WaveV4ProposalMarket.sol";
import { ProposalTokenImpl } from "../src/ProposalTokens.sol";
import { MockUSDC } from "../test-helpers/MockUSDC.sol";
import { WaveHook } from "../src/WaveHook.sol";

address constant V4_MARKET_TEST_USDC = 0x3600000000000000000000000000000000000000;
uint160 constant V4_TEST_HOOK_FLAGS = uint160(
    Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
        | Hooks.AFTER_SWAP_FLAG
);

contract WaveV4ProposalMarketTest is Test {
    using PoolIdLibrary for PoolKey;

    MockUSDC private usdc;
    ProposalTokens private tokenFactory;
    PoolManager private poolManager;
    ProposerRegistry private registry;
    WaveV4ProposalMarket private market;
    WaveHook private hook;
    QuantumRound private round;

    address private admin = makeAddr("v4-market-admin");
    address private alice = makeAddr("v4-market-alice");
    address private treasury = makeAddr("v4-market-treasury");

    function setUp() public {
        usdc = new MockUSDC();
        vm.etch(V4_MARKET_TEST_USDC, address(usdc).code);
        usdc = MockUSDC(V4_MARKET_TEST_USDC);

        poolManager = new PoolManager(address(this));
        tokenFactory = new ProposalTokens(admin);
        vm.prank(admin);
        tokenFactory.setCreditDecimals(6);
        registry = new ProposerRegistry(V4_MARKET_TEST_USDC, admin);
        market = new WaveV4ProposalMarket(IPoolManager(address(poolManager)), tokenFactory, admin);
        round = new QuantumRound(address(tokenFactory), address(market), address(registry), admin, treasury, admin);

        bytes memory constructorArgs = abi.encode(IPoolManager(address(poolManager)), address(market));
        (address expectedHook, bytes32 salt) =
            HookMiner.find(address(this), V4_TEST_HOOK_FLAGS, type(WaveHook).creationCode, constructorArgs);
        hook = new WaveHook{ salt: salt }(IPoolManager(address(poolManager)), address(market));
        assertEq(address(hook), expectedHook);

        vm.startPrank(admin);
        market.setQuantumRound(IQuantumRoundTiming(address(round)));
        market.setWaveHook(hook);
        market.transferOwnership(address(round));
        tokenFactory.grantRole(tokenFactory.QUANTUM_ROUND_ROLE(), address(round));
        registry.grantRole(registry.QUANTUM_ROUND_ROLE(), address(round));
        round.setInitialLiquidityPerProposal(1_000_000);
        usdc.mint(admin, 3_000_000);
        usdc.approve(address(round), 3_000_000);
        round.addProtocolLiquiditySeed(3_000_000);
        vm.stopPrank();
    }

    function test_RoundCreatesBoundedPoolTradesAndUnwindsAfterClose() public {
        uint64 tradingEnd = uint64(block.timestamp + 120);
        vm.prank(admin);
        round.openRound(tradingEnd, 120, 0.5e18, 2e18, 60);
        uint256 roundId = round.roundCount();

        assertEq(market.spotPrice(roundId, 0), 1e18);
        address longToken = tokenFactory.longToken(roundId, 0);
        assertEq(ProposalTokenImpl(tokenFactory.creditToken(roundId, 0)).decimals(), 6);
        assertEq(ProposalTokenImpl(longToken).decimals(), 18);

        usdc.mint(alice, 100_000);
        vm.startPrank(alice);
        usdc.approve(address(round), 100_000);
        round.deposit(roundId, 100_000);
        round.claimCredits(roundId, 0, 100_000);
        round.buyLong(roundId, 0, 10_000, 1);
        assertGt(ProposalTokenImpl(longToken).balanceOf(alice), 0);
        (uint256 pLong, uint256 pShort) = market.probabilities(roundId, 0);
        assertGt(pLong, 1e16);
        assertLt(pLong, 99e16);
        assertEq(pLong + pShort, 1e18);
        round.sellLong(roundId, 0, ProposalTokenImpl(longToken).balanceOf(alice) / 2, 1);
        address shortToken = tokenFactory.shortToken(roundId, 0);
        round.buyShort(roundId, 0, 10_000, 1);
        assertGt(ProposalTokenImpl(shortToken).balanceOf(alice), 0);
        round.sellShort(roundId, 0, ProposalTokenImpl(shortToken).balanceOf(alice) / 2, 1);
        (pLong, pShort) = market.probabilities(roundId, 0);
        assertGt(pLong, 1e16);
        assertLt(pLong, 99e16);
        assertEq(pLong + pShort, 1e18);
        vm.stopPrank();

        vm.warp(tradingEnd);
        round.collapse(roundId);
        vm.warp(tradingEnd + 121);
        vm.prank(admin);
        round.settle(roundId, 1e18);
        assertLe(round.roundUserLiability(roundId), round.roundRemainingCollateral(roundId));

        vm.prank(alice);
        round.redeem(roundId);
        assertEq(round.roundUserLiability(roundId), 0);
        assertEq(round.roundRemainingCollateral(roundId), 0);
        assertGt(usdc.balanceOf(address(round)), 0);
    }

    function test_SharedHookTracksSeparatePoolsAcrossRounds() public {
        uint64 start = uint64(block.timestamp);
        uint64 firstEnd = start + 120;
        vm.prank(admin);
        round.openRound(firstEnd, 120, 0.5e18, 2e18, 60);
        uint256 firstRoundId = round.roundCount();

        address proposer = makeAddr("shared-hook-proposer");
        usdc.mint(proposer, 1_000_000);
        vm.startPrank(proposer);
        registry.registerAgent("Shared Hook Proposer");
        usdc.approve(address(registry), 1_000_000);
        round.propose(firstRoundId, QuantumRound.Allocation({ tEthBps: 5000 }), "ipfs://shared-hook");
        vm.stopPrank();

        uint64 secondEnd = start + 240;
        vm.prank(admin);
        round.openRound(secondEnd, 120, 0.5e18, 2e18, 60);
        uint256 secondRoundId = round.roundCount();

        PoolKey memory firstProposal0Key = market.poolKey(firstRoundId, 0);
        PoolKey memory firstProposal1Key = market.poolKey(firstRoundId, 1);
        PoolKey memory secondProposal0Key = market.poolKey(secondRoundId, 0);
        assertEq(address(firstProposal0Key.hooks), address(hook));
        assertEq(address(firstProposal1Key.hooks), address(hook));
        assertEq(address(secondProposal0Key.hooks), address(hook));
        assertNotEq(keccak256(abi.encode(firstProposal0Key)), keccak256(abi.encode(firstProposal1Key)));
        assertNotEq(keccak256(abi.encode(firstProposal0Key)), keccak256(abi.encode(secondProposal0Key)));

        (
            uint256 stateRound,
            uint256 stateProposal,
            address registeredLongToken,
            uint64 registeredStart,
            uint64 registeredEnd,
            uint64 registeredWindow,
            bool registered
        ) = hook.poolDetails(firstProposal1Key.toId());
        assertTrue(registered);
        assertEq(stateRound, firstRoundId);
        assertEq(stateProposal, 1);
        assertEq(registeredLongToken, tokenFactory.longToken(firstRoundId, 1));
        assertEq(registeredStart, start);
        assertEq(registeredEnd, firstEnd);
        assertEq(registeredWindow, 60);

        usdc.mint(alice, 1_000_000);
        vm.startPrank(alice);
        usdc.approve(address(round), 1_000_000);
        round.deposit(firstRoundId, 1_000_000);
        round.claimCredits(firstRoundId, 0, 500_000);
        round.buyLong(firstRoundId, 0, 100_000, 1);
        vm.stopPrank();

        vm.warp(firstEnd);
        uint256 movedTwap = market.twap(firstRoundId, 0, 0, firstEnd);
        uint256 untouchedSameRoundTwap = market.twap(firstRoundId, 1, 0, firstEnd);
        uint256 untouchedOtherRoundTwap = market.twap(secondRoundId, 0, 0, firstEnd);
        assertGt(movedTwap, 1e18);
        assertEq(untouchedSameRoundTwap, 1e18);
        assertEq(untouchedOtherRoundTwap, 1e18);
    }
}
