// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IPriceOracle {
    function latestPrice() external view returns (int256 price, uint8 priceDecimals, uint64 updatedAt);
}
