// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { ProposerRegistry } from "../src/ProposerRegistry.sol";
import { MockUSDC } from "../test-helpers/MockUSDC.sol";

contract ProposerRegistryTest is Test {
    ProposerRegistry internal registry;
    MockUSDC internal usdc;

    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");
    address internal qrole = makeAddr("qrole"); // holds QUANTUM_ROUND_ROLE

    bytes32 internal constant QUANTUM_ROUND_ROLE = keccak256("QUANTUM_ROUND_ROLE");

    uint256 internal constant BOND = 1_000_000; // 1 USDC (6 dec)

    function setUp() public {
        usdc = new MockUSDC();
        registry = new ProposerRegistry(address(usdc), admin);

        // grant QUANTUM_ROUND_ROLE to a separate caller so we can test role enforcement
        vm.prank(admin);
        registry.grantRole(QUANTUM_ROUND_ROLE, qrole);
    }

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    function test_Constructor_Roles() public view {
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(QUANTUM_ROUND_ROLE, admin));
    }

    function test_Constructor_ZeroUsdc_Reverts() public {
        vm.expectRevert(ProposerRegistry.ZeroAddress.selector);
        new ProposerRegistry(address(0), admin);
    }

    function test_Constructor_ZeroAdmin_Reverts() public {
        vm.expectRevert(ProposerRegistry.ZeroAddress.selector);
        new ProposerRegistry(address(usdc), address(0));
    }

    // ─────────────────────────────────────────────────────────
    // registerAgent — happy path
    // ─────────────────────────────────────────────────────────

    function test_RegisterAgent_Happy() public {
        vm.prank(alice);
        registry.registerAgent("Alice Agent");

        (string memory name, address wallet, bool active, uint256 propCount, uint256 winCount,) = registry.agents(alice);
        assertEq(name, "Alice Agent");
        assertEq(wallet, alice);
        assertTrue(active);
        assertEq(propCount, 0);
        assertEq(winCount, 0);
    }

    function test_RegisterAgent_EmitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(registry));
        emit AgentRegistered(alice, "Alice Agent");
        registry.registerAgent("Alice Agent");
    }

    function test_RegisterAgent_AlreadyRegistered_Reverts() public {
        vm.prank(alice);
        registry.registerAgent("Alice Agent");

        vm.prank(alice);
        vm.expectRevert(ProposerRegistry.AgentAlreadyRegistered.selector);
        registry.registerAgent("Alice Agent 2");
    }

    // ─────────────────────────────────────────────────────────
    // deactivateAgent — happy path & reverts
    // ─────────────────────────────────────────────────────────

    function test_DeactivateAgent_Happy() public {
        vm.prank(alice);
        registry.registerAgent("Alice Agent");

        vm.prank(admin);
        registry.deactivateAgent(alice);

        (,, bool active,,,) = registry.agents(alice);
        assertFalse(active);
    }

    function test_DeactivateAgent_EmitsEvent() public {
        vm.prank(alice);
        registry.registerAgent("Alice Agent");

        vm.prank(admin);
        vm.expectEmit(true, false, false, false, address(registry));
        emit AgentDeactivated(alice);
        registry.deactivateAgent(alice);
    }

    function test_DeactivateAgent_NotAdmin_Reverts() public {
        vm.prank(alice);
        registry.registerAgent("Alice Agent");

        bytes32 adminRole = registry.DEFAULT_ADMIN_ROLE(); // capture before prank
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, adminRole)
        );
        registry.deactivateAgent(alice);
    }

    function test_DeactivateAgent_ZeroAddress_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(ProposerRegistry.ZeroAddress.selector);
        registry.deactivateAgent(address(0));
    }

    function test_DeactivateAgent_NotRegistered_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(ProposerRegistry.AgentNotRegistered.selector);
        registry.deactivateAgent(alice);
    }

    // ─────────────────────────────────────────────────────────
    // lockBond — happy path & reverts
    // ─────────────────────────────────────────────────────────

    function _registerAndFundAlice(uint256 amount) internal {
        vm.prank(alice);
        registry.registerAgent("Alice Agent");
        usdc.mint(alice, amount);
        vm.prank(alice);
        usdc.approve(address(registry), amount);
    }

    function test_LockBond_Happy() public {
        _registerAndFundAlice(BOND);

        vm.prank(qrole);
        registry.lockBond(alice, BOND);

        assertEq(registry.bonds(alice), BOND);
        assertEq(usdc.balanceOf(address(registry)), BOND);
        // proposalCount incremented
        (,,, uint256 pc,,) = registry.agents(alice);
        assertEq(pc, 1);
    }

    function test_LockBond_EmitsEvent() public {
        _registerAndFundAlice(BOND);

        vm.prank(qrole);
        vm.expectEmit(true, false, false, true, address(registry));
        emit BondLocked(alice, BOND);
        registry.lockBond(alice, BOND);
    }

    function test_LockBond_NotRole_Reverts() public {
        _registerAndFundAlice(BOND);

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, QUANTUM_ROUND_ROLE)
        );
        registry.lockBond(alice, BOND);
    }

    function test_LockBond_InsufficientAllowance_Reverts() public {
        vm.prank(alice);
        registry.registerAgent("Alice Agent");
        usdc.mint(alice, BOND);
        // no approval

        vm.prank(qrole);
        vm.expectRevert(ProposerRegistry.InsufficientAllowance.selector);
        registry.lockBond(alice, BOND);
    }

    function test_LockBond_NotRegistered_Reverts() public {
        vm.prank(qrole);
        vm.expectRevert(ProposerRegistry.AgentNotRegistered.selector);
        registry.lockBond(alice, BOND);
    }

    function test_LockBond_InactiveAgent_Reverts() public {
        _registerAndFundAlice(BOND);

        vm.prank(admin);
        registry.deactivateAgent(alice);

        vm.prank(qrole);
        vm.expectRevert(ProposerRegistry.AgentNotRegistered.selector);
        registry.lockBond(alice, BOND);
    }

    // ─────────────────────────────────────────────────────────
    // refundBond — happy path & reverts
    // ─────────────────────────────────────────────────────────

    function test_RefundBond_Happy() public {
        _registerAndFundAlice(BOND);

        vm.prank(qrole);
        registry.lockBond(alice, BOND);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(qrole);
        registry.refundBond(alice, BOND);

        assertEq(registry.bonds(alice), 0);
        assertEq(usdc.balanceOf(alice), balBefore + BOND);
    }

    function test_RefundBond_EmitsEvent() public {
        _registerAndFundAlice(BOND);
        vm.prank(qrole);
        registry.lockBond(alice, BOND);

        vm.prank(qrole);
        vm.expectEmit(true, false, false, true, address(registry));
        emit BondRefunded(alice, BOND);
        registry.refundBond(alice, BOND);
    }

    function test_RefundBond_NotRole_Reverts() public {
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, QUANTUM_ROUND_ROLE)
        );
        registry.refundBond(alice, BOND);
    }

    function test_RefundBond_InsufficientBond_Reverts() public {
        _registerAndFundAlice(BOND);
        vm.prank(qrole);
        registry.lockBond(alice, BOND);

        vm.prank(qrole);
        vm.expectRevert(ProposerRegistry.InsufficientBond.selector);
        registry.refundBond(alice, BOND + 1);
    }

    // ─────────────────────────────────────────────────────────
    // slashBond — happy path & reverts
    // ─────────────────────────────────────────────────────────

    function test_SlashBond_Happy() public {
        _registerAndFundAlice(BOND);
        vm.prank(qrole);
        registry.lockBond(alice, BOND);

        vm.prank(qrole);
        registry.slashBond(alice, BOND, treasury);

        assertEq(registry.bonds(alice), 0);
        assertEq(usdc.balanceOf(treasury), BOND);
    }

    function test_SlashBond_EmitsEvent() public {
        _registerAndFundAlice(BOND);
        vm.prank(qrole);
        registry.lockBond(alice, BOND);

        vm.prank(qrole);
        vm.expectEmit(true, true, false, true, address(registry));
        emit BondSlashed(alice, treasury, BOND);
        registry.slashBond(alice, BOND, treasury);
    }

    function test_SlashBond_NotRole_Reverts() public {
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, QUANTUM_ROUND_ROLE)
        );
        registry.slashBond(alice, BOND, treasury);
    }

    function test_SlashBond_InsufficientBond_Reverts() public {
        _registerAndFundAlice(BOND);
        vm.prank(qrole);
        registry.lockBond(alice, BOND);

        vm.prank(qrole);
        vm.expectRevert(ProposerRegistry.InsufficientBond.selector);
        registry.slashBond(alice, BOND + 1, treasury);
    }

    function test_SlashBond_ZeroProposer_Reverts() public {
        vm.prank(qrole);
        vm.expectRevert(ProposerRegistry.ZeroAddress.selector);
        registry.slashBond(address(0), BOND, treasury);
    }

    function test_SlashBond_ZeroTreasury_Reverts() public {
        vm.prank(qrole);
        vm.expectRevert(ProposerRegistry.ZeroAddress.selector);
        registry.slashBond(alice, BOND, address(0));
    }

    // ─────────────────────────────────────────────────────────
    // recordWin — happy path & reverts
    // ─────────────────────────────────────────────────────────

    function test_RecordWin_Happy() public {
        vm.prank(alice);
        registry.registerAgent("Alice Agent");

        vm.prank(qrole);
        registry.recordWin(alice, 500);

        (,,,, uint256 wc, int256 cumReturn) = registry.agents(alice);
        assertEq(wc, 1);
        assertEq(cumReturn, 500);
    }

    function test_RecordWin_Accumulates() public {
        vm.prank(alice);
        registry.registerAgent("Alice Agent");

        vm.startPrank(qrole);
        registry.recordWin(alice, 500);
        registry.recordWin(alice, 300);
        vm.stopPrank();

        (,,,, uint256 wc, int256 cumReturn) = registry.agents(alice);
        assertEq(wc, 2);
        assertEq(cumReturn, 800);
    }

    function test_RecordWin_EmitsEvent() public {
        vm.prank(alice);
        registry.registerAgent("Alice Agent");

        vm.prank(qrole);
        vm.expectEmit(true, false, false, true, address(registry));
        emit WinRecorded(alice, 500);
        registry.recordWin(alice, 500);
    }

    function test_RecordWin_NotRole_Reverts() public {
        vm.prank(alice);
        registry.registerAgent("Alice Agent");

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, QUANTUM_ROUND_ROLE)
        );
        registry.recordWin(alice, 500);
    }

    function test_RecordWin_NotRegistered_Reverts() public {
        vm.prank(qrole);
        vm.expectRevert(ProposerRegistry.AgentNotRegistered.selector);
        registry.recordWin(alice, 500);
    }

    // ─────────────────────────────────────────────────────────
    // Events (needed to match signatures)
    // ─────────────────────────────────────────────────────────

    event AgentRegistered(address indexed agent, string name);
    event AgentDeactivated(address indexed agent);
    event BondLocked(address indexed proposer, uint256 amount);
    event BondRefunded(address indexed proposer, uint256 amount);
    event BondSlashed(address indexed proposer, address indexed treasury, uint256 amount);
    event WinRecorded(address indexed proposer, int256 returnBps);
}
