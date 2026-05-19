// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract S3EscrowCourthouse is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error EscrowTaskNotFound();
    error EscrowOnlyEmployer();
    error EscrowOnlyAssignedWorker();
    error EscrowTaskStateInvalid();
    error EscrowValidatorOnly();
    error EscrowInvalidAddress();
    error EscrowInvalidAmount();
    error EscrowFirewallOnly();

    event ValidatorUpdated(address indexed validator, bool enabled);
    event TaskCreated(bytes32 indexed taskId, address indexed employer, address indexed worker, uint256 paymentAmount, uint256 bondAmount);
    event TaskAccepted(bytes32 indexed taskId, address indexed worker);
    event TaskResultSubmitted(bytes32 indexed taskId, bytes32 traceHash, string ipfsURI);
    event TaskSettled(bytes32 indexed taskId, bool isValid, uint256 workerPayout, uint256 slashedBond);

    enum TaskStatus {
        None,
        Created,
        Accepted,
        Submitted,
        Settled,
        Cancelled
    }

    struct Task {
        address employer;
        address worker;
        uint256 paymentAmount;
        uint256 bondAmount;
        bytes32 traceHash;
        string ipfsURI;
        TaskStatus status;
    }

    IERC20 public immutable usdc;
    uint256 public nextTaskNonce;
    address public intentFirewall;

    mapping(bytes32 => Task) public tasks;
    mapping(address => bool) public validators;

    constructor(address owner_, address usdc_) Ownable(owner_) {
        if (usdc_ == address(0)) revert EscrowInvalidAddress();
        usdc = IERC20(usdc_);
    }

    modifier onlyValidator() {
        if (!validators[msg.sender]) revert EscrowValidatorOnly();
        _;
    }

    modifier onlyFirewall() {
        if (msg.sender != intentFirewall) revert EscrowFirewallOnly();
        _;
    }

    function setValidator(address validator, bool enabled) external onlyOwner {
        if (validator == address(0)) revert EscrowInvalidAddress();
        validators[validator] = enabled;
        emit ValidatorUpdated(validator, enabled);
    }

    function setIntentFirewall(address firewall) external onlyOwner {
        if (firewall == address(0)) revert EscrowInvalidAddress();
        intentFirewall = firewall;
    }

    function createTask(address worker, uint256 paymentAmount, uint256 performanceBondRequirement) external nonReentrant returns (bytes32 taskId) {
        if (worker == address(0)) revert EscrowInvalidAddress();
        if (paymentAmount == 0 || performanceBondRequirement == 0) revert EscrowInvalidAmount();

        taskId = keccak256(abi.encodePacked(address(this), block.chainid, msg.sender, worker, nextTaskNonce++));
        Task storage t = tasks[taskId];
        t.employer = msg.sender;
        t.worker = worker;
        t.paymentAmount = paymentAmount;
        t.bondAmount = performanceBondRequirement;
        t.status = TaskStatus.Created;

        usdc.safeTransferFrom(msg.sender, address(this), paymentAmount);

        emit TaskCreated(taskId, msg.sender, worker, paymentAmount, performanceBondRequirement);
    }

    function acceptTask(bytes32 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        if (t.status == TaskStatus.None) revert EscrowTaskNotFound();
        if (msg.sender != t.worker) revert EscrowOnlyAssignedWorker();
        if (t.status != TaskStatus.Created) revert EscrowTaskStateInvalid();

        t.status = TaskStatus.Accepted;
        usdc.safeTransferFrom(msg.sender, address(this), t.bondAmount);

        emit TaskAccepted(taskId, msg.sender);
    }

    function submitTaskResult(bytes32 taskId, bytes32 traceHash, string calldata ipfsURI) external {
        Task storage t = tasks[taskId];
        if (t.status == TaskStatus.None) revert EscrowTaskNotFound();
        if (msg.sender != t.worker) revert EscrowOnlyAssignedWorker();
        if (t.status != TaskStatus.Accepted) revert EscrowTaskStateInvalid();

        t.traceHash = traceHash;
        t.ipfsURI = ipfsURI;
        t.status = TaskStatus.Submitted;

        emit TaskResultSubmitted(taskId, traceHash, ipfsURI);
    }

    function settleTask(bytes32 taskId, bool isValid, bytes calldata) external nonReentrant onlyValidator {
        Task storage t = tasks[taskId];
        if (t.status == TaskStatus.None) revert EscrowTaskNotFound();
        if (t.status != TaskStatus.Submitted) revert EscrowTaskStateInvalid();

        t.status = TaskStatus.Settled;

        uint256 workerPayout;
        uint256 slashedBond;
        if (isValid) {
            workerPayout = t.paymentAmount + t.bondAmount;
            usdc.safeTransfer(t.worker, workerPayout);
        } else {
            workerPayout = t.paymentAmount;
            slashedBond = t.bondAmount;
            usdc.safeTransfer(t.employer, t.paymentAmount + t.bondAmount);
        }

        emit TaskSettled(taskId, isValid, workerPayout, slashedBond);
    }

    // Firewall-forwarded variants preserve agent identity while keeping policy checks in S3IntentFirewall.
    function forwardCreateTask(address employer, address worker, uint256 paymentAmount, uint256 performanceBondRequirement)
        external
        nonReentrant
        onlyFirewall
        returns (bytes32 taskId)
    {
        if (employer == address(0) || worker == address(0)) revert EscrowInvalidAddress();
        if (paymentAmount == 0 || performanceBondRequirement == 0) revert EscrowInvalidAmount();

        taskId = keccak256(abi.encodePacked(address(this), block.chainid, employer, worker, nextTaskNonce++));
        Task storage t = tasks[taskId];
        t.employer = employer;
        t.worker = worker;
        t.paymentAmount = paymentAmount;
        t.bondAmount = performanceBondRequirement;
        t.status = TaskStatus.Created;

        usdc.safeTransferFrom(employer, address(this), paymentAmount);

        emit TaskCreated(taskId, employer, worker, paymentAmount, performanceBondRequirement);
    }

    function forwardAcceptTask(address worker, bytes32 taskId) external nonReentrant onlyFirewall {
        Task storage t = tasks[taskId];
        if (t.status == TaskStatus.None) revert EscrowTaskNotFound();
        if (worker != t.worker) revert EscrowOnlyAssignedWorker();
        if (t.status != TaskStatus.Created) revert EscrowTaskStateInvalid();

        t.status = TaskStatus.Accepted;
        usdc.safeTransferFrom(worker, address(this), t.bondAmount);

        emit TaskAccepted(taskId, worker);
    }

    function forwardSubmitTaskResult(address worker, bytes32 taskId, bytes32 traceHash, string calldata ipfsURI)
        external
        onlyFirewall
    {
        Task storage t = tasks[taskId];
        if (t.status == TaskStatus.None) revert EscrowTaskNotFound();
        if (worker != t.worker) revert EscrowOnlyAssignedWorker();
        if (t.status != TaskStatus.Accepted) revert EscrowTaskStateInvalid();

        t.traceHash = traceHash;
        t.ipfsURI = ipfsURI;
        t.status = TaskStatus.Submitted;

        emit TaskResultSubmitted(taskId, traceHash, ipfsURI);
    }
}
