// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice Minimal ERC-20 mock with unrestricted mint, used for Foundry tests only.
/// @dev 6 decimals to match Arc testnet USDC.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Free-mint for test setup.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
