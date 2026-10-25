// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IProposalMarket } from "../src/IProposalMarket.sol";
import { ProposalTokens } from "../src/ProposalTokens.sol";
import { ProposalTokenImpl } from "../src/ProposalTokens.sol";
import { ProposerRegistry } from "../src/ProposerRegistry.sol";
import { QuantumRound } from "../src/QuantumRound.sol";
import { MockUSDC } from "../test-helpers/MockUSDC.sol";

address constant COMPLETE_SET_USDC = 0x3600000000000000000000000000000000000000;

contract CompleteSetMockMarket is IProposalMarket {
    uint256 public constant SCALE = 1e12;

    ProposalTokens public immutable tokenFactory;
    address public owner;
    mapping(uint256 roundId => mapping(uint256 proposalId => uint256)) private _pendingLong;
    mapping(uint256 roundId => mapping(uint256 proposalId => uint256)) private _pendingShort;

    error OnlyOwner();

    constructor(ProposalTokens tokenFactory_, address owner_) {
        tokenFactory = tokenFactory_;
        owner = owner_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function tradeBuyLong(uint256 roundId, uint256 proposalId, uint256 creditsIn, uint256 minLongOut)
        external
        onlyOwner
        returns (uint256 longOut)
    {
        longOut = creditsIn * SCALE;
        require(longOut >= minLongOut);
        IERC20(tokenFactory.longToken(roundId, proposalId)).transfer(msg.sender, longOut);
    }

    function tradeBuyShort(uint256 roundId, uint256 proposalId, uint256 creditsIn, uint256 minSetsOut)
        external
        onlyOwner
        returns (uint256 setsOut)
    {
        setsOut = creditsIn * SCALE;
        require(setsOut >= minSetsOut);
        IERC20(tokenFactory.shortToken(roundId, proposalId)).transfer(msg.sender, setsOut);
    }

    function tradeSellLong(uint256 roundId, uint256 proposalId, uint256 longIn, uint256 minCreditsOut)
        external
        onlyOwner
        returns (uint256 creditsOut)
    {
        creditsOut = longIn / SCALE;
        require(creditsOut >= minCreditsOut && creditsOut > 0);
        _pendingShort[roundId][proposalId] = creditsOut * SCALE;
    }

    function tradeSellShort(uint256 roundId, uint256 proposalId, uint256 setsIn, uint256 minCreditsOut)
        external
        onlyOwner
        returns (uint256 creditsOut)
    {
        creditsOut = setsIn / SCALE;
        require(creditsOut >= minCreditsOut && creditsOut > 0);
        _pendingLong[roundId][proposalId] = creditsOut * SCALE;
    }

    function spotPrice(uint256, uint256) external pure returns (uint256) {
        return 0.5e18;
    }

    function twap(uint256, uint256, uint256, uint256) external pure returns (uint256) {
        return 0.5e18;
    }

    function seedLiquidity(uint256, uint256, uint256 creditAmount, uint256 longAmount) external view onlyOwner {
        require(creditAmount > 0 && longAmount > 0);
    }

    function closeTwapWindow(uint256, uint256, uint256) external view onlyOwner { }

    function completeSetScale() external pure returns (uint256) {
        return SCALE;
    }

    function consumeSellSettlement(uint256 roundId, uint256 proposalId)
        external
        onlyOwner
        returns (uint256 longRemainder, uint256 shortRemainder)
    {
        longRemainder = _pendingLong[roundId][proposalId];
        shortRemainder = _pendingShort[roundId][proposalId];
        _pendingLong[roundId][proposalId] = 0;
        _pendingShort[roundId][proposalId] = 0;
        IERC20(tokenFactory.longToken(roundId, proposalId)).transfer(msg.sender, longRemainder);
        IERC20(tokenFactory.shortToken(roundId, proposalId)).transfer(msg.sender, shortRemainder);
    }

    function finalizeProposal(uint256 roundId, uint256 proposalId)
        external
        onlyOwner
        returns (uint256 longReturned, uint256 shortReturned)
    {
        address longTokenAddr = tokenFactory.longToken(roundId, proposalId);
        address shortTokenAddr = tokenFactory.shortToken(roundId, proposalId);
        longReturned = IERC20(longTokenAddr).balanceOf(address(this));
        shortReturned = IERC20(shortTokenAddr).balanceOf(address(this));
        IERC20(longTokenAddr).transfer(msg.sender, longReturned);
        IERC20(shortTokenAddr).transfer(msg.sender, shortReturned);
    }
}

contract QuantumRoundCompleteSetTest is Test {
    MockUSDC private usdc;
    ProposalTokens private tokenFactory;
    CompleteSetMockMarket private market;
    ProposerRegistry private registry;
    QuantumRound private round;

    address private admin = makeAddr("complete-set-admin");
    address private alice = makeAddr("complete-set-alice");
    address private treasury = makeAddr("complete-set-treasury");

    function setUp() public {
        usdc = new MockUSDC();
        vm.etch(COMPLETE_SET_USDC, address(usdc).code);
        usdc = MockUSDC(COMPLETE_SET_USDC);

        tokenFactory = new ProposalTokens(admin);
        vm.prank(admin);
        tokenFactory.setCreditDecimals(6);
        market = new CompleteSetMockMarket(tokenFactory, admin);
        registry = new ProposerRegistry(COMPLETE_SET_USDC, admin);

        round = new QuantumRound(address(tokenFactory), address(market), address(registry), admin, treasury, admin);
        vm.prank(admin);
        market.transferOwnership(address(round));

        vm.startPrank(admin);
        tokenFactory.grantRole(tokenFactory.QUANTUM_ROUND_ROLE(), address(round));
        registry.grantRole(registry.QUANTUM_ROUND_ROLE(), address(round));
        round.setInitialLiquidityPerProposal(1_000_000);
        usdc.mint(admin, 2_000_000);
        usdc.approve(address(round), 2_000_000);
        round.addProtocolLiquiditySeed(2_000_000);
        vm.stopPrank();
    }

    function test_CompleteSetUnitsSettlementAndReserveRelease() public {
        uint64 tradingEnd = uint64(block.timestamp + 100);
        vm.prank(admin);
        round.openRound(tradingEnd, 100, 0.5e18, 2e18, 60);
        uint256 roundId = round.roundCount();

        address credit = tokenFactory.creditToken(roundId, 0);
        address longTokenAddr = tokenFactory.longToken(roundId, 0);
        address shortTokenAddr = tokenFactory.shortToken(roundId, 0);
        assertEq(ProposalTokenImpl(credit).decimals(), 6);
        assertEq(ProposalTokenImpl(longTokenAddr).decimals(), 18);
        assertEq(ProposalTokenImpl(shortTokenAddr).decimals(), 18);
        assertEq(IERC20(longTokenAddr).balanceOf(address(market)), 1e18);
        assertEq(IERC20(shortTokenAddr).balanceOf(address(market)), 1e18);

        usdc.mint(alice, 10_000_000);
        vm.startPrank(alice);
        usdc.approve(address(round), 10_000_000);
        round.deposit(roundId, 10_000_000);
        round.claimCredits(roundId, 0, 5_000_000);
        round.buyLong(roundId, 0, 2_000_000, 2e18);
        round.sellLong(roundId, 0, 1e18, 1_000_000);
        vm.stopPrank();

        vm.warp(tradingEnd);
        round.collapse(roundId);
        vm.warp(tradingEnd + 101);
        vm.prank(admin);
        round.settle(roundId, 1e18);

        assertLe(round.roundUserLiability(roundId), round.roundRemainingCollateral(roundId));
        uint256 balanceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        round.redeem(roundId);
        uint256 paid = usdc.balanceOf(alice) - balanceBefore;
        assertLe(paid, 11_000_000);
        assertEq(round.roundUserLiability(roundId), 0);
        assertEq(round.roundRemainingCollateral(roundId), 0);
        assertGt(round.protocolLiquiditySeed(), 1_000_000);
    }

    function testFuzz_CompleteSetLiabilitiesRemainBacked(uint32 rawBuyAmount, int256 realizedReturn) public {
        uint256 buyAmount = bound(rawBuyAmount, 2, 500_000);
        uint64 tradingEnd = uint64(block.timestamp + 100);
        vm.prank(admin);
        round.openRound(tradingEnd, 100, 0.5e18, 2e18, 60);
        uint256 roundId = round.roundCount();

        usdc.mint(alice, 1_000_000);
        vm.startPrank(alice);
        usdc.approve(address(round), 1_000_000);
        round.deposit(roundId, 1_000_000);
        round.claimCredits(roundId, 0, 1_000_000);
        round.buyLong(roundId, 0, buyAmount, 0);
        address longTokenAddr = tokenFactory.longToken(roundId, 0);
        round.sellLong(roundId, 0, IERC20(longTokenAddr).balanceOf(alice) / 2, 0);
        vm.stopPrank();

        vm.warp(tradingEnd);
        round.collapse(roundId);
        vm.warp(tradingEnd + 101);
        vm.prank(admin);
        round.settle(roundId, realizedReturn);

        assertLe(round.roundUserLiability(roundId), round.roundRemainingCollateral(roundId));
        vm.prank(alice);
        round.redeem(roundId);
        assertEq(round.roundUserLiability(roundId), 0);
        assertEq(round.roundRemainingCollateral(roundId), 0);
    }
}
