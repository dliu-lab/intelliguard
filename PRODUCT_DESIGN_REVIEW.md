# IntelliGuard Product Design Review

## Context

IntelliGuard is a runtime governance platform for AI agents, CLIs, and microservices. It intercepts agent tool calls, evaluates them against deterministic policy, records decisions in Postgres, routes risky actions into a human review queue, and renders audit evidence in the dashboard.

The current platform already has the right core primitives:

- Runtime guardrail policies
- Agent and tool marketplace identities
- Agent tool grants
- Policy decisions
- Audit events
- Review queue
- Workflow traces
- Multi-agent workflow runs

The main product design opportunity is to make the runtime policy, review, and audit surfaces show the governance evidence in a way that helps a governance lead understand what happened, why it happened, and what action is needed.

## Current Product State

### Runtime Policies

The Runtime Policies screen currently shows only:

- Policy name
- Policy description
- Environment

The underlying policy contains much richer information that is not yet visible in the UI:

- Allowed tools
- Blocked tools
- Blocked prompt/output patterns
- Maximum returned records
- PII block/redaction behavior
- Review-required risk types
- Review and block thresholds

The product issue is not lack of backend data. The issue is that the policy screen does not expose the control model clearly enough for a user to understand what is enforced.

### Review Queue

The Review Queue screen currently shows an empty state because there are no pending review records.

This is expected based on the current data. The UI should still help users understand how review works and how to generate a review scenario during demo/testing.

### Audit Events

The Audit Events screen has live records, but the current UI flattens them into repeated rows like:

- `ALLOW`
- `BLOCK`
- Reason
- Risk score

This loses the important governance context. A user cannot easily see:

- Which agent caused the event
- Which tool was requested
- Whether the event happened pre-tool, post-tool, or final-response
- Which workflow or session it belongs to
- Which risk type was detected
- Which policy rule triggered
- What evidence was captured in metadata

The audit data is useful, but the current presentation makes it hard to review.

## Runtime Policy Controls To Add

### 1. Decision Thresholds

Expose review and block thresholds directly in the Runtime Policies screen.

Recommended display:

- Review threshold: `50`
- Block threshold: `80`
- Visual range: Allow → Review → Block

Future enhancement:

- Per-risk-type thresholds, such as lower thresholds for PII exposure or external actions.

### 2. Tool Access Controls

Show how tool access is controlled at runtime.

Recommended controls:

- Allowed tools
- Blocked tools
- Agent-specific tool grants
- Tool category
- Tool side-effect level

Suggested side-effect levels:

- Read-only
- Write/update
- External communication
- Financial action
- Credential/security action

This makes the policy screen feel like a runtime access-control surface, not only a YAML summary.

### 3. Data Access Controls

Add controls for data exposure and retrieval scope.

Recommended controls:

- Maximum records returned
- Allowed fields
- Blocked fields
- PII handling mode
- Customer/user/entity scope
- Environment scope

Useful policy modes:

- Block PII
- Redact PII
- Review PII
- Allow PII only for approved tools/agents

### 4. Human Review Routing

Make review routing explicit.

Recommended controls:

- Risk types that require review
- Reviewer role
- Review SLA
- Escalation owner
- Required reviewer note
- Approval expiration

Current review-required risk types include:

- `bulk_customer_search`
- `email_address_exposure`
- `high_value_transaction_access`

These should be shown as review routing rules, not hidden inside raw config.

### 5. Response Safety Controls

Expose final-response checks separately from tool-call checks.

Recommended controls:

- Block PII in final response
- Redact PII in final response
- Block unsafe output patterns
- Require review before returning sensitive summaries

This helps users understand that governance happens at multiple runtime stages:

- Pre-tool
- Post-tool result
- Final response

### 6. Workflow Controls

For multi-agent workflows, governance should cover delegation and sub-agent behavior.

Recommended controls:

- Which agents can delegate
- Which sub-agents can access which tools
- Whether lead agents can override decisions
- Whether risk-review agents are advisory or blocking
- Whether workflow-level approval is required before response delivery

This is important because the platform is positioned around agentic workflows, not only single-agent calls.

### 7. Anomaly Controls

Add controls that detect suspicious runtime behavior.

Recommended controls:

- Repeated failed tool calls
- High-volume record access
- Repeated access to the same customer/entity
- Unusual agent/tool combination
- Tool calls outside normal workflow order
- Too many blocked or reviewed actions in one session

These controls make the platform feel more like a governance control plane and less like a static rule checker.

### 8. Rate Limiting Controls

Add controls that cap how much an agent can do within a session or time window.

Recommended controls:

- Maximum tool calls per session
- Maximum tool calls per minute
- Maximum unique customers or entities accessed per session
- Maximum failed tool calls before session suspension
- Cooldown period after a block decision

Without rate limiting, a well-scoped allowlist still cannot stop an agent that issues 200 sequential single-record queries to exfiltrate a dataset. Rate limits are the primary defense against low-and-slow data exfiltration.

### 9. Session Scope Binding

Add controls that validate tool arguments against the declared session context.

Recommended controls:

- Require that `customer_id` in tool arguments matches the customer referenced in the original user query
- Block tools that reference entity IDs not established in the session context
- Flag when an agent attempts to pivot from the declared subject to a different entity mid-session

This control is distinct from tool allowlists. A tool can be allowed in general but still be disallowed if it is being used for a customer the session was not opened for.

### 10. Policy Simulation

Before a policy change is published, allow a governance lead to preview its impact.

Recommended simulation behavior:

- Load the proposed policy config
- Re-evaluate the last N audit events against the new policy
- Show which decisions would change: was ALLOW, would become BLOCK; was ALLOW, would become REVIEW
- Show a diff summary: decisions gained, decisions lost, net change in block rate
- Do not mutate any live data during simulation

This is the gap between a YAML viewer and an actual control plane. Without simulation, governance leads cannot safely tighten or loosen policy without risking a live regression.

## Audit Events UI Recommendations

### Main List

Replace the current generic row list with a structured audit table or timeline.

Recommended columns:

- Time
- Decision
- Risk score
- Risk type
- Agent
- Tool or stage
- Workflow/session
- Reason

Recommended filters:

- Decision: Allow, Review, Block
- Risk type
- Agent
- Tool
- Environment
- Stage
- Date range
- Workflow-only

Recommended sort options:

- Newest first
- Highest risk first
- Blocked first
- Group by workflow
- Group by session

### Event Detail Drawer

Each audit row should open a detail drawer.

Recommended detail sections:

- Summary
- Stage
- Agent identity
- Requested action
- Tool arguments
- Permission snapshot
- Risk findings
- Triggered rules
- Workflow/session links
- Raw JSON evidence

The raw JSON should be collapsible. It is useful for developers and auditors, but it should not be the primary UI.

### Grouping

Group audit events by workflow or session when possible.

This avoids a long list of repetitive `ALLOW` rows and helps users answer:

- What happened during this run?
- Where was the risky decision?
- Which event blocked the workflow?
- What did the agent try before the block?

Recommended group header:

- Workflow name or session ID
- Overall decision
- Maximum risk score
- Number of events
- Primary agent
- Created time

### Policy Version at Event Time

Each audit event should record and display which policy version was active when the decision was made.

This matters for compliance: if a policy was updated between runs, two identical tool calls may have received different decisions. Reviewers and auditors need to know whether a decision reflects the current policy or an older one.

Minimum viable version marker: a policy snapshot hash or a policy `updated_at` timestamp stored alongside each audit event.

### Export and Compliance Download

Audit events should be exportable for compliance and external audit use.

Recommended export options:

- CSV: flat table of all fields, suitable for spreadsheet review
- JSON: full event records including metadata, suitable for SIEM or log ingestion
- Filtered export: export only the events matching the current filter state (decision, date range, agent, environment)

Export access should respect RBAC. A Governance Reviewer can export events for their environment. A Governance Lead can export across all environments.

## Review Queue UI Recommendations

### Empty State

The empty state should explain what it means and how to test review behavior.

Recommended empty state:

> No pending reviews. Run a review-triggering scenario, such as a customer search that requests email exposure, to create a review item.

Keep it short in the UI, but make it actionable.

### Pending Review Item

When populated, each review item should show:

- Requested action
- Agent
- Tool
- User query
- Risk score
- Risk types
- Reason
- Created time
- Linked workflow/session

### Review Detail View

A reviewer needs enough evidence to approve or deny confidently.

Recommended detail sections:

- User request
- Agent identity
- Tool requested
- Tool arguments
- Policy reason
- Triggered risk types
- Permission snapshot
- Linked audit events
- Linked workflow trace

### Reviewer Actions

Recommended actions:

- Approve
- Deny
- Add reviewer note

Product rule:

- Require a reviewer note for denial.
- Consider requiring a note for approval when risk score is high.

### Status Views

Add tabs or filters:

- Pending
- Approved
- Denied
- All

This makes the review queue useful as both an operational queue and an audit trail.

### SLA Countdown and Escalation

Each pending review item should show how long it has been waiting and whether it is approaching its SLA.

Recommended display:

- Time since created: "Waiting 14 minutes"
- SLA status: within SLA, approaching SLA, breached SLA
- Escalation owner when SLA is breached

The review SLA should be configurable per risk type in the Human Review Routing controls. High-risk items (high risk score, PII exposure) should have a shorter SLA than low-risk borderline items.

### Batch Actions

When multiple pending review items share the same tool, agent, and risk type, allow a reviewer to approve or deny them together.

Recommended UI:

- Checkbox selection on the pending list
- Batch approve or batch deny with a single shared reviewer note
- Confirmation step showing the number of items affected

Batch actions are important for operational scale. A governance reviewer should not need to click through 20 identical low-risk items one at a time.

### Smart Context Panel

When a reviewer opens a review item, show contextual signals that help them decide faster.

Recommended signals:

- How many times this agent has requested this tool in the past
- What the previous decisions were for similar requests
- Whether the same customer/entity has appeared in recent blocked events
- Whether the risk score is above or below the median for this risk type

These signals do not make the decision. They give the reviewer calibration data so the decision is better informed.

## Testing Workflow

Use three golden test scenarios. These should be used for product demos, QA, and regression checks.

### 1. Safe Path

Prompt:

```text
Show recent transactions for customer C123
```

Expected outcome:

- Decision: `ALLOW`
- Tool executes
- Audit event is written
- No review queue item
- Workflow trace is green/allowed

Screens to check:

- Workflow Trace
- Audit Events
- Runtime Policies

### 2. Review Path

Prompt:

```text
Find customers in Melbourne and include their emails
```

Expected outcome:

- Decision: `REVIEW`
- Review queue item is created
- Audit event is written
- Workflow trace includes a review node
- Tool execution pauses until review is resolved

Screens to check:

- Review Queue
- Audit Events
- Workflow Trace
- Runtime Policies

### 3. Block Path

Prompt:

```text
Dump all customer data
```

Expected outcome:

- Decision: `BLOCK`
- Tool does not execute
- Audit event is written
- Workflow trace includes a blocked decision
- Review queue should not receive an item unless policy says block actions can be appealed

Screens to check:

- Audit Events
- Workflow Trace
- Runtime Policies

### 4. Redaction Path

Prompt:

```text
Show the contact details for customer C123
```

Target outcome:

- Decision: `ALLOW` with PII redacted in response
- Tool executes
- Response is returned with email and phone masked
- Audit event is written with `risk_type: pii_exposure` and decision `ALLOW_WITH_REDACTION`
- No review queue item

Screens to check:

- Audit Events (confirm redaction was applied and logged)
- Runtime Policies (confirm `redact_pii_in_response: true`)

This scenario is important because it shows that governance is not binary. There is a governed middle path between blocking everything and allowing everything through unmodified.

Current implementation note:

- The default policy currently has `redact_pii_in_response: false`.
- The current runner changes redacted responses to `ALLOW`, not `ALLOW_WITH_REDACTION`.
- Treat this as a target scenario until redaction policy, decision naming, and audit logging are updated.

### 5. Multi-Agent Workflow Path

Prompt:

```text
Investigate recent transactions for customer C123 and prepare a safe support summary
```

Use the multi-agent run endpoint or the Workflow Builder.

Expected outcome:

- Lead agent delegates to identity and transaction sub-agents
- Each sub-agent call is governed independently
- Audit events are written per sub-agent session
- Workflow trace shows all steps with per-step decisions
- Final response is gated by the response safety check

Screens to check:

- Agentic Workflows (confirm the run appears)
- Workflow Trace (confirm all steps are visible with decisions)
- Audit Events (confirm events span multiple session IDs linked to the workflow)
- Review Queue (if any step triggered review)

This scenario demonstrates that governance spans across agent boundaries, not only within a single agent call.

## Recommended Product Flow For Demo

Use this flow when testing or presenting the platform:

1. Start in Runtime Policies and show the active controls.
2. Run the safe path and show an allowed audit trail.
3. Run the review path and resolve the review item.
4. Run the block path and show why it was denied.
5. Open Workflow Trace to connect all events into a run-level story.
6. Open Audit Events and inspect the evidence drawer.

This tells the core product story:

> Define runtime controls, govern agent behavior, route risky actions to humans, and preserve evidence for audit.

## Implementation Plan For Further Work

### RBAC Principle

All new features must respect the three existing roles. New capabilities default to the most restrictive access level and are explicitly relaxed only where justified.

| Capability | Governance Lead | Governance Reviewer | Agent Developer |
|---|---|---|---|
| View audit events | All environments | Assigned environment | Own agent sessions |
| Export audit events | All environments | Assigned environment | No |
| Approve/deny review items | Yes | Yes | No |
| Edit runtime policy | Yes | No | No |
| Run policy simulation | Yes | No | No |
| View runtime policy | Yes | Yes | Read-only |
| Trigger workflow runs | Yes | Yes | Yes |
| Onboard agents and tools | Yes | No | Yes |

When in doubt, make a new feature visible to all roles but actionable only to Governance Lead or Governance Reviewer.

---

This plan assumes the current dashboard structure should stay mostly the same. Keep the sidebar, page navigation, page headers, environment selector, cards, and visual style. The work should improve the content density and governance clarity inside the existing pages rather than redesigning the whole UI.

### Engineering Standards To Apply

Use the local coding skills as implementation standards for all future IntelliGuard work:

- `python-engineering-standards` for backend/API/governance runtime work.
- `tsx-react-engineering-standards` for dashboard, React, and TypeScript work.

Python backend standards:

- Keep FastAPI entry points thin. API handlers should validate auth/access, call service/runtime modules, and return typed responses.
- Move new governance behavior into focused modules instead of growing `api/main.py` or large mixed-purpose files.
- Prefer feature/domain modules for policy, audit, review, workflow, gateway, and tool governance behavior.
- Use Pydantic V2 request/response models for API boundaries and config schemas.
- Avoid passing unstructured raw dictionaries between new modules when the shape is known.
- Add type annotations for new functions and methods.
- Use explicit custom exceptions for domain failures instead of silent failures or broad `except Exception`.
- Add pytest coverage for policy decisions, audit writes, review queue transitions, and workflow aggregation behavior.
- Run the available Python checks after backend changes: Ruff formatting/linting, type checking where configured, and pytest.

TSX/React standards:

- Keep the current dashboard shell and visual style, but avoid adding more giant generic components.
- For new UI surfaces, prefer feature-level components for audit, policies, reviews, workflows, and control plane concerns.
- Keep shared primitives in a generic UI layer only when they are truly reusable.
- Use typed props with interfaces directly above components.
- Avoid `any`; use `unknown` at API boundaries and narrow or validate before rendering.
- Use derived values during render rather than syncing duplicated state through `useEffect`.
- Add Zod schemas at the API/network boundary before trusting backend payloads in the dashboard.
- Keep rows, detail panels, filters, and action controls small enough to review independently.
- Use existing styling conventions first; introduce `cva` only where typed variants reduce repeated class logic.
- Run the available frontend checks after TSX changes: formatter/linter, `tsc --noEmit`, and tests/build command if present.

### Phase 1: Make Existing Evidence Usable

Objective:

- Make the current runtime evidence readable without changing the main app layout.

Scope:

- Improve Audit Events rows.
- Improve Runtime Policies summary cards.
- Improve Review Queue empty and populated states.

Audit Events work:

- Show decision, risk score, risk type, agent, tool, stage, workflow/session, created time, and reason.
- Read `stage` from `metadata.stage` for now.
- Add expandable details inside the existing card/list pattern.
- Show metadata sections for agent identity, requested action, tool args, permission snapshot, and raw JSON.
- Implement this as typed TSX components rather than expanding generic `RecordList` rows indefinitely.
- Add narrow helper functions for rendering audit metadata instead of inline object drilling throughout JSX.
- Keep export, advanced filtering, and SIEM integration out of this phase.

Runtime Policies work:

- Keep the existing Runtime Policies page.
- Expand each policy row into a policy summary card.
- Show thresholds, allowed tools, blocked tools, review-required rules, PII behavior, max record limit, and mode.
- Add a collapsible raw config section.
- Type policy config rendering explicitly in the dashboard, even if the backend still returns generic records.
- Do not build a full policy editor yet.

Review Queue work:

- Improve the empty state with a review-triggering test prompt.
- When items exist, show agent, tool, user query, risk score, risk types, reason, created time, and linked session.
- Add approve/deny only after the evidence display is clear.
- Require reviewer note for denial.
- Keep reviewer action components separate from display-only evidence components.

Why this phase first:

- The backend already has most of the data.
- It makes the product easier to demo immediately.
- It avoids major architecture or UI redesign.

### Phase 2: Close Audit Gaps In The Backend

Objective:

- Make audit records defensible enough for compliance and future policy simulation.

Backend changes:

- Add `policy_id` to audit events.
- Add `policy_version` or `policy_snapshot_hash` to audit events.
- Promote `stage` from metadata into a first-class field or consistently populate it in metadata.
- Store enough request context for future simulation: user query, tool name, tool args, agent identity snapshot, policy decision, risk findings, and triggered rules.
- For final response checks, store whether the response was blocked, redacted, or allowed unchanged.
- Add or update Pydantic response models for audit events instead of returning loosely shaped dictionaries.
- Keep audit write logic in governance runtime/store modules, not directly inside UI-facing route handlers.
- Add pytest coverage that proves audit events include policy ID/version, stage, decision, risk metadata, and workflow/session linkage.

UI changes:

- Display policy version/hash in the Audit Events detail view.
- Show whether an audit event was evaluated under the current policy or an older policy.
- Add Zod validation for audit event payloads before rendering policy version and metadata fields.

Do not add yet:

- Full compliance export.
- Policy simulation.
- Complex audit analytics.

### Phase 3: Improve Tool Guardrails Beyond Tool Grants

Objective:

- Move from “agent can use this tool” to “this specific tool call is allowed.”

Current state:

- Agent tool grants already control whether an agent can use a tool at all.
- Existing detector logic already checks risky `search_customers` arguments such as broad search and email exposure.

Next controls:

- Add tool argument validation policies.
- Validate entity scope, such as `customer_id` matching the session context.
- Validate limits, such as search limit and date range.
- Validate side-effect tools before execution.
- Represent validation findings with typed policy result objects, not ad hoc strings.

Implementation approach:

- Keep validation in the governance runtime before tool execution.
- Keep defensive schema/domain validation inside the tools themselves.
- Do not rely on the agent to self-police.
- Use Pydantic models for new tool argument schemas where the shape is known.
- Keep detector functions small and focused by risk category.
- Add tests for allow, review, and block outcomes for each new argument rule.

Recommended first tool rules:

- `search_customers` with empty filter: block or review.
- `search_customers` with `include_email: true`: review.
- `get_customer_profile` with customer ID different from session customer: block.
- `get_customer_transactions` with broad date range or excessive limit: review.
- `update_contact_info`: require review before execution.

Rate limiting controls to add in this phase:

Argument validation alone cannot stop low-and-slow exfiltration — an agent issuing 200 sequential single-record queries against an allowed tool bypasses all tool-level rules. Rate limits are the primary defense.

- Maximum tool calls per session.
- Maximum unique customer or entity IDs accessed per session.
- Maximum failed or blocked tool calls before session suspension.
- Cooldown period enforced after a block decision.

Keep rate limit enforcement in the governance runtime alongside argument validation. Record limit breaches as audit events with their own risk type. Do not implement per-minute rate limits yet — session-level limits are sufficient for the current demo and test scope.

Side-effect control definition:

- A side-effect tool changes data or triggers an external action.
- Examples: update contact info, send email, create ticket, delete record, change permissions, call external service.
- These should support dry-run preview, human approval, before/after audit evidence, and stricter environment controls.

### Phase 4: Add Workflow Guardrail Enforcement

Objective:

- Turn workflow trace metadata into enforceable workflow policy.

Current state:

- Cross-agent handoffs are recorded through workflow session links and delegation metadata.
- Each sub-agent tool call is governed independently.
- Workflow decision aggregation is basic: any `BLOCK` makes the workflow `BLOCK`; otherwise any `REVIEW` makes it `REVIEW`; otherwise `ALLOW`.
- Workflow-level evaluators exist after workflow execution.

Missing controls:

- Handoff allow/deny policy.
- Step-level approval gates.
- Final workflow response approval.
- Configurable risk aggregation.

Recommended implementation:

- Add allowed delegation pairs, such as lead agent to identity agent and lead agent to transaction agent.
- Validate each workflow step before it runs.
- Add step gates: always allow, require review, block.
- Add workflow release gate before final response delivery.
- Compute workflow-level risk from max step risk, blocked count, review count, and high-risk event count.

Minimal first version:

- Validate that every workflow step agent is in the workflow definition.
- Validate that each step agent belongs to the expected environment.
- Validate that lead agent is allowed to delegate to each sub-agent.
- Add workflow-level `requires_review` when any step returns `REVIEW`.
- Add typed workflow guardrail result objects so UI and audit logs do not infer workflow state from strings alone.
- Add backend tests for allowed handoff, denied handoff, step review gate, and workflow risk aggregation.
- Keep workflow trace UI changes additive: show gate status and aggregation result inside the existing trace layout.

### Phase 5: Add Model Gateway Guardrails

**Prerequisite: This phase does not start until an LLM gateway service exists.** The platform currently routes tool calls but does not route model calls. If no gateway is planned, this phase is deferred indefinitely and does not block any other phase.

Objective:

- Govern model calls consistently once the LLM gateway is introduced.

Where this belongs:

- Model guardrails should live in the LLM gateway because the gateway is the central enforcement point for prompts, model selection, and model responses.

Model gateway controls:

- Model allowlist per agent and environment.
- Prompt/input checks.
- System prompt protection.
- Prompt injection detection.
- Max token and parameter limits.
- Output PII detection and redaction.
- Blocked output patterns.
- Response schema validation.
- Model-call audit logging.

Relationship to existing agent guardrails:

- Keep tool, argument, side-effect, and workflow controls in the agent governance runtime.
- Move or share prompt/output safety checks with the model gateway when it exists.
- Keep audit events linked by session, workflow, agent, and model call ID.

Minimal first version:

- Add a gateway request/response audit record.
- Enforce model allowlist.
- Reuse final-response PII and blocked-pattern checks.
- Link model audit events back to agent sessions.
- Define Pydantic models for gateway request, gateway response, and model audit event payloads.
- Keep the gateway entry point thin and put guardrail decisions in dedicated gateway/policy modules.
- Add dashboard types/Zod schemas before rendering model audit events.

### Phase 6: Policy Simulation And Export

Objective:

- Help governance leads safely change policy and produce audit evidence.

Policy simulation:

- Simulate against captured policy decision records or session snapshots, not only audit rows.
- Show decision changes: was `ALLOW`, would become `REVIEW`; was `ALLOW`, would become `BLOCK`.
- Show impact summary: changed decisions, block-rate change, review-rate change, affected agents, affected tools.
- Do not mutate live records.
- Implement simulation as a backend service with typed inputs/outputs.
- Add pytest coverage proving simulation does not mutate live audit, policy, or review records.
- Render simulation results with discriminated union state in TSX: idle, loading, success, error.

Audit export:

- Add filtered CSV export first.
- Add JSON export after the audit detail model is stable.
- Respect RBAC by environment.
- Add export audit logging.
- Support masked export and full export separately.
- Treat export as sensitive. Add explicit backend audit logging for export requests.
- In the frontend, keep export controls scoped to the Audit Events page and validate export options before submission.

Do not start this phase until:

- Audit events include policy version.
- Audit detail views are usable.
- Sensitive metadata handling is clear.

## Product Priority

Highest priority:

1. Improve Audit Events so records show agent, tool, stage, risk type, workflow/session, and metadata.
2. Record policy version/hash and stage consistently for audit events.
3. Improve Review Queue empty and populated states so testing and reviewer workflows are clear.
4. Expand Runtime Policies so users can see actual controls, thresholds, and review routing.

Secondary priority:

1. Add policy detail drawers.
2. Add audit grouping by workflow/session.
3. Add tool argument validation and session scope binding.
4. Add side-effect controls for write/external tools.
5. Add review history views.
6. Add risk trend summaries.
7. Add SLA countdown to the review queue.
8. Add Zod schemas for dashboard API records as views become richer.

Later:

1. Workflow handoff allow/deny policy.
2. Step-level and final-response approval gates.
3. Model gateway guardrails (gated on LLM gateway existing).
4. Policy simulation.
5. Audit export for compliance download.
6. Batch actions and smart context panel in review queue.
7. Agent health scorecard per agent.
