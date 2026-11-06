// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { MockPriceOracle } from "../src/MockPriceOracle.sol";
import { WavefundVault } from "../src/WavefundVault.sol";
import { WavefundPriceReceiver } from "../src/cre/WavefundPriceReceiver.sol";
import { ReceiverTemplate } from "../src/cre/ReceiverTemplate.sol";
import { IReceiver } from "../src/cre/IReceiver.sol";
import { IERC165 } from "../src/cre/IERC165.sol";

contract MockCREForwarder {
    function deliver(address receiver, bytes calldata report) external {
        IReceiver(receiver).onReport("", report);
    }
}

contract WavefundPriceReceiverTest is Test {
    address private constant SIM_FORWARDER = 0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1;
    address private constant PROD_FORWARDER = 0x76c9cf548b4179F8901cda1f8623568b58215E62;
    uint64 private constant ARC_SELECTOR = 3034092155422581607;
    int256 private constant INITIAL_PRICE = 2_000e8;
    address private constant TRANSMITTER = address(0x123456);
    MockPriceOracle private oracle;
    WavefundPriceReceiver private receiver;

    event CREPriceReported(int256 price, uint64 observedAt, uint64 scheduledAt, uint32 sourceCount);

    function setUp() public {
        vm.warp(100);
        MockCREForwarder implementation = new MockCREForwarder();
        vm.etch(SIM_FORWARDER, address(implementation).code);
        oracle = new MockPriceOracle(address(this), address(this));
        oracle.updatePrice(INITIAL_PRICE);
        receiver = new WavefundPriceReceiver(SIM_FORWARDER, address(oracle), ARC_SELECTOR);
        oracle.grantRole(oracle.KEEPER_ROLE(), address(receiver));
    }

    function report(int256 price, uint64 observedAt, uint64 scheduledAt, uint64 selector, uint32 sources)
        private
        pure
        returns (bytes memory)
    {
        return abi.encode(price, observedAt, scheduledAt, selector, sources);
    }

    function deliver(int256 price, uint64 observedAt, uint64 scheduledAt, uint64 selector, uint32 sources) private {
        MockCREForwarder(SIM_FORWARDER).deliver(address(receiver), report(price, observedAt, scheduledAt, selector, sources));
    }

    function test_HappyPathAndEvent() public {
        uint64 now_ = uint64(block.timestamp);
        vm.expectEmit(false, false, false, true, address(receiver));
        emit CREPriceReported(2_100e8, now_ - 1, now_, 2);
        deliver(2_100e8, now_ - 1, now_, ARC_SELECTOR, 2);
        (int256 price, uint8 decimals, uint64 updatedAt) = oracle.latestPrice();
        assertEq(price, 2_100e8);
        assertEq(decimals, 8);
        assertEq(updatedAt, now_);
        assertEq(receiver.lastPrice(), 2_100e8);
        assertEq(receiver.lastObservedAt(), now_ - 1);
        assertEq(receiver.lastScheduledAt(), now_);
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(receiver.supportsInterface(type(IERC165).interfaceId));
    }

    function test_ProductionForwarderCanBeConfiguredWithoutMetadataChecks() public {
        WavefundPriceReceiver production = new WavefundPriceReceiver(PROD_FORWARDER, address(oracle), ARC_SELECTOR);
        assertEq(production.getForwarderAddress(), PROD_FORWARDER);
        assertEq(production.getExpectedAuthor(), address(0));
        assertEq(production.getExpectedWorkflowId(), bytes32(0));
        assertEq(production.getExpectedWorkflowName(), bytes10(0));
    }

    function test_WrongSenderRejected() public {
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, address(this), SIM_FORWARDER));
        receiver.onReport("", report(INITIAL_PRICE, 1, 1, ARC_SELECTOR, 2));
    }

    function test_AllowedTransmitterAndWrongTransmitter() public {
        receiver.setAllowedTransmitter(TRANSMITTER);
        vm.prank(address(this), address(0x999));
        vm.expectRevert(
            abi.encodeWithSelector(WavefundPriceReceiver.InvalidTransmitter.selector, address(0x999), TRANSMITTER)
        );
        MockCREForwarder(SIM_FORWARDER).deliver(address(receiver), report(INITIAL_PRICE, 99, 99, ARC_SELECTOR, 2));
        vm.prank(address(this), TRANSMITTER);
        MockCREForwarder(SIM_FORWARDER).deliver(address(receiver), report(INITIAL_PRICE, 100, 100, ARC_SELECTOR, 2));
        assertEq(receiver.lastScheduledAt(), 100);
        receiver.setAllowedTransmitter(address(0));
        vm.prank(address(this), address(0x999));
        MockCREForwarder(SIM_FORWARDER).deliver(address(receiver), report(INITIAL_PRICE, 100, 101, ARC_SELECTOR, 2));
        assertEq(receiver.lastScheduledAt(), 101);
    }

    function test_OnlyOwnerCanConfigureTransmitter() public {
        vm.prank(address(0x999));
        vm.expectRevert();
        receiver.setAllowedTransmitter(TRANSMITTER);
        assertEq(receiver.allowedTransmitter(), address(0));
    }

    function test_WrongChainRejected() public {
        vm.expectRevert(abi.encodeWithSelector(WavefundPriceReceiver.InvalidChainSelector.selector, uint64(1), ARC_SELECTOR));
        deliver(INITIAL_PRICE, 1, 1, 1, 2);
    }

    function test_ReplayAndOlderScheduleRejected() public {
        deliver(INITIAL_PRICE, 100, 100, ARC_SELECTOR, 2);
        vm.expectRevert(abi.encodeWithSelector(WavefundPriceReceiver.InvalidSchedule.selector, uint64(100), uint64(100)));
        deliver(INITIAL_PRICE, 101, 100, ARC_SELECTOR, 2);
        vm.expectRevert(abi.encodeWithSelector(WavefundPriceReceiver.InvalidSchedule.selector, uint64(99), uint64(100)));
        deliver(INITIAL_PRICE, 101, 99, ARC_SELECTOR, 2);
        assertEq(receiver.lastScheduledAt(), 100);
    }

    function test_ZeroAndNegativePriceRejected() public {
        vm.expectRevert(WavefundPriceReceiver.InvalidPrice.selector);
        deliver(0, 1, 1, ARC_SELECTOR, 2);
        vm.expectRevert(WavefundPriceReceiver.InvalidPrice.selector);
        deliver(-1, 1, 1, ARC_SELECTOR, 2);
    }

    function test_MoreThanTwentyPercentMoveRejectedInBothDirections() public {
        int256 upper = 2_400e8 + 1;
        int256 lower = 1_600e8 - 1;
        vm.expectRevert(abi.encodeWithSelector(WavefundPriceReceiver.PriceMoveTooLarge.selector, INITIAL_PRICE, upper));
        deliver(upper, 1, 1, ARC_SELECTOR, 2);
        vm.expectRevert(abi.encodeWithSelector(WavefundPriceReceiver.PriceMoveTooLarge.selector, INITIAL_PRICE, lower));
        deliver(lower, 1, 1, ARC_SELECTOR, 2);
        vm.expectRevert(abi.encodeWithSelector(WavefundPriceReceiver.PriceMoveTooLarge.selector, INITIAL_PRICE, type(int256).max));
        deliver(type(int256).max, 1, 1, ARC_SELECTOR, 2);
    }

    function test_ExactlyTwentyPercentAccepted() public {
        deliver(2_400e8, 1, 1, ARC_SELECTOR, 2);
        oracle.updatePrice(INITIAL_PRICE);
        deliver(1_600e8, 2, 2, ARC_SELECTOR, 2);
        assertEq(receiver.lastPrice(), 1_600e8);
    }

    function test_InitialZeroOraclePriceAllowsFirstReport() public {
        MockPriceOracle fresh = new MockPriceOracle(address(this), address(this));
        WavefundPriceReceiver r = new WavefundPriceReceiver(SIM_FORWARDER, address(fresh), ARC_SELECTOR);
        fresh.grantRole(fresh.KEEPER_ROLE(), address(r));
        MockCREForwarder(SIM_FORWARDER).deliver(address(r), report(INITIAL_PRICE, 1, 1, ARC_SELECTOR, 2));
        assertEq(fresh.price(), INITIAL_PRICE);
    }

    function test_InsufficientSourcesAndFutureObservationRejected() public {
        vm.expectRevert(abi.encodeWithSelector(WavefundPriceReceiver.InsufficientSources.selector, uint32(1)));
        deliver(INITIAL_PRICE, 1, 1, ARC_SELECTOR, 1);
        vm.expectRevert(abi.encodeWithSelector(WavefundPriceReceiver.FutureObservation.selector, uint64(block.timestamp + 1)));
        deliver(INITIAL_PRICE, uint64(block.timestamp + 1), 1, ARC_SELECTOR, 2);
    }

    function test_ObservationAgeLimitIsInclusive() public {
        vm.warp(200);
        vm.expectRevert(abi.encodeWithSelector(WavefundPriceReceiver.StaleObservation.selector, uint64(79)));
        deliver(INITIAL_PRICE, 79, 1, ARC_SELECTOR, 2);
        deliver(INITIAL_PRICE, 80, 1, ARC_SELECTOR, 2);
        assertEq(receiver.lastObservedAt(), 80);
    }

    function test_FutureScheduleLimitIsInclusive() public {
        vm.expectRevert(abi.encodeWithSelector(WavefundPriceReceiver.FutureSchedule.selector, uint64(161)));
        deliver(INITIAL_PRICE, 100, 161, ARC_SELECTOR, 2);
        deliver(INITIAL_PRICE, 100, 160, ARC_SELECTOR, 2);
        assertEq(receiver.lastScheduledAt(), 160);
    }

    function test_OwnerCanRevokeOracleAccessWithoutRemovingKeeper() public {
        vm.prank(address(0x999));
        vm.expectRevert();
        receiver.revokeOracleAccess();
        assertTrue(oracle.hasRole(oracle.KEEPER_ROLE(), address(receiver)));
        receiver.revokeOracleAccess();
        assertFalse(oracle.hasRole(oracle.KEEPER_ROLE(), address(receiver)));
        assertTrue(oracle.hasRole(oracle.KEEPER_ROLE(), address(this)));
        vm.expectRevert();
        deliver(INITIAL_PRICE, 100, 100, ARC_SELECTOR, 2);
    }

    function test_VaultReadsReportedPriceAsFresh() public {
        WavefundVault vault =
            new WavefundVault(address(0x1234), address(0x5678), address(0x9abc), address(0xdef0), address(oracle), 500, address(this));
        vm.warp(block.timestamp + vault.MAX_ORACLE_AGE() + 1);
        vm.expectRevert(WavefundVault.StaleOraclePrice.selector);
        vault.totalAssetsUsdc();
        deliver(2_100e8, uint64(block.timestamp - 120), uint64(block.timestamp), ARC_SELECTOR, 2);
        assertEq(receiver.lastObservedAt(), block.timestamp - 120);
        assertEq(oracle.updatedAt(), block.timestamp);
        assertEq(vault.oraclePriceTEthInUsdc(), 2_100e6);
        assertEq(vault.totalAssetsUsdc(), 0);
    }

    function test_OracleRevertDoesNotAdvanceReplayState() public {
        oracle.revokeRole(oracle.KEEPER_ROLE(), address(receiver));
        vm.expectRevert();
        deliver(INITIAL_PRICE, 1, 1, ARC_SELECTOR, 2);
        assertEq(receiver.lastScheduledAt(), 0);
        assertEq(receiver.lastPrice(), 0);
    }
}
