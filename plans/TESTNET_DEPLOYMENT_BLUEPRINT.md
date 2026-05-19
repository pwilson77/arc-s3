# Arc-S3 Testnet Deployment Blueprint

Purpose: one complete list of everything required to deploy and run the full arc-s3 stack on Arc testnet.

## 1) What Must Exist on Testnet

Contracts
- S3IntentFirewall
- S3EscrowCourthouse
- S3ReputationRegistry
- S3AgentIdentityRegistry

Configured identities and permissions
- Alpha, Beta, Gamma registered in firewall
- Courthouse target whitelisted in firewall
- Agent policy limits set in firewall
- Validator enabled in courthouse
- Validator enabled as updater in reputation registry
- ERC-8004 identities mapped in identity registry

Running services
- Simulation runtime (alpha, beta, gamma, validator loops)
- Optional rfb6 runtime
- UI dashboard

Validation artifacts
- Intent smoke pass (create, accept, submit)
- Settlement telemetry file updates
- Basic UI verification for dashboard and agent pages

## 2) Required Inputs

Environment file
- Use project root environment file at .env

Chain and token config
- ARC_RPC_URL
- ARC_CHAIN_ID
- USDC_ADDRESS
- USYC_ADDRESS
- PERMIT2_ADDRESS

Contract addresses after deployment
- S3_INTENT_FIREWALL
- S3_ESCROW_COURTHOUSE
- S3_REPUTATION_REGISTRY
- S3_AGENT_IDENTITY_REGISTRY

Keys
- ALPHA_PRIVATE_KEY
- BETA_PRIVATE_KEY
- GAMMA_PRIVATE_KEY
- VALIDATOR_PRIVATE_KEY
- Optional: RFB6_TESTNET_ADDRESS

Identity handles
- ALPHA_ERC8004_ID
- BETA_ERC8004_ID
- GAMMA_ERC8004_ID
- Optional: RFB6_ERC8004_ID

Simulation settings
- DEFAULT_TASK_PAYMENT
- DEFAULT_BOND_AMOUNT
- ALPHA_LOOP_MS
- VALIDATOR_POLL_MS
- GAMMA_CORRUPTION_BPS

Intent settings
- INTENT_DEFAULT_GAS_LIMIT
- INTENT_DEFAULT_DEADLINE_SECONDS
- INTENT_QUOTED_SLIPPAGE_BPS

## 3) Deployment Order (Exact)

From project root:
- cd /workspace/projects/arc-s3

Step A: compile and sanity checks
- npm run build -w contracts
- npm run lint -w simulation

Step B: deploy contracts
- npm run deploy:arc -w contracts
- Copy emitted addresses into .env:
  - S3_INTENT_FIREWALL
  - S3_ESCROW_COURTHOUSE
  - S3_REPUTATION_REGISTRY
  - S3_AGENT_IDENTITY_REGISTRY

Step C: bootstrap permissions and registrations
- bash -lc 'set -a; source ./.env; set +a; npm run bootstrap:arc -w contracts'

Step D: idempotent identity registration
- bash -lc 'set -a; source ./.env; set +a; npm run register:identities:arc -w contracts'

Step E: intent-path smoke test
- bash -lc 'set -a; source ./.env; set +a; npm run sim:intent:smoke'

Step F: runtime bring-up
- npm run agents:up
- In a second terminal: npm run ui

## 4) Acceptance Gates

Gate 1: contract deployment complete
- All four contract addresses are non-zero and present in .env

Gate 2: bootstrap complete
- No revert on firewall registration and policy setup
- Validator role updates succeed

Gate 3: intent path complete
- Intent smoke shows success for:
  - createTask via firewall
  - acceptTask via firewall
  - submitTaskResult via firewall

Gate 4: runtime health
- Simulation continuously emits task lifecycle logs
- Metrics file updates at simulation/data/metrics/validator-metrics.jsonl

Gate 5: UI health
- Dashboard loads
- Agent pages load
- Recent activity appears

## 5) Optional Components

Optional rfb6 runtime
- Start with launcher via npm run agents:up, or directly:
- npm run agent:rfb6

Optional legal readiness prep
- Track against plans/LEGAL_EMBODIMENT_PLAN.md after technical gates pass

## 6) Failure Map and Fast Fixes

Failure: missing env var
- Fix .env key and rerun command

Failure: wrong contract address in runtime
- Resource shell env and rerun using:
- bash -lc 'set -a; source ./.env; set +a; <command>'

Failure: FirewallAgentNotRegistered
- Re-run bootstrap and verify alpha, beta, gamma registration

Failure: FirewallCallFailed
- Verify runtime points to latest deployed courthouse and firewall addresses
- Confirm forwarded methods are present in deployed courthouse version

Failure: no ongoing settlements
- Check validator loop and validator permissions in courthouse and registry

## 7) Final Testnet Go Checklist

- Contracts deployed and addresses updated
- Bootstrap completed
- Identity registration completed
- Intent smoke passed
- Agents runtime started
- UI started
- Metrics and traces updating
- Basic demo path verified end-to-end
