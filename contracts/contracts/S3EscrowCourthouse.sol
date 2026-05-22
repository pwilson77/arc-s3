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
    error EscrowFeeTooHigh();

    event ValidatorUpdated(address indexed validator, bool enabled);
    event TaskCreated(bytes32 indexed taskId, address indexed employer, address indexed worker, uint256 paymentAmount, uint256 bondAmount);
    event TaskCreatedV2(bytes32 indexed taskId, address indexed publisher, uint16 publisherFeeBps, uint16 validatorFeeBps);
    event TaskAccepted(bytes32 indexed taskId, address indexed worker);
    event TaskResultSubmitted(bytes32 indexed taskId, bytes32 traceHash, string ipfsURI);
    event TaskSettled(bytes32 indexed taskId, bool isValid, uint256 workerPayout, uint256 slashedBond);
    event TaskSettledV2(
        bytes32 indexed taskId,
        bool isValid,
        uint256 workerPayout,
        uint256 publisherPayout,
        uint256 validatorPayout,
        uint256 slashedBond
    );
    event ValidatorFeeUpdated(uint16 validatorFeeBps);

    uint16 public constant MAX_TOTAL_FEE_BPS = 5000;

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
        address publisher;
        uint16 publisherFeeBps;
        uint16 validatorFeeBps;
    }

    IERC20 public immutable usdc;
    uint256 public nextTaskNonce;
    address public intentFirewall;
    uint16 public validatorFeeBps;

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

    function setValidatorFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_TOTAL_FEE_BPS) revert EscrowFeeTooHigh();
        validatorFeeBps = bps;
        emit ValidatorFeeUpdated(bps);
    }

    function createTask(address worker, uint256 paymentAmount, uint256 performanceBondRequirement) external nonReentrant returns (bytes32 taskId) {
        if (worker == address(0)) revert EscrowInvalidAddress();
        if (paymentAmount == 0 || performanceBondRequirement == 0) revert EscrowInvalidAmount();

        uint16 valFeeBps = validatorFeeBps;
        taskId = keccak256(abi.encodePacked(address(this), block.chainid, msg.sender, worker, nextTaskNonce++));
        Task storage t = tasks[taskId];
        t.employer = msg.sender;
        t.worker = worker;
        t.paymentAmount = paymentAmount;
        t.bondAmount = performanceBondRequirement;
        t.validatorFeeBps = valFeeBps;
        t.status = TaskStatus.Created;

        usdc.safeTransferFrom(msg.sender, address(this), paymentAmount);

        emit TaskCreated(taskId, msg.sender, worker, paymentAmount, performanceBondRequirement);
        emit TaskCreatedV2(taskId, address(0), 0, valFeeBps);
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
        uint256 publisherPayout;
        uint256 validatorPayout;
        uint256 slashedBond;
        if (isValid) {
            publisherPayout = (t.paymentAmount * t.publisherFeeBps) / 10_000;
            validatorPayout = (t.paymentAmount * t.validatorFeeBps) / 10_000;
            workerPayout = t.paymentAmount - publisherPayout - validatorPayout + t.bondAmount;
            usdc.safeTransfer(t.worker, workerPayout);
            if (publisherPayout > 0 && t.publisher != address(0)) {
                usdc.safeTransfer(t.publisher, publisherPayout);
            } else {
                publisherPayout = 0;
            }
            if (validatorPayout > 0) {
                usdc.safeTransfer(msg.sender, validatorPayout);
            }
        } else {
            workerPayout = t.paymentAmount;
            slashedBond = t.bondAmount;
            usdc.safeTransfer(t.employer, t.paymentAmount + t.bondAmount);
        }

        emit TaskSettled(taskId, isValid, workerPayout, slashedBond);
        emit TaskSettledV2(taskId, isValid, workerPayout, publisherPayout, validatorPayout, slashedBond);
    }

    // Firewall-forwarded variants preserve agent identity while keeping policy checks in S3IntentFirewall.
    function forwardCreateTask(address employer, address worker, uint256 paymentAmount, uint256 performanceBondRequirement)
        external
        nonReentrant
        onlyFirewall
        returns (bytes32 taskId)
    {
        return _forwardCreate(employer, worker, address(0), paymentAmount, performanceBondRequirement, 0);
    }

    function forwardCreateTaskV2(
        address employer,
        address worker,
        address publisher,
        uint256 paymentAmount,
        uint256 performanceBondRequirement,
        uint16 publisherFeeBps
    ) external nonReentrant onlyFirewall returns (bytes32 taskId) {
        return _forwardCreate(employer, worker, publisher, paymentAmount, performanceBondRequirement, publisherFeeBps);
    }

    function _forwardCreate(
        address employer,
        address worker,
        address publisher,
        uint256 paymentAmount,
        uint256 performanceBondRequirement,
        uint16 publisherFeeBps
    ) internal returns (bytes32 taskId) {
        if (employer == address(0) || worker == address(0)) revert EscrowInvalidAddress();
        if (paymentAmount == 0 || performanceBondRequirement == 0) revert EscrowInvalidAmount();
        if (publisherFeeBps > 0 && publisher == address(0)) revert EscrowInvalidAddress();
        uint16 valFeeBps = validatorFeeBps;
        if (uint256(publisherFeeBps) + uint256(valFeeBps) > MAX_TOTAL_FEE_BPS) revert EscrowFeeTooHigh();

        taskId = keccak256(abi.encodePacked(address(this), block.chainid, employer, worker, nextTaskNonce++));
        Task storage t = tasks[taskId];
        t.employer = employer;
        t.worker = worker;
        t.publisher = publisher;
        t.publisherFeeBps = publisherFeeBps;
        t.validatorFeeBps = valFeeBps;
        t.paymentAmount = paymentAmount;
        t.bondAmount = performanceBondRequirement;
        t.status = TaskStatus.Created;

        usdc.safeTransferFrom(employer, address(this), paymentAmount);

        emit TaskCreated(taskId, employer, worker, paymentAmount, performanceBondRequirement);
        emit TaskCreatedV2(taskId, publisher, publisherFeeBps, valFeeBps);
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
