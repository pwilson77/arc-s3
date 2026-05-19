// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract S3ReputationRegistry is Ownable {
    using SafeERC20 for IERC20;

    error ReputationInvalidAddress();
    error ReputationInvalidAlpha();
    error ReputationUpdaterOnly();
    error ReputationInvalidAmount();

    event ReputationUpdated(address indexed agent, uint256 previous, uint256 current, uint256 performanceScore);
    event UpdaterUpdated(address indexed updater, bool enabled);
    event AlphaUpdated(uint256 previousAlpha, uint256 newAlpha);
    event Staked(address indexed agent, uint256 amount);
    event Unstaked(address indexed agent, uint256 amount);

    uint256 public constant SCALE = 1_000_000;

    IERC20 public immutable usyc;
    uint256 public alpha;

    mapping(address => uint256) public reputationScore;
    mapping(address => uint256) public stakedAmount;
    mapping(address => bool) public updaters;

    constructor(address owner_, address usyc_, uint256 alpha_) Ownable(owner_) {
        if (usyc_ == address(0)) revert ReputationInvalidAddress();
        if (alpha_ > SCALE) revert ReputationInvalidAlpha();
        usyc = IERC20(usyc_);
        alpha = alpha_;
    }

    modifier onlyUpdater() {
        if (!updaters[msg.sender]) revert ReputationUpdaterOnly();
        _;
    }

    function setUpdater(address updater, bool enabled) external onlyOwner {
        if (updater == address(0)) revert ReputationInvalidAddress();
        updaters[updater] = enabled;
        emit UpdaterUpdated(updater, enabled);
    }

    function setAlpha(uint256 alpha_) external onlyOwner {
        if (alpha_ > SCALE) revert ReputationInvalidAlpha();
        emit AlphaUpdated(alpha, alpha_);
        alpha = alpha_;
    }

    function updateReputation(address agent, uint256 performanceScore) external onlyUpdater {
        if (agent == address(0)) revert ReputationInvalidAddress();
        if (performanceScore > SCALE) revert ReputationInvalidAlpha();

        uint256 oldRep = reputationScore[agent];
        uint256 newRep = ((oldRep * alpha) + (performanceScore * (SCALE - alpha))) / SCALE;
        reputationScore[agent] = newRep;

        emit ReputationUpdated(agent, oldRep, newRep, performanceScore);
    }

    function stakeUSYC(uint256 amount) external {
        if (amount == 0) revert ReputationInvalidAmount();
        stakedAmount[msg.sender] += amount;
        usyc.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function unstakeUSYC(uint256 amount) external {
        if (amount == 0 || amount > stakedAmount[msg.sender]) revert ReputationInvalidAmount();
        stakedAmount[msg.sender] -= amount;
        usyc.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function discoveryScore(address agent) external view returns (uint256) {
        return reputationScore[agent] + stakedAmount[agent];
    }
}
