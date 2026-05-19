// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract S3AgentIdentityRegistry is Ownable {
    error IdentityInvalidAddress();
    error IdentityEmptyId();
    error IdentityAlreadyRegistered();
    error IdentityNotFound();
    error IdentityIdTaken();

    event AgentRegistered(bytes32 indexed idHash, string erc8004Id, address indexed wallet, bytes32 metadataHash);
    event AgentWalletUpdated(bytes32 indexed idHash, address indexed previousWallet, address indexed newWallet);
    event AgentMetadataUpdated(bytes32 indexed idHash, bytes32 previousMetadataHash, bytes32 newMetadataHash);
    event AgentStatusUpdated(bytes32 indexed idHash, bool active);

    struct AgentIdentity {
        string erc8004Id;
        address wallet;
        bytes32 metadataHash;
        bool active;
    }

    mapping(bytes32 => AgentIdentity) private identities;
    mapping(bytes32 => bool) public exists;
    mapping(address => bytes32) public walletToId;

    constructor(address owner_) Ownable(owner_) {}

    function registerAgent(string calldata erc8004Id, address wallet, bytes32 metadataHash) external onlyOwner {
        if (wallet == address(0)) revert IdentityInvalidAddress();
        if (bytes(erc8004Id).length == 0) revert IdentityEmptyId();

        bytes32 idHash = keccak256(bytes(erc8004Id));
        if (exists[idHash]) revert IdentityAlreadyRegistered();
        if (walletToId[wallet] != bytes32(0)) revert IdentityIdTaken();

        identities[idHash] = AgentIdentity({
            erc8004Id: erc8004Id,
            wallet: wallet,
            metadataHash: metadataHash,
            active: true
        });
        exists[idHash] = true;
        walletToId[wallet] = idHash;

        emit AgentRegistered(idHash, erc8004Id, wallet, metadataHash);
    }

    function updateWallet(string calldata erc8004Id, address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert IdentityInvalidAddress();
        bytes32 idHash = keccak256(bytes(erc8004Id));
        if (!exists[idHash]) revert IdentityNotFound();
        if (walletToId[newWallet] != bytes32(0)) revert IdentityIdTaken();

        AgentIdentity storage record = identities[idHash];
        address previousWallet = record.wallet;
        record.wallet = newWallet;

        delete walletToId[previousWallet];
        walletToId[newWallet] = idHash;

        emit AgentWalletUpdated(idHash, previousWallet, newWallet);
    }

    function setMetadataHash(string calldata erc8004Id, bytes32 metadataHash) external onlyOwner {
        bytes32 idHash = keccak256(bytes(erc8004Id));
        if (!exists[idHash]) revert IdentityNotFound();

        AgentIdentity storage record = identities[idHash];
        bytes32 previous = record.metadataHash;
        record.metadataHash = metadataHash;

        emit AgentMetadataUpdated(idHash, previous, metadataHash);
    }

    function setStatus(string calldata erc8004Id, bool active) external onlyOwner {
        bytes32 idHash = keccak256(bytes(erc8004Id));
        if (!exists[idHash]) revert IdentityNotFound();

        identities[idHash].active = active;
        emit AgentStatusUpdated(idHash, active);
    }

    function resolveWallet(string calldata erc8004Id) external view returns (address) {
        bytes32 idHash = keccak256(bytes(erc8004Id));
        if (!exists[idHash]) revert IdentityNotFound();
        return identities[idHash].wallet;
    }

    function getAgent(string calldata erc8004Id) external view returns (AgentIdentity memory) {
        bytes32 idHash = keccak256(bytes(erc8004Id));
        if (!exists[idHash]) revert IdentityNotFound();
        return identities[idHash];
    }

    function getAgentByHash(bytes32 idHash) external view returns (AgentIdentity memory) {
        if (!exists[idHash]) revert IdentityNotFound();
        return identities[idHash];
    }
}
