# Contributing to Arc S3

Thank you for helping improve Arc S3.

## Ways to Contribute

- Bug reports and reproducible issue cases
- Feature proposals with clear scope and impact
- Code changes across contracts, agents, simulation, scripts, and UI
- Docs, runbooks, and onboarding improvements
- Security hardening and reliability improvements

## Development Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment template and configure values:

```bash
cp .env.example .env
```

3. Run a local demo flow:

```bash
npm run demo:clean
```

4. Verify behavior in UI:

- /network
- /traces
- /dashboard

## Workflow

1. Open or claim an issue first so work is tracked.
2. Create a focused branch from main.
3. Keep changes scoped to one logical outcome per PR.
4. Add or update tests where behavior changes.
5. Document operator-facing changes in README or related docs.

## Pull Request Checklist

- Clear summary of problem and solution
- Reproduction and verification steps
- Risk notes and rollback notes for operational changes
- Screenshots or logs for UI/ops changes when useful
- No unrelated refactors bundled with functional changes

## Validation Commands

Run what is relevant for your change area:

```bash
npm run test
npm run typecheck
npm run lint
```

For agent/runtime changes, also include:

```bash
npm run demo:clean
npm run autopilot:health
```

## Commit Guidance

Use clear, scoped commit messages. Suggested prefixes:

- feat: new functionality
- fix: bug fix
- docs: documentation only
- chore: tooling or maintenance
- refactor: code restructuring without behavior change
- test: test changes only

## Reporting Security Issues

Do not open public issues for exploitable vulnerabilities.

Please follow SECURITY.md for responsible disclosure steps.

## Code of Conduct

Be respectful, specific, and constructive in issues and PR reviews.
