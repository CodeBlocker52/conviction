// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";

import { QuantumLP } from "../src/QuantumLP.sol";
import { MockUSDC } from "../test-helpers/MockUSDC.sol";

address constant QUANTUM_LP_TEST_USDC = 0x3600000000000000000000000000000000000000;

contract QuantumLPTest is Test {
    MockUSDC private usdc;
    QuantumLP private lp;
    address private provider = makeAddr("provider");
    address private admin = makeAddr("admin");

    function setUp() public {
        MockUSDC mockUsdc = new MockUSDC();
        vm.etch(QUANTUM_LP_TEST_USDC, address(mockUsdc).code);
        usdc = MockUSDC(QUANTUM_LP_TEST_USDC);
        lp = new QuantumLP(admin);
    }

    function test_ProviderCanWithdrawWithoutGlobalToggle() public {
        uint256 amount = 25_000_000;
        usdc.mint(provider, amount);
        vm.startPrank(provider);
        usdc.approve(address(lp), amount);
        lp.deposit(amount);
        lp.withdraw();
        vm.stopPrank();

        assertEq(usdc.balanceOf(provider), amount);
        assertEq(lp.lpBalances(provider), 0);
        assertEq(lp.totalLP(), 0);
    }

    function test_WithdrawWithoutBalanceReverts() public {
        vm.prank(provider);
        vm.expectRevert(QuantumLP.NoBalance.selector);
        lp.withdraw();
    }
}
