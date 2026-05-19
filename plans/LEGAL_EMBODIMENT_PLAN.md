# Arc S3 Legal Embodiment Plan

## Purpose
Define a practical path from technical agent execution to legally robust agent operation, without blocking current simulation and testing work.

## Scope
- In scope: legal wrapper design, governance controls, auditability requirements, compliance operating model, rollout gates.
- Out of scope: replacing current technical architecture, writing jurisdiction-specific legal advice.

## Planning Assumptions
- Technical stack continues on current arc-s3 architecture (intent firewall, courthouse, registry, simulation loops).
- Initial market usage is best modeled as agency (agent acts for a legal principal).
- Entity-native mode (agent-managed legal entity) is optional and introduced only after pilot readiness.

## Decision Rail
Before launch, choose one rail per agent product line:
1. Agency rail: agent acts on behalf of an existing human/company principal.
2. Entity rail: agent operates through a dedicated legal entity with delegated software governance.

Do not mix rails in one deployment without explicit policy and contract language.

## Phase 0: Complete Technical Validation (Current)
Goal: finish technical confidence before legal packaging.

Exit criteria:
- Intent path passes end-to-end smoke tests on target deployment.
- Simulation metrics are stable for create, accept, submit, and settle flows.
- Incident logging and trace retention are functioning.

Artifacts:
- Test reports and replayable smoke scripts.
- Deployment and bootstrap runbook.
- Trace and metrics sample bundle for legal/compliance review.

## Phase 1: Legal Architecture Design (2-4 weeks)
Goal: produce legal operating design that matches technical control points.

Workstreams:
1. Principal model
- Define principal-of-record for each agent role.
- Specify where authority is delegated and where humans remain mandatory.

2. Governance model
- Define governance acts: model update, prompt update, config change, policy limit change, key rotation.
- Define approval thresholds and emergency controls.

3. Liability and disputes
- Define responsibility map for harmful outputs, failed settlements, and policy bypass attempts.
- Define dispute venue, governing law, and service-of-process handling.

4. Data and records
- Define retention schedule for traces, policy logs, and decision records.
- Define evidentiary packaging format for counterparties and regulators.

Deliverables:
- Legal architecture memo (agency baseline, entity option).
- Governance control matrix mapped to technical events.
- Risk register with likelihood and mitigation.

## Phase 2: Contract and Policy Pack (2-6 weeks)
Goal: codify legal architecture into reusable documents and controls.

Documents:
- Terms and counterpart agreement templates.
- Delegated authority policy (what the agent may do, spend, and sign).
- Incident response policy for legal and operational events.
- Change-management policy for model/prompt/config updates.

Control mappings:
- Map each policy to measurable technical evidence:
  - Firewall policy updates
  - Registry identity updates
  - Courthouse task lifecycle events
  - Key management and rotation logs

Go/No-Go gate:
- Every legal control must have a corresponding technical evidence source.

## Phase 3: Pilot Operation (4-8 weeks)
Goal: run limited real usage with legal controls in force.

Pilot design:
- Small set of counterparties and capped notional limits.
- Predefined allowed actions and spend ceilings.
- Human escalation path for exceptional states.

Monitoring and assurance:
- Weekly legal-operational review.
- Breach and near-miss classification.
- Counterparty feedback on enforceability and trust.

Pilot exit criteria:
- No unresolved severe incidents.
- Evidence package accepted by pilot counterparties.
- Governance procedures executed at least once in drill mode.

## Phase 4: Production Readiness
Goal: scale with predictable legal and operational behavior.

Production requirements:
- Finalized rail choice per product (agency or entity).
- Insurance, tax, and compliance process owners assigned.
- Service-of-process and dispute management operationalized.
- Internal audit checklist for quarterly reviews.

## Optional Track: Entity-Native Agent Mode
Start only after Phase 3 success.

Prerequisites:
- Stable governance process from pilot.
- Dedicated counsel review for jurisdictional constraints.
- Full control over treasury, identity, and upgrade authority lifecycle.

Implementation steps:
1. Form legal entity and governing documents.
2. Bind agent governance acts to explicit legal approval logic.
3. Tie onchain identity and technical upgrades to legal records.
4. Run parallel shadow period before cutover.

## Roles and Ownership
- Product owner: defines allowed business actions and risk appetite.
- Legal lead: owns principal model, contracts, and dispute framework.
- Engineering lead: owns evidence-producing controls and system guardrails.
- Operations lead: owns runbooks, incident handling, and audit preparation.

## Milestones and Checkpoints
1. M1: Technical validation complete (Phase 0 exit).
2. M2: Legal architecture signed off (Phase 1 complete).
3. M3: Contract and policy pack approved (Phase 2 complete).
4. M4: Pilot success criteria met (Phase 3 complete).
5. M5: Production readiness approval (Phase 4 complete).

## Immediate Next Step (After Testing)
Run a 90-minute cross-functional workshop to lock:
1. Rail choice for first launch (agency vs entity).
2. Authority boundaries by agent role.
3. Top 5 legal-operational risks and owners.
4. Phase 1 timeline and deliverables.
