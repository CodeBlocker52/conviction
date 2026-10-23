// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IProposalMarket
/// @notice Interface abstracting per-proposal price discovery and position trading.
/// @dev Phase A implementation is an in-contract constant-product AMM. Phase B may route to Uniswap v4.
interface IProposalMarket {
    /// @notice Buy LONG tokens with credits.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param creditsIn Credits spent.
    /// @param minLongOut Minimum acceptable LONG output for slippage protection.
    /// @return longOut LONG tokens received.
    function tradeBuyLong(uint256 roundId, uint256 proposalId, uint256 creditsIn, uint256 minLongOut)
        external
        returns (uint256 longOut);

    /// @notice Buy SHORT exposure with credits.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param creditsIn Credits spent.
    /// @param minSetsOut Minimum acceptable SHORT output for slippage protection.
    /// @return setsOut SHORT tokens received.
    function tradeBuyShort(uint256 roundId, uint256 proposalId, uint256 creditsIn, uint256 minSetsOut)
        external
        returns (uint256 setsOut);

    /// @notice Sell LONG tokens back for credits.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param longIn LONG amount sold.
    /// @param minCreditsOut Minimum acceptable credits output for slippage protection.
    /// @return creditsOut Credits received.
    function tradeSellLong(uint256 roundId, uint256 proposalId, uint256 longIn, uint256 minCreditsOut)
        external
        returns (uint256 creditsOut);

    /// @notice Sell SHORT exposure for credits.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param setsIn SHORT amount sold.
    /// @param minCreditsOut Minimum acceptable credits output for slippage protection.
    /// @return creditsOut Credits received.
    function tradeSellShort(uint256 roundId, uint256 proposalId, uint256 setsIn, uint256 minCreditsOut)
        external
        returns (uint256 creditsOut);

    /// @notice Returns the current spot price of LONG in credits-per-LONG, scaled 1e18.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @return price Spot price scaled by 1e18.
    function spotPrice(uint256 roundId, uint256 proposalId) external view returns (uint256 price);

    /// @notice Returns the TWAP of LONG price over a time window, scaled 1e18.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param windowStart Window start timestamp.
    /// @param windowEnd Window end timestamp.
    /// @return priceTwap TWAP scaled by 1e18.
    function twap(uint256 roundId, uint256 proposalId, uint256 windowStart, uint256 windowEnd)
        external
        view
        returns (uint256 priceTwap);

    /// @notice Seeds initial liquidity for a proposal market.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param creditAmount Initial credit-side liquidity amount.
    /// @param longAmount Initial long-side liquidity amount.
    function seedLiquidity(uint256 roundId, uint256 proposalId, uint256 creditAmount, uint256 longAmount) external;

    /// @notice Closes TWAP accumulation at trading end.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param tradingEnd Trading end timestamp.
    function closeTwapWindow(uint256 roundId, uint256 proposalId, uint256 tradingEnd) external;
}
