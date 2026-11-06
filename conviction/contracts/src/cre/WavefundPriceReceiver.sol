// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ReceiverTemplate } from "./ReceiverTemplate.sol";
import { MockPriceOracle } from "../MockPriceOracle.sol";

/// @notice Receives CRE price reports for the existing Wavefund oracle.
/// @dev Simulation does not supply workflow identity metadata. The transmitter check
/// is a testnet-only safeguard. Production must use the real forwarder and workflow
/// identity checks, and disable the transmitter check.
contract WavefundPriceReceiver is ReceiverTemplate {
    MockPriceOracle public immutable oracle;
    uint64 public immutable expectedChainSelector;
    address public allowedTransmitter;
    int256 public lastPrice;
    uint64 public lastScheduledAt;
    uint64 public lastObservedAt;

    error InvalidOracle();
    error InvalidChainSelector(uint64 received, uint64 expected);
    error InvalidPrice();
    error InvalidSchedule(uint64 scheduledAt, uint64 lastScheduledAt);
    error FutureSchedule(uint64 scheduledAt);
    error FutureObservation(uint64 observedAt);
    error StaleObservation(uint64 observedAt);
    error InvalidTransmitter(address transmitter, address expected);
    error InsufficientSources(uint32 sourceCount);
    error PriceMoveTooLarge(int256 previousPrice, int256 price);

    event CREPriceReported(int256 price, uint64 observedAt, uint64 scheduledAt, uint32 sourceCount);
    event AllowedTransmitterUpdated(address indexed previousTransmitter, address indexed newTransmitter);
    event OracleAccessRevoked();

    constructor(address forwarder, address oracle_, uint64 expectedChainSelector_)
        ReceiverTemplate(forwarder)
    {
        if (oracle_ == address(0)) revert InvalidOracle();
        oracle = MockPriceOracle(oracle_);
        expectedChainSelector = expectedChainSelector_;
    }

    /// @notice Restricts simulation reports to a transaction origin, or disables the check with address(0).
    function setAllowedTransmitter(address transmitter) external onlyOwner {
        address previous = allowedTransmitter;
        allowedTransmitter = transmitter;
        emit AllowedTransmitterUpdated(previous, transmitter);
    }

    /// @notice Renounces this receiver's oracle role without affecting other keepers.
    function revokeOracleAccess() external onlyOwner {
        oracle.renounceRole(oracle.KEEPER_ROLE(), address(this));
        emit OracleAccessRevoked();
    }

    function _processReport(bytes calldata report) internal override {
        address transmitter = allowedTransmitter;
        if (transmitter != address(0) && tx.origin != transmitter) {
            revert InvalidTransmitter(tx.origin, transmitter);
        }
        (int256 price, uint64 observedAt, uint64 scheduledAt, uint64 chainSelector, uint32 sourceCount) =
            abi.decode(report, (int256, uint64, uint64, uint64, uint32));

        if (chainSelector != expectedChainSelector) revert InvalidChainSelector(chainSelector, expectedChainSelector);
        if (price <= 0) revert InvalidPrice();
        if (scheduledAt <= lastScheduledAt) revert InvalidSchedule(scheduledAt, lastScheduledAt);
        if (uint256(scheduledAt) > block.timestamp + 60) revert FutureSchedule(scheduledAt);
        if (observedAt > block.timestamp) revert FutureObservation(observedAt);
        if (uint256(observedAt) + 120 < block.timestamp) revert StaleObservation(observedAt);
        if (sourceCount < 2) revert InsufficientSources(sourceCount);

        (int256 currentPrice,,) = oracle.latestPrice();
        if (currentPrice < 0) revert InvalidPrice();
        if (currentPrice != 0) {
            uint256 current = uint256(currentPrice);
            uint256 next = uint256(price);
            uint256 difference = next > current ? next - current : current - next;
            if (difference > current / 5) revert PriceMoveTooLarge(currentPrice, price);
        }

        oracle.updatePrice(price);
        lastPrice = price;
        lastScheduledAt = scheduledAt;
        lastObservedAt = observedAt;
        emit CREPriceReported(price, observedAt, scheduledAt, sourceCount);
    }
}
