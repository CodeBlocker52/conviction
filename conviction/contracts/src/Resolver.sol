// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

import { QuantumRound } from "./QuantumRound.sol";

/// @title Resolver
/// @notice Forwards realised return values from RESOLVER_ROLE to QuantumRound settlement.
contract Resolver is AccessControl {
    /// @notice Role allowed to submit realised returns.
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");

    /// @notice Tracks whether a given round id has already been resolved.
    mapping(uint256 roundId => bool) public resolved;

    /// @notice QuantumRound settlement target.
    QuantumRound public immutable quantumRound;

    /// @notice Thrown when attempting to resolve an already-resolved round.
    error AlreadyResolved();

    /// @notice Thrown when a required address argument is zero.
    error ZeroAddress();

    /// @notice Emitted when realised return for a round is submitted.
    /// @param roundId Round identifier.
    /// @param realisedReturn Realised return value submitted.
    /// @param resolver Caller that submitted the return.
    event ReturnSubmitted(uint256 indexed roundId, int256 realisedReturn, address indexed resolver);

    /// @notice Deploys resolver.
    /// @param quantumRound_ Address of QuantumRound contract.
    /// @param initialAdmin Address granted admin + resolver roles.
    constructor(address quantumRound_, address initialAdmin) {
        if (quantumRound_ == address(0) || initialAdmin == address(0)) revert ZeroAddress();

        quantumRound = QuantumRound(quantumRound_);

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
    }

    /// @notice Submits realised return and forwards settlement call to QuantumRound.
    /// @param roundId Round identifier.
    /// @param realisedReturn Realised return in 1e18 scale.
    function submitReturn(uint256 roundId, int256 realisedReturn) external onlyRole(RESOLVER_ROLE) {
        if (resolved[roundId]) revert AlreadyResolved();

        resolved[roundId] = true;
        quantumRound.settle(roundId, realisedReturn);

        emit ReturnSubmitted(roundId, realisedReturn, msg.sender);
    }
}
