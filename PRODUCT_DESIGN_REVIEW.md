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

Expected outcome:

- Decision: `ALLOW` with PII redacted in response
- Tool executes
- Response is returned with email and phone masked
- Audit event is written with `risk_type: pii_exposure` and decision `ALLOW_WITH_REDACTION`
- No review queue item

Screens to check:

- Audit Events (confirm redaction was applied and logged)
- Runtime Policies (confirm `redact_pii_in_response: true`)

This scenario is important because it shows that governance is not binary. There is a governed middle path between blocking everything and allowing everything through unmodified.

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

## Product Priority

Highest priority:

1. Improve Audit Events so records show agent, tool, stage, risk type, workflow/session, and metadata.
2. Expand Runtime Policies so users can see actual controls, thresholds, and review routing.
3. Improve Review Queue empty and populated states so testing and reviewer workflows are clear.

Secondary priority:

1. Add policy detail drawers.
2. Add audit grouping by workflow/session.
3. Add review history views.
4. Add risk trend summaries.
5. Add policy simulation (dry-run preview before publishing changes).
6. Add audit export for compliance download.
7. Add SLA countdown and batch actions to the review queue.

Later:

1. Rate limiting controls in runtime policy.
2. Session scope binding controls.
3. Policy version recorded at audit event time.
4. Smart context panel in review queue.
5. Agent health scorecard per agent.

