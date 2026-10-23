// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TestAsset} from "../src/TestAsset.sol";

contract TestAssetTest is Test {
    TestAsset internal asset;
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob   = makeAddr("bob");

    bytes32 internal constant PEG_KEEPER_ROLE = keccak256("PEG_KEEPER_ROLE");

    function setUp() public {
        asset = new TestAsset(admin);
    }

    // ─────────────────────────────────────────────────────────
    // Deployment & initialization
    // ─────────────────────────────────────────────────────────

    function test_Constructor_AdminReceivesRoles() public view {
        assertTrue(asset.hasRole(asset.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(asset.hasRole(PEG_KEEPER_ROLE, admin));
    }

    function test_Constructor_ZeroAdmin_Reverts() public {
        vm.expectRevert(TestAsset.ZeroAddress.selector);
        new TestAsset(address(0));
    }

    function test_Constructor_NameAndSymbol() public view {
        assertEq(asset.name(), "tETH");
        assertEq(asset.symbol(), "tETH");
    }

    // ─────────────────────────────────────────────────────────
    // mint — happy path
    // ─────────────────────────────────────────────────────────

    function test_Mint_HappyPath() public {
        vm.prank(admin);
        asset.mint(alice, 1e18);
        assertEq(asset.balanceOf(alice), 1e18);
        assertEq(asset.totalSupply(), 1e18);
    }

    function test_Mint_EmitsTransfer() public {
        vm.prank(admin);
        vm.expectEmit(true, true, false, true, address(asset));
        emit Transfer(address(0), alice, 1e18);
        asset.mint(alice, 1e18);
    }

    // ─────────────────────────────────────────────────────────
    // mint — revert paths
    // ─────────────────────────────────────────────────────────

    function test_Mint_NotKeeper_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                PEG_KEEPER_ROLE
            )
        );
        asset.mint(alice, 1e18);
    }

    function test_Mint_ZeroAmount_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(TestAsset.ZeroAmount.selector);
        asset.mint(alice, 0);
    }

    function test_Mint_ZeroAddress_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(TestAsset.ZeroAddress.selector);
        asset.mint(address(0), 1e18);
    }

    // ─────────────────────────────────────────────────────────
    // burn — happy path
    // ─────────────────────────────────────────────────────────

    function test_Burn_HappyPath() public {
        vm.startPrank(admin);
        asset.mint(alice, 5e18);
        asset.burn(alice, 2e18);
        vm.stopPrank();

        assertEq(asset.balanceOf(alice), 3e18);
        assertEq(asset.totalSupply(), 3e18);
    }

    function test_Burn_EmitsTransfer() public {
        vm.startPrank(admin);
        asset.mint(alice, 5e18);
        vm.expectEmit(true, true, false, true, address(asset));
        emit Transfer(alice, address(0), 2e18);
        asset.burn(alice, 2e18);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────
    // burn — revert paths
    // ─────────────────────────────────────────────────────────

    function test_Burn_NotKeeper_Reverts() public {
        vm.prank(admin);
        asset.mint(alice, 1e18);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                PEG_KEEPER_ROLE
            )
        );
        asset.burn(alice, 1e18);
    }

    function test_Burn_ZeroAmount_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(TestAsset.ZeroAmount.selector);
        asset.burn(alice, 0);
    }

    function test_Burn_ZeroAddress_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(TestAsset.ZeroAddress.selector);
        asset.burn(address(0), 1e18);
    }

    // ─────────────────────────────────────────────────────────
    // Fuzz: mint/burn are inverse
    // ─────────────────────────────────────────────────────────

    function testFuzz_MintBurnInverse(uint128 amount) public {
        vm.assume(amount > 0);
        vm.startPrank(admin);
        asset.mint(alice, amount);
        asset.burn(alice, amount);
        vm.stopPrank();
        assertEq(asset.balanceOf(alice), 0);
        assertEq(asset.totalSupply(), 0);
    }

    // ─────────────────────────────────────────────────────────
    // Role management
    // ─────────────────────────────────────────────────────────

    function test_GrantRole_NewKeeper() public {
        vm.prank(admin);
        asset.grantRole(PEG_KEEPER_ROLE, bob);

        vm.prank(bob);
        asset.mint(alice, 1e18);
        assertEq(asset.balanceOf(alice), 1e18);
    }

    // needed to match OZ Transfer event signature
    event Transfer(address indexed from, address indexed to, uint256 value);
}
