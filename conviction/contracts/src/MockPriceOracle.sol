// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { IPriceOracle } from "./IPriceOracle.sol";

/// @notice Keeper-updated ETH/USD price adapter for chains without a supported live feed.
/// @dev The keeper submits a price read from a public market API; updatedAt is stamped on-chain.
contract MockPriceOracle is AccessControl, IPriceOracle {
    using SafeCast for uint256;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    uint8 public constant PRICE_DECIMALS = 8;

    int256 public price;
    uint64 public updatedAt;

    error InvalidPrice();
    error ZeroAddress();

    event PriceUpdated(int256 price, uint64 updatedAt, address indexed keeper);

    constructor(address initialAdmin, address keeper) {
        if (initialAdmin == address(0) || keeper == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(KEEPER_ROLE, keeper);
    }

    function updatePrice(int256 price_) external onlyRole(KEEPER_ROLE) {
        if (price_ <= 0) revert InvalidPrice();

        price = price_;
        updatedAt = block.timestamp.toUint64();

        emit PriceUpdated(price_, updatedAt, msg.sender);
    }

    function latestPrice() external view returns (int256 price_, uint8 priceDecimals, uint64 publishedAt) {
        return (price, PRICE_DECIMALS, updatedAt);
    }
}
