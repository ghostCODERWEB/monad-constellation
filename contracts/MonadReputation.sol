// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Monad Reputation
/// @notice Wallet reputation derived from Nansen data, published on Monad so
///         any contract can ask whether a wallet has a track record.
/// @dev Scores run 0..1000. Flags say why: a profitable smart trader and an
///      insider-funded wallet can hold similar balances and very different
///      reputations. Attesters publish in batches; each batch belongs to an
///      epoch whose dataset hash lets anyone check the published file.
contract MonadReputation {
    struct Record {
        uint16 score;
        uint16 flags;
        uint40 updatedAt;
        uint32 epoch;
    }

    uint16 public constant MAX_SCORE = 1000;

    uint16 public constant FLAG_SMART = 1;
    uint16 public constant FLAG_FUND = 2;
    uint16 public constant FLAG_WHALE = 4;
    uint16 public constant FLAG_NAMED = 8;
    uint16 public constant FLAG_TRADER = 16;
    uint16 public constant FLAG_PROFITABLE = 32;
    uint16 public constant FLAG_INSIDER = 64;
    uint16 public constant FLAG_FUNDER = 128;

    address public owner;
    mapping(address => bool) public attesters;
    mapping(address => Record) private records;

    uint32 public epoch;
    bytes32 public datasetHash;
    string public methodology;
    uint256 public walletCount;

    event OwnerChanged(address indexed owner);
    event AttesterSet(address indexed attester, bool allowed);
    event EpochStarted(uint32 indexed epoch, bytes32 datasetHash, string methodology);
    event Attested(address indexed wallet, uint16 score, uint16 flags, uint32 indexed epoch);

    error NotOwner();
    error NotAttester();
    error LengthMismatch();
    error ScoreOutOfRange();
    error ZeroAddress();
    error NoEpoch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAttester() {
        if (!attesters[msg.sender]) revert NotAttester();
        _;
    }

    constructor(string memory methodology_) {
        owner = msg.sender;
        attesters[msg.sender] = true;
        methodology = methodology_;
        emit OwnerChanged(msg.sender);
        emit AttesterSet(msg.sender, true);
    }

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        owner = to;
        emit OwnerChanged(to);
    }

    function setAttester(address attester, bool allowed) external onlyOwner {
        if (attester == address(0)) revert ZeroAddress();
        attesters[attester] = allowed;
        emit AttesterSet(attester, allowed);
    }

    /// @notice Opens a new publication: the hash of the full dataset file.
    function startEpoch(bytes32 hash, string calldata methodology_) external onlyAttester {
        epoch += 1;
        datasetHash = hash;
        if (bytes(methodology_).length > 0) methodology = methodology_;
        emit EpochStarted(epoch, hash, methodology);
    }

    /// @notice Writes a batch of scores into the current epoch.
    function attest(address[] calldata wallets, uint16[] calldata scores, uint16[] calldata flags) external onlyAttester {
        if (epoch == 0) revert NoEpoch();
        uint256 n = wallets.length;
        if (scores.length != n || flags.length != n) revert LengthMismatch();
        uint40 now_ = uint40(block.timestamp);
        for (uint256 i = 0; i < n; i++) {
            address w = wallets[i];
            if (w == address(0)) revert ZeroAddress();
            if (scores[i] > MAX_SCORE) revert ScoreOutOfRange();
            Record storage r = records[w];
            if (r.updatedAt == 0) walletCount += 1;
            r.score = scores[i];
            r.flags = flags[i];
            r.updatedAt = now_;
            r.epoch = epoch;
            emit Attested(w, scores[i], flags[i], epoch);
        }
    }

    function reputationOf(address wallet) external view returns (uint16 score, uint16 flags, uint40 updatedAt, uint32 epoch_) {
        Record memory r = records[wallet];
        return (r.score, r.flags, r.updatedAt, r.epoch);
    }

    /// @notice Scored, at or above `minScore`, and not in an insider cluster.
    function isTrusted(address wallet, uint16 minScore) external view returns (bool) {
        Record memory r = records[wallet];
        return r.updatedAt != 0 && r.score >= minScore && (r.flags & FLAG_INSIDER) == 0;
    }

    function hasFlag(address wallet, uint16 flag) external view returns (bool) {
        return (records[wallet].flags & flag) != 0;
    }
}

interface IMonadReputation {
    function reputationOf(address wallet) external view returns (uint16 score, uint16 flags, uint40 updatedAt, uint32 epoch);
}

/// @title Reputation-priced collateral (demo consumer)
/// @notice How a lending market could price collateral from on-chain
///         reputation: proven wallets post less, insiders post more, and a
///         stale or missing record falls back to the cautious default.
/// @dev Holds no funds and moves none. It exists to show the integration.
contract ReputationCollateral {
    IMonadReputation public immutable registry;

    uint16 internal constant FLAG_INSIDER = 64;
    uint256 public constant BASE_BPS = 15_000;    // 150%: unknown wallets
    uint256 public constant FLOOR_BPS = 11_000;   // 110%: the best reputation
    uint256 public constant INSIDER_BPS = 20_000; // 200%: insider clusters
    uint256 public constant STALE_AFTER = 7 days;

    constructor(IMonadReputation registry_) {
        registry = registry_;
    }

    /// @notice Collateral required, in basis points of the loan.
    function collateralBps(address wallet) public view returns (uint256) {
        (uint16 score, uint16 flags, uint40 updatedAt, ) = registry.reputationOf(wallet);
        if (updatedAt == 0 || block.timestamp > uint256(updatedAt) + STALE_AFTER) return BASE_BPS;
        if (flags & FLAG_INSIDER != 0) return INSIDER_BPS;
        return BASE_BPS - (uint256(score) * (BASE_BPS - FLOOR_BPS)) / 1000;
    }

    /// @notice The most a wallet could borrow against `collateralValue`.
    function maxBorrow(address wallet, uint256 collateralValue) external view returns (uint256) {
        return (collateralValue * 10_000) / collateralBps(wallet);
    }
}
