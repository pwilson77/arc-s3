export const escrowCourthouseAbi = [
  "event TaskCreated(bytes32 indexed taskId, address indexed employer, address indexed worker, uint256 paymentAmount, uint256 bondAmount)",
  "event TaskAccepted(bytes32 indexed taskId, address indexed worker)",
  "event TaskResultSubmitted(bytes32 indexed taskId, bytes32 traceHash, string ipfsURI)",
  "event TaskSettled(bytes32 indexed taskId, bool isValid, uint256 workerPayout, uint256 slashedBond)",
  "function createTask(address worker, uint256 paymentAmount, uint256 performanceBondRequirement) external returns (bytes32 taskId)",
  "function forwardCreateTask(address employer, address worker, uint256 paymentAmount, uint256 performanceBondRequirement) external returns (bytes32 taskId)",
  "function acceptTask(bytes32 taskId) external",
  "function forwardAcceptTask(address worker, bytes32 taskId) external",
  "function submitTaskResult(bytes32 taskId, bytes32 traceHash, string ipfsURI) external",
  "function forwardSubmitTaskResult(address worker, bytes32 taskId, bytes32 traceHash, string ipfsURI) external",
  "function settleTask(bytes32 taskId, bool isValid, bytes proof) external",
] as const;

export const intentFirewallAbi = [
  "function executeIntent(address target, uint256 value, uint16 quotedSlippageBps, uint256 requestedGasLimit, uint256 deadline, bytes data) external payable returns (bytes)",
  "function registeredAgent(address agent) external view returns (bool)",
  "function whitelistedTarget(address target) external view returns (bool)",
  "function agentPolicy(address agent) external view returns (uint16 maxSlippageBps, uint256 maxGasLimit, bool initialized)",
] as const;

export const reputationRegistryAbi = [
  "function updateReputation(address agent, uint256 performanceScore) external",
] as const;

export const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
] as const;
