# Security Policy

## Supported Scope

Security reports are welcome for:

- Smart contracts in contracts/
- Agent execution and settlement logic in agents/
- Lifecycle and operational scripts in scripts/
- UI surfaces that expose settlement or trace data in ui/

## Reporting a Vulnerability

Please do not disclose vulnerabilities publicly before maintainers can assess and patch.

Preferred process:

1. Open a private GitHub Security Advisory for this repository.
2. Include a clear title and affected components.
3. Provide reproduction steps and expected vs actual behavior.
4. Include impact analysis and exploit prerequisites.
5. Share proposed mitigations if available.

If private advisory flow is unavailable, open a minimal public issue that requests secure contact, but do not include exploit details.

## What to Include

- Affected files, modules, or contracts
- Preconditions and threat model assumptions
- Step-by-step reproduction
- Impact (fund loss, liveness loss, integrity break, etc.)
- Suggested remediation
- Optional proof of concept

## Response Targets

Maintainers will aim to:

- Acknowledge receipt within 72 hours
- Provide triage status within 7 days
- Coordinate patch and disclosure timeline based on severity

These are targets, not guaranteed SLAs.

## Disclosure Policy

After a fix is prepared and deployed where relevant, maintainers and reporter should coordinate responsible public disclosure.

## Safe Harbor

Good-faith security research and responsible disclosure are welcomed. Avoid actions that could harm users, degrade services, or expose private data.
