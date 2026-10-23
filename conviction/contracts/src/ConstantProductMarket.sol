// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IProposalMarket} from "./IProposalMarket.sol";

/// @title ConstantProductMarket
/// @notice Phase A in-contract x*y=k market for proposal LONG pricing and simplified SHORT bookkeeping.
contract ConstantProductMarket is IProposalMarket, Ownable {
    /// @notice Trading fee in basis points.
    uint16 public immutable feeBps;

    /// @notice Per-proposal market state.
    struct Market {
        uint128 creditReserve;
        uint128 longReserve;
        uint128 shortIssued;
        bool seeded;
        uint256 twapAccumulator;
        uint256 twapLastPrice;
        uint256 twapLastUpdate;
    }

    /// @notice Market state by round id and proposal id.
    mapping(uint256 roundId => mapping(uint256 proposalId => Market)) public markets;

    /// @notice Thrown when market for proposal is not seeded.
    error NotSeeded();

    /// @notice Thrown when market for proposal has already been seeded.
    error AlreadySeeded();

    /// @notice Thrown when output amount is below minimum slippage bounds.
    error InsufficientOutput();

    /// @notice Thrown when amount input is zero.
    error ZeroAmount();

    /// @notice Emitted when market liquidity is seeded.
    event LiquiditySeeded(uint256 indexed roundId, uint256 indexed proposalId, uint256 credits, uint256 longTokens);

    /// @notice Emitted for a LONG buy trade.
    event LongBought(uint256 indexed roundId, uint256 indexed proposalId, uint256 creditsIn, uint256 longOut);

    /// @notice Emitted for a SHORT buy trade.
    event ShortBought(uint256 indexed roundId, uint256 indexed proposalId, uint256 creditsIn, uint256 setsOut);

    /// @notice Emitted for a LONG sell trade.
    event LongSold(uint256 indexed roundId, uint256 indexed proposalId, uint256 longIn, uint256 creditsOut);

    /// @notice Emitted for a SHORT sell trade.
    event ShortSold(uint256 indexed roundId, uint256 indexed proposalId, uint256 setsIn, uint256 creditsOut);

    /// @notice Deploys the market.
    /// @param feeBps_ Trading fee in basis points.
    /// @param initialOwner Owner address allowed to execute market operations.
    constructor(uint16 feeBps_, address initialOwner) Ownable(initialOwner) {
        require(feeBps_ < 10_000, "fee too high");
        feeBps = feeBps_;
    }

    /// @inheritdoc IProposalMarket
    function seedLiquidity(uint256 roundId, uint256 proposalId, uint256 creditAmount, uint256 longAmount)
        external
        override
        onlyOwner
    {
        if (creditAmount == 0 || longAmount == 0) revert ZeroAmount();

        Market storage m = markets[roundId][proposalId];
        if (m.seeded) revert AlreadySeeded();

        m.creditReserve = uint128(creditAmount);
        m.longReserve = uint128(longAmount);
        m.seeded = true;
        m.twapLastPrice = (creditAmount * 1e18) / longAmount;
        m.twapLastUpdate = block.timestamp;

        emit LiquiditySeeded(roundId, proposalId, creditAmount, longAmount);
    }

    /// @inheritdoc IProposalMarket
    function tradeBuyLong(uint256 roundId, uint256 proposalId, uint256 creditsIn, uint256 minLongOut)
        external
        override
        onlyOwner
        returns (uint256 longOut)
    {
        if (creditsIn == 0) revert ZeroAmount();

        Market storage m = markets[roundId][proposalId];
        if (!m.seeded) revert NotSeeded();

        _updateTwap(roundId, proposalId);

        uint256 creditsInTimesDenom = creditsIn * (10_000 - feeBps);
        longOut = (uint256(m.longReserve) * creditsInTimesDenom)
            / (uint256(m.creditReserve) * 10_000 + creditsInTimesDenom);

        if (longOut < minLongOut || longOut == 0) revert InsufficientOutput();

        uint256 creditsInAfterFee = creditsInTimesDenom / 10_000;
        m.creditReserve = uint128(uint256(m.creditReserve) + creditsInAfterFee);
        m.longReserve = uint128(uint256(m.longReserve) - longOut);

        emit LongBought(roundId, proposalId, creditsIn, longOut);
    }

    /// @inheritdoc IProposalMarket
    function tradeBuyShort(uint256 roundId, uint256 proposalId, uint256 creditsIn, uint256 minSetsOut)
        external
        override
        onlyOwner
        returns (uint256 setsOut)
    {
        if (creditsIn == 0) revert ZeroAmount();

        Market storage m = markets[roundId][proposalId];
        if (!m.seeded) revert NotSeeded();

        _updateTwap(roundId, proposalId);

        setsOut = creditsIn;

        if (setsOut < minSetsOut) revert InsufficientOutput();
        if (uint256(m.creditReserve) < creditsIn) revert InsufficientOutput();

        m.creditReserve = uint128(uint256(m.creditReserve) - creditsIn);
        m.shortIssued = uint128(uint256(m.shortIssued) + setsOut);

        emit ShortBought(roundId, proposalId, creditsIn, setsOut);
    }

    /// @inheritdoc IProposalMarket
    function tradeSellLong(uint256 roundId, uint256 proposalId, uint256 longIn, uint256 minCreditsOut)
        external
        override
        onlyOwner
        returns (uint256 creditsOut)
    {
        if (longIn == 0) revert ZeroAmount();

        Market storage m = markets[roundId][proposalId];
        if (!m.seeded) revert NotSeeded();

        _updateTwap(roundId, proposalId);

        uint256 longInTimesDenom = longIn * (10_000 - feeBps);
        creditsOut = (uint256(m.creditReserve) * longInTimesDenom)
            / (uint256(m.longReserve) * 10_000 + longInTimesDenom);

        if (creditsOut < minCreditsOut || creditsOut == 0) revert InsufficientOutput();

        uint256 longInAfterFee = longInTimesDenom / 10_000;
        m.longReserve = uint128(uint256(m.longReserve) + longInAfterFee);
        m.creditReserve = uint128(uint256(m.creditReserve) - creditsOut);

        emit LongSold(roundId, proposalId, longIn, creditsOut);
    }

    /// @inheritdoc IProposalMarket
    function tradeSellShort(uint256 roundId, uint256 proposalId, uint256 setsIn, uint256 minCreditsOut)
        external
        override
        onlyOwner
        returns (uint256 creditsOut)
    {
        if (setsIn == 0) revert ZeroAmount();

        Market storage m = markets[roundId][proposalId];
        if (!m.seeded) revert NotSeeded();

        _updateTwap(roundId, proposalId);

        creditsOut = setsIn;
        if (creditsOut < minCreditsOut) revert InsufficientOutput();
        if (uint256(m.shortIssued) < setsIn) revert InsufficientOutput();

        m.creditReserve = uint128(uint256(m.creditReserve) + creditsOut);
        m.shortIssued = uint128(uint256(m.shortIssued) - setsIn);

        emit ShortSold(roundId, proposalId, setsIn, creditsOut);
    }

    /// @inheritdoc IProposalMarket
    function spotPrice(uint256 roundId, uint256 proposalId) external view override returns (uint256) {
        Market storage m = markets[roundId][proposalId];
        if (!m.seeded) revert NotSeeded();
        return _spot(m);
    }

    /// @inheritdoc IProposalMarket
    function twap(uint256 roundId, uint256 proposalId, uint256 windowStart, uint256 windowEnd)
        external
        view
        override
        returns (uint256 priceTwap)
    {
        if (windowEnd <= windowStart) revert ZeroAmount();

        Market storage m = markets[roundId][proposalId];
        if (!m.seeded) revert NotSeeded();

        uint256 accumulator = m.twapAccumulator;
        uint256 lastUpdate = m.twapLastUpdate;
        uint256 lastPrice = m.twapLastPrice;

        if (windowEnd > lastUpdate) {
            accumulator += lastPrice * (windowEnd - lastUpdate);
        }

        uint256 elapsed = windowEnd - windowStart;
        if (elapsed == 0) revert ZeroAmount();
        priceTwap = accumulator / elapsed;
    }

    /// @inheritdoc IProposalMarket
    function closeTwapWindow(uint256 roundId, uint256 proposalId, uint256 tradingEnd) external override onlyOwner {
        Market storage m = markets[roundId][proposalId];
        if (!m.seeded) revert NotSeeded();

        if (m.twapLastUpdate < tradingEnd) {
            m.twapAccumulator += m.twapLastPrice * (tradingEnd - m.twapLastUpdate);
            m.twapLastUpdate = tradingEnd;
        }
    }

    /// @notice Updates TWAP accumulator to current timestamp.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    function _updateTwap(uint256 roundId, uint256 proposalId) internal {
        Market storage m = markets[roundId][proposalId];
        if (!m.seeded) return;

        if (m.twapLastUpdate == 0) {
            m.twapLastPrice = _spot(m);
            m.twapLastUpdate = block.timestamp;
            return;
        }

        if (block.timestamp > m.twapLastUpdate) {
            m.twapAccumulator += m.twapLastPrice * (block.timestamp - m.twapLastUpdate);
            m.twapLastUpdate = block.timestamp;
        }

        m.twapLastPrice = _spot(m);
    }

    /// @notice Computes market spot price = creditReserve * 1e18 / longReserve.
    /// @param m Market storage pointer.
    /// @return price Spot price scaled by 1e18.
    function _spot(Market storage m) internal view returns (uint256 price) {
        price = (uint256(m.creditReserve) * 1e18) / uint256(m.longReserve);
    }
}
