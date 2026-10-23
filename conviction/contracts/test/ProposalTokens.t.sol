// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ProposalTokens, ProposalTokenImpl} from "../src/ProposalTokens.sol";

contract ProposalTokensTest is Test {
    ProposalTokens internal pt;
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob   = makeAddr("bob");

    bytes32 internal constant QUANTUM_ROUND_ROLE = keccak256("QUANTUM_ROUND_ROLE");

    event ProposalTokensDeployed(
        uint256 indexed roundId,
        uint256 indexed proposalId,
        address indexed credit,
        address long,
        address short
    );

    function setUp() public {
        pt = new ProposalTokens(admin);
    }

    // ─────────────────────────────────────────────────────────
    // Deployment & initialization
    // ─────────────────────────────────────────────────────────

    function test_Constructor_AdminReceivesRoles() public view {
        assertTrue(pt.hasRole(pt.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(pt.hasRole(QUANTUM_ROUND_ROLE, admin));
    }

    function test_Constructor_ZeroAdmin_Reverts() public {
        vm.expectRevert(ProposalTokens.ZeroAddress.selector);
        new ProposalTokens(address(0));
    }

    function test_Constructor_ImplementationDeployed() public view {
        assertTrue(pt.implementation() != address(0));
    }

    // ─────────────────────────────────────────────────────────
    // deployForProposal — happy path
    // ─────────────────────────────────────────────────────────

    function test_DeployForProposal_CreatesThreeTokens() public {
        vm.prank(admin);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");

        address credit = pt.creditToken(1, 0);
        address long_  = pt.longToken(1, 0);
        address short_ = pt.shortToken(1, 0);

        assertTrue(credit != address(0));
        assertTrue(long_ != address(0));
        assertTrue(short_ != address(0));
        assertTrue(credit != long_);
        assertTrue(long_ != short_);
    }

    function test_DeployForProposal_EmitsEvent() public {
        vm.prank(admin);
        // We can only check the event structure — addresses are deterministic but not easily predicted
        // We verify that the event is emitted at all by checking a slightly looser check flag on the address
        vm.recordLogs();
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");
        Vm.Log[] memory entries = vm.getRecordedLogs();
        // ProposalTokensDeployed has 3 indexed topics + data
        // topic[0] = event sig, topic[1] = roundId, topic[2] = proposalId, topic[3] = credit
        bool found;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == ProposalTokensDeployed.selector) {
                found = true;
                // roundId = 1
                assertEq(uint256(entries[i].topics[1]), 1);
                // proposalId = 0
                assertEq(uint256(entries[i].topics[2]), 0);
            }
        }
        assertTrue(found, "ProposalTokensDeployed not emitted");
    }

    function test_DeployForProposal_TokensInitialized() public {
        vm.prank(admin);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");

        ProposalTokenImpl credit = ProposalTokenImpl(pt.creditToken(1, 0));
        ProposalTokenImpl long_  = ProposalTokenImpl(pt.longToken(1, 0));
        ProposalTokenImpl short_ = ProposalTokenImpl(pt.shortToken(1, 0));

        // symbols match
        assertEq(credit.symbol(), "CR1_0");
        assertEq(long_.symbol(),  "LO1_0");
        assertEq(short_.symbol(), "SH1_0");

        // minter set to deployer (admin in this test)
        assertEq(credit.minter(), admin);
        assertEq(long_.minter(),  admin);
        assertEq(short_.minter(), admin);
    }

    // ─────────────────────────────────────────────────────────
    // Round-namespacing: (0,0) and (1,0) are distinct
    // ─────────────────────────────────────────────────────────

    function test_DeployForProposal_DifferentRounds_BothSucceed() public {
        vm.startPrank(admin);
        pt.deployForProposal(0, 0, "CR0_0", "LO0_0", "SH0_0");
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0"); // must not revert
        vm.stopPrank();

        // tokens are different
        assertTrue(pt.creditToken(0, 0) != pt.creditToken(1, 0));
    }

    function test_DeployForProposal_SameRoundDifferentProposal_BothSucceed() public {
        vm.startPrank(admin);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");
        pt.deployForProposal(1, 1, "CR1_1", "LO1_1", "SH1_1");
        vm.stopPrank();

        assertTrue(pt.creditToken(1, 0) != pt.creditToken(1, 1));
    }

    // ─────────────────────────────────────────────────────────
    // deployForProposal — revert paths
    // ─────────────────────────────────────────────────────────

    function test_DeployForProposal_AlreadyDeployed_Reverts() public {
        vm.startPrank(admin);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");
        vm.expectRevert(ProposalTokens.AlreadyDeployed.selector);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");
        vm.stopPrank();
    }

    function test_DeployForProposal_NotRole_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                QUANTUM_ROUND_ROLE
            )
        );
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");
    }

    // ─────────────────────────────────────────────────────────
    // getPair — happy path & revert
    // ─────────────────────────────────────────────────────────

    function test_GetPair_ReturnsCorrectAddresses() public {
        vm.prank(admin);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");

        (address c, address l, address s) = pt.getPair(1, 0);
        assertEq(c, pt.creditToken(1, 0));
        assertEq(l, pt.longToken(1, 0));
        assertEq(s, pt.shortToken(1, 0));
    }

    function test_GetPair_NotDeployed_Reverts() public {
        vm.expectRevert(ProposalTokens.NotDeployed.selector);
        pt.getPair(99, 99);
    }

    // ─────────────────────────────────────────────────────────
    // ProposalTokenImpl — minter role enforcement
    // ─────────────────────────────────────────────────────────

    function test_TokenImpl_MintByMinter() public {
        vm.prank(admin);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");
        ProposalTokenImpl credit = ProposalTokenImpl(pt.creditToken(1, 0));

        vm.prank(admin);
        credit.mint(alice, 100e18);
        assertEq(credit.balanceOf(alice), 100e18);
    }

    function test_TokenImpl_MintNotMinter_Reverts() public {
        vm.prank(admin);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");
        ProposalTokenImpl credit = ProposalTokenImpl(pt.creditToken(1, 0));

        vm.prank(alice);
        vm.expectRevert(ProposalTokenImpl.NotMinter.selector);
        credit.mint(alice, 100e18);
    }

    function test_TokenImpl_BurnByMinter() public {
        vm.prank(admin);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");
        ProposalTokenImpl credit = ProposalTokenImpl(pt.creditToken(1, 0));

        vm.startPrank(admin);
        credit.mint(alice, 100e18);
        credit.burn(alice, 40e18);
        vm.stopPrank();

        assertEq(credit.balanceOf(alice), 60e18);
    }

    function test_TokenImpl_BurnNotMinter_Reverts() public {
        vm.prank(admin);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");
        ProposalTokenImpl credit = ProposalTokenImpl(pt.creditToken(1, 0));

        vm.prank(admin);
        credit.mint(alice, 100e18);

        vm.prank(alice);
        vm.expectRevert(ProposalTokenImpl.NotMinter.selector);
        credit.burn(alice, 100e18);
    }

    function test_TokenImpl_MintZeroAmount_Reverts() public {
        vm.prank(admin);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");
        ProposalTokenImpl credit = ProposalTokenImpl(pt.creditToken(1, 0));

        vm.prank(admin);
        vm.expectRevert(ProposalTokenImpl.ZeroAmount.selector);
        credit.mint(alice, 0);
    }

    function test_TokenImpl_MintZeroAddress_Reverts() public {
        vm.prank(admin);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");
        ProposalTokenImpl credit = ProposalTokenImpl(pt.creditToken(1, 0));

        vm.prank(admin);
        vm.expectRevert(ProposalTokenImpl.ZeroAddress.selector);
        credit.mint(address(0), 1e18);
    }

    function test_TokenImpl_BurnZeroAmount_Reverts() public {
        vm.prank(admin);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");
        ProposalTokenImpl credit = ProposalTokenImpl(pt.creditToken(1, 0));

        vm.prank(admin);
        credit.mint(alice, 1e18);

        vm.prank(admin);
        vm.expectRevert(ProposalTokenImpl.ZeroAmount.selector);
        credit.burn(alice, 0);
    }

    function test_TokenImpl_AlreadyInitialized_Reverts() public {
        vm.prank(admin);
        pt.deployForProposal(1, 0, "CR1_0", "LO1_0", "SH1_0");
        ProposalTokenImpl credit = ProposalTokenImpl(pt.creditToken(1, 0));

        vm.expectRevert(ProposalTokenImpl.AlreadyInitialized.selector);
        credit.initialize("X", "X", alice);
    }
}
