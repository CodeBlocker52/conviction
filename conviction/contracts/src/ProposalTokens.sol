// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ProposalTokenImpl
/// @notice Minimal cloneable ERC-20 implementation used for per-proposal CREDIT, LONG, and SHORT tokens.
/// @dev Uses initialize() in place of constructor for EIP-1167 clones.
contract ProposalTokenImpl is ERC20 {
    /// @notice Address allowed to mint and burn this token.
    address public minter;

    /// @notice Human-readable token name set during initialization.
    string private _tokenName;

    /// @notice Short token ticker set during initialization.
    string private _tokenSymbol;

    /// @notice Tracks whether initialize has been called.
    bool public initialized;

    /// @notice Thrown when caller is not the token minter.
    error NotMinter();

    /// @notice Thrown when initialize is called after initialization.
    error AlreadyInitialized();

    /// @notice Thrown when a required address argument is zero.
    error ZeroAddress();

    /// @notice Thrown when a required amount argument is zero.
    error ZeroAmount();

    /// @notice Deploys base implementation with placeholder metadata.
    /// @dev Clones override metadata via initialize().
    constructor() ERC20("UNINITIALIZED", "UNINITIALIZED") {}

    /// @notice Initializes clone metadata and authorized minter.
    /// @param name_ ERC-20 token name.
    /// @param symbol_ ERC-20 token symbol.
    /// @param minter_ Address allowed to mint and burn.
    function initialize(string memory name_, string memory symbol_, address minter_) external {
        if (initialized) revert AlreadyInitialized();
        if (minter_ == address(0)) revert ZeroAddress();

        _tokenName = name_;
        _tokenSymbol = symbol_;
        minter = minter_;
        initialized = true;
    }

    /// @notice Returns token name.
    function name() public view override returns (string memory) {
        return _tokenName;
    }

    /// @notice Returns token symbol.
    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }

    /// @notice Mints tokens to a recipient.
    /// @param to Recipient address.
    /// @param amount Amount to mint.
    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
    }

    /// @notice Burns tokens from an address.
    /// @param from Address to burn from.
    /// @param amount Amount to burn.
    function burn(address from, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _burn(from, amount);
    }
}

/// @title ProposalTokens
/// @notice Factory for per-proposal CREDIT, LONG, and SHORT ERC-20 token clones.
/// @dev Uses EIP-1167 minimal proxies and role-gated deployment flow.
contract ProposalTokens is AccessControl {
    /// @notice Role allowed to deploy token sets for proposals.
    bytes32 public constant QUANTUM_ROUND_ROLE = keccak256("QUANTUM_ROUND_ROLE");

    /// @notice Mapping from round/proposal id to deployed CREDIT token address.
    mapping(uint256 roundId => mapping(uint256 proposalId => address)) public creditToken;

    /// @notice Mapping from round/proposal id to deployed LONG token address.
    mapping(uint256 roundId => mapping(uint256 proposalId => address)) public longToken;

    /// @notice Mapping from round/proposal id to deployed SHORT token address.
    mapping(uint256 roundId => mapping(uint256 proposalId => address)) public shortToken;

    /// @notice Address of the clone implementation used for all proposal tokens.
    address public immutable implementation;

    /// @notice Thrown when trying to deploy token set for an already-initialized proposal.
    error AlreadyDeployed();

    /// @notice Thrown when token addresses for a proposal have not been deployed.
    error NotDeployed();

    /// @notice Thrown when a required address argument is zero.
    error ZeroAddress();

    /// @notice Emitted when all token clones are deployed for a proposal.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param credit Deployed CREDIT token address.
    /// @param long Deployed LONG token address.
    /// @param short Deployed SHORT token address.
    event ProposalTokensDeployed(
        uint256 indexed roundId,
        uint256 indexed proposalId,
        address indexed credit,
        address long,
        address short
    );

    /// @notice Deploys the token implementation and grants factory roles.
    /// @param initialAdmin Address that receives DEFAULT_ADMIN_ROLE and QUANTUM_ROUND_ROLE.
    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) revert ZeroAddress();

        implementation = address(new ProposalTokenImpl());

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(QUANTUM_ROUND_ROLE, initialAdmin);
    }

    /// @notice Deploys CREDIT, LONG, and SHORT token clones for a proposal.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @param creditSymbol Symbol for CREDIT token clone.
    /// @param longSymbol Symbol for LONG token clone.
    /// @param shortSymbol Symbol for SHORT token clone.
    function deployForProposal(
        uint256 roundId,
        uint256 proposalId,
        string calldata creditSymbol,
        string calldata longSymbol,
        string calldata shortSymbol
    ) external onlyRole(QUANTUM_ROUND_ROLE) {
        if (
            creditToken[roundId][proposalId] != address(0) || longToken[roundId][proposalId] != address(0)
                || shortToken[roundId][proposalId] != address(0)
        ) {
            revert AlreadyDeployed();
        }

        string memory idString = _toString(roundId);
        string memory proposalString = _toString(proposalId);

        address credit = _deployClone();
        address long = _deployClone();
        address short = _deployClone();

        creditToken[roundId][proposalId] = credit;
        longToken[roundId][proposalId] = long;
        shortToken[roundId][proposalId] = short;

        ProposalTokenImpl(credit).initialize(
            string(abi.encodePacked("Wavefund Round ", idString, " Proposal ", proposalString, " CREDIT")),
            creditSymbol,
            msg.sender
        );
        ProposalTokenImpl(long).initialize(
            string(abi.encodePacked("Wavefund Round ", idString, " Proposal ", proposalString, " LONG")),
            longSymbol,
            msg.sender
        );
        ProposalTokenImpl(short).initialize(
            string(abi.encodePacked("Wavefund Round ", idString, " Proposal ", proposalString, " SHORT")),
            shortSymbol,
            msg.sender
        );

        emit ProposalTokensDeployed(roundId, proposalId, credit, long, short);
    }

    /// @notice Returns deployed token set for a proposal.
    /// @param roundId Round identifier.
    /// @param proposalId Proposal identifier.
    /// @return credit Address of CREDIT token.
    /// @return long Address of LONG token.
    /// @return short Address of SHORT token.
    function getPair(uint256 roundId, uint256 proposalId)
        external
        view
        returns (address credit, address long, address short)
    {
        credit = creditToken[roundId][proposalId];
        long = longToken[roundId][proposalId];
        short = shortToken[roundId][proposalId];
        if (credit == address(0) || long == address(0) || short == address(0)) revert NotDeployed();
    }

    /// @notice Deploys one proposal token clone.
    /// @return deployed Address of the deployed clone.
    function _deployClone() private returns (address deployed) {
        deployed = Clones.clone(implementation);
    }

    /// @notice Converts uint256 to decimal string.
    /// @param value Integer to convert.
    /// @return str Decimal string representation.
    function _toString(uint256 value) internal pure returns (string memory str) {
        if (value == 0) return "0";

        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint8(value % 10)));
            value /= 10;
        }
        str = string(buffer);
    }
}
