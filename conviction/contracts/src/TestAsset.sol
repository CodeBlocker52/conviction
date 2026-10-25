// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestAsset
/// @notice Mock ERC-20 token used as tETH in the Wavefund Phase A demo.
/// @dev This token is not USDC. Minting and burning are controlled by PEG_KEEPER_ROLE.
contract TestAsset is ERC20, AccessControl {
    /// @notice Role allowed to mint and burn supply.
    bytes32 public constant PEG_KEEPER_ROLE = keccak256("PEG_KEEPER_ROLE");

    /// @notice Thrown when a required address argument is zero.
    error ZeroAddress();

    /// @notice Thrown when a required amount argument is zero.
    error ZeroAmount();

    /// @notice Deploys the token and grants admin + peg keeper permissions.
    /// @param initialAdmin Address that receives DEFAULT_ADMIN_ROLE and PEG_KEEPER_ROLE.
    constructor(address initialAdmin) ERC20("tETH", "tETH") {
        if (initialAdmin == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(PEG_KEEPER_ROLE, initialAdmin);
    }

    /// @notice Mints new tETH to a recipient.
    /// @param to Recipient of minted tokens.
    /// @param amount Amount to mint in 18-decimal token units.
    function mint(address to, uint256 amount) external onlyRole(PEG_KEEPER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
    }

    /// @notice Burns tETH from an address.
    /// @param from Address whose balance is burned.
    /// @param amount Amount to burn in 18-decimal token units.
    function burn(address from, uint256 amount) external onlyRole(PEG_KEEPER_ROLE) {
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _burn(from, amount);
    }
}
