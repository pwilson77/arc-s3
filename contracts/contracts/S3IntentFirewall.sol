// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPermit2} from "./interfaces/IPermit2.sol";

contract S3IntentFirewall is Ownable, ReentrancyGuard {
    error FirewallAgentNotRegistered();
    error FirewallTargetNotWhitelisted();
    error FirewallSlippageTooHigh();
    error FirewallGasLimitExceeded();
    error FirewallDeadlineExpired();
    error FirewallCallFailed();

    event AgentRegistrationUpdated(address indexed agent, bool isRegistered);
    event TargetWhitelistUpdated(address indexed target, bool isWhitelisted);
    event AgentPolicyUpdated(address indexed agent, uint16 maxSlippageBps, uint256 maxGasLimit);
    event IntentExecuted(address indexed agent, address indexed target, uint256 value, bytes4 selector);

    struct AgentPolicy {
        uint16 maxSlippageBps;
        uint256 maxGasLimit;
        bool initialized;
    }

    address public immutable permit2;

    mapping(address => bool) public registeredAgent;
    mapping(address => bool) public whitelistedTarget;
    mapping(address => AgentPolicy) public agentPolicy;

    constructor(address owner_, address permit2_) Ownable(owner_) {
        permit2 = permit2_;
    }

    function setAgentRegistration(address agent, bool isRegistered) external onlyOwner {
        registeredAgent[agent] = isRegistered;
        emit AgentRegistrationUpdated(agent, isRegistered);
    }

    function setTargetWhitelist(address target, bool isWhitelisted) external onlyOwner {
        whitelistedTarget[target] = isWhitelisted;
        emit TargetWhitelistUpdated(target, isWhitelisted);
    }

    function setAgentPolicy(address agent, uint16 maxSlippageBps, uint256 maxGasLimit) external onlyOwner {
        agentPolicy[agent] = AgentPolicy({maxSlippageBps: maxSlippageBps, maxGasLimit: maxGasLimit, initialized: true});
        emit AgentPolicyUpdated(agent, maxSlippageBps, maxGasLimit);
    }

    function executeIntent(
        address target,
        uint256 value,
        uint16 quotedSlippageBps,
        uint256 requestedGasLimit,
        uint256 deadline,
        bytes calldata data
    ) external payable nonReentrant returns (bytes memory result) {
        return _executeIntent(msg.sender, target, value, quotedSlippageBps, requestedGasLimit, deadline, data);
    }

    function _executeIntent(
        address agent,
        address target,
        uint256 value,
        uint16 quotedSlippageBps,
        uint256 requestedGasLimit,
        uint256 deadline,
        bytes calldata data
    ) private returns (bytes memory result) {
        if (!registeredAgent[agent]) revert FirewallAgentNotRegistered();
        if (!whitelistedTarget[target]) revert FirewallTargetNotWhitelisted();
        if (block.timestamp > deadline) revert FirewallDeadlineExpired();

        AgentPolicy memory policy = agentPolicy[agent];
        if (policy.initialized) {
            if (quotedSlippageBps > policy.maxSlippageBps) revert FirewallSlippageTooHigh();
            if (requestedGasLimit > policy.maxGasLimit) revert FirewallGasLimitExceeded();
        }

        (bool ok, bytes memory returnData) = target.call{value: value, gas: requestedGasLimit}(data);
        if (!ok) revert FirewallCallFailed();

        bytes4 selector = bytes4(0);
        if (data.length >= 4) {
            assembly {
                selector := calldataload(data.offset)
            }
        }

        emit IntentExecuted(agent, target, value, selector);
        return returnData;
    }

    function permitAndExecuteIntent(
        IPermit2.PermitTransferFrom calldata permit,
        IPermit2.SignatureTransferDetails calldata transferDetails,
        address tokenOwner,
        bytes calldata signature,
        address target,
        uint256 value,
        uint16 quotedSlippageBps,
        uint256 requestedGasLimit,
        uint256 deadline,
        bytes calldata data
    ) external payable returns (bytes memory result) {
        // Pull a signed approval + transfer in the same transaction to support non-interactive agent loops.
        IPermit2(permit2).permitTransferFrom(permit, transferDetails, tokenOwner, signature);
        return _executeIntent(msg.sender, target, value, quotedSlippageBps, requestedGasLimit, deadline, data);
    }
}
