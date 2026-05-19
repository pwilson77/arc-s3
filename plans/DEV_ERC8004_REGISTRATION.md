# Dev Runbook: ERC-8004 Agent Registration (Arc-S3)

Purpose: provide a single, repeatable flow for deploying and registering agent identities during development.

## Scope

This runbook covers:
- Deploying contracts including S3AgentIdentityRegistry
- Bootstrapping protocol permissions
- Registering ERC-8004 identities for alpha, beta, gamma, and optional rfb6
- Verifying registration state

This runbook assumes you are operating in dev/testnet phase.

## Prerequisites

- You are in the arc-s3 project directory.
- Dependencies are installed.
- .env is populated with Arc RPC, token, and private key values.
- You have funded agent wallets for testnet operations.

## Required Environment Variables

Contract and chain:
- ARC_RPC_URL
- ARC_CHAIN_ID
- USDC_ADDRESS
- USYC_ADDRESS
- PERMIT2_ADDRESS

Core contracts (set after deploy):
- S3_INTENT_FIREWALL
- S3_ESCROW_COURTHOUSE
- S3_REPUTATION_REGISTRY
- S3_AGENT_IDENTITY_REGISTRY

Wallet keys:
- ALPHA_PRIVATE_KEY
- BETA_PRIVATE_KEY
- GAMMA_PRIVATE_KEY
- VALIDATOR_PRIVATE_KEY

Identity IDs (ERC-8004 style):
- ALPHA_ERC8004_ID (default: erc8004:arc:alpha)
- BETA_ERC8004_ID (default: erc8004:arc:beta)
- GAMMA_ERC8004_ID (default: erc8004:arc:gamma)
- RFB6_ERC8004_ID (default: erc8004:arc:rfb6)

Optional:
- RFB6_TESTNET_ADDRESS (if present, rfb6 identity will also be registered)

## One-Time Compile Check

Run:

npm run build -w contracts

Expected: Solidity compile passes.

## Deployment and Registration Order

Use this exact order.

1) Deploy contracts (includes identity registry)

npm run deploy:arc -w contracts

Copy emitted addresses into .env:
- S3_INTENT_FIREWALL
- S3_ESCROW_COURTHOUSE
- S3_REPUTATION_REGISTRY
- S3_AGENT_IDENTITY_REGISTRY

2) Bootstrap protocol permissions

npm run bootstrap:arc -w contracts

This configures:
- firewall registrations and policy
- courthouse validator permissions
- reputation updater permissions
- initial identity registrations (idempotent)

3) Register identities explicitly (safe to re-run)

npm run register:identities:arc -w contracts

This command is idempotent and will skip identities that already exist.

## Verification

You can verify quickly by re-running:

npm run register:identities:arc -w contracts

If already registered, output should report identity already registered for each ID.

## Operational Notes

- Settlement and reputation remain address-based.
- ERC-8004 IDs are used as stable identity handles and resolved to wallet addresses through S3AgentIdentityRegistry.
- Wallet rotation is supported by updateWallet in the identity registry contract.

## Common Failure Modes

1) Missing env var
- Symptom: script throws Missing env var.
- Fix: populate the missing key in .env and re-run.

2) S3_AGENT_IDENTITY_REGISTRY is zero address
- Symptom: registration calls fail.
- Fix: re-run deploy, copy real address to .env, then run bootstrap/register again.

3) RPC or funding issues
- Symptom: transaction failures/timeouts.
- Fix: verify ARC_RPC_URL, chain connectivity, and wallet balances.

## UI Observability

After successful registration:
- UI header shows identity registry address.
- Agent cards show ERC-8004 IDs.

Start UI:

npm run ui

Then open:
- /dashboard
- /agents

## Recommended Dev Routine

When contracts are redeployed in dev:

1. npm run deploy:arc -w contracts
2. update .env with fresh addresses
3. npm run bootstrap:arc -w contracts
4. npm run register:identities:arc -w contracts
5. npm run agents:up
6. npm run ui
