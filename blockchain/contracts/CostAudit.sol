// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * CostAudit — immutable cost report hash registry.
 *
 * Stores SHA-256 hashes of cloud cost reports and PR diffs on-chain.
 * Only the contract owner (the backend wallet) can write records.
 * Anyone can read records for independent verification.
 *
 * Deploy to Polygon Mumbai testnet for gas-efficient tamper-proof anchoring.
 */
contract CostAudit {
    address public owner;

    struct AuditRecord {
        bytes32 hash;
        uint256 timestamp;
        string  recordType; // "report" | "pr-diff"
    }

    mapping(string => AuditRecord) private records;

    event HashStored(string indexed id, bytes32 hash, uint256 ts);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "CostAudit: caller is not owner");
        _;
    }

    /**
     * Store a SHA-256 hash for a report or PR diff.
     * @param id         Unique identifier (report UUID or "pr-42")
     * @param hash       32-byte SHA-256 hash
     * @param recordType "report" or "pr-diff"
     */
    function storeHash(
        string calldata id,
        bytes32 hash,
        string calldata recordType
    ) external onlyOwner {
        records[id] = AuditRecord(hash, block.timestamp, recordType);
        emit HashStored(id, hash, block.timestamp);
    }

    /**
     * Retrieve an on-chain record.
     * Returns (bytes32(0), 0, "") if the record doesn't exist.
     */
    function getHash(
        string calldata id
    ) external view returns (bytes32, uint256, string memory) {
        AuditRecord memory r = records[id];
        return (r.hash, r.timestamp, r.recordType);
    }

    /**
     * Transfer ownership to a new address.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "CostAudit: zero address");
        owner = newOwner;
    }
}
