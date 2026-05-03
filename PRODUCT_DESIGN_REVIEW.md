# IntelliGuard Product Design Review

## Context

IntelliGuard is a domain-agnostic runtime governance platform for AI agents, agentic workflows, CLIs, and microservices. It intercepts model calls, agent actions, workflow handoffs, and tool calls; evaluates them against deterministic policy; records decisions in Postgres; routes risky actions into a human review queue; and renders audit evidence in the dashboard.

Customer support is only the current demo domain. The platform should be designed to govern many domain-specific workflows, such as banking support, insurance claims, healthcare intake, legal review, HR operations, security operations, finance reconciliation, procurement, and IT service management.

The current platform already has many of the right starting primitives:

- Runtime guardrail policies
- Agent and tool marketplace identities
- Agent tool grants
- Policy decisions
- Audit events
- Review queue
- Workflow traces
- Multi-agent workflow runs

The platform is structured around two surfaces:

**Control Plane** — an agent registry and optional agent factory where users register or build configured agents, register tools, and attach guardrails, evaluators, and knowledge bases to those agents.

**Agentic Workflows** — where users design domain-specific workflows using a graph editor (Workflow Designer), run them, and monitor their governed execution. The graph defines which registered agent nodes participate, each node's workflow role, when each node activates, and which handoffs the lead agent may use dynamically based on the user request.

The governance runtime cuts across both surfaces. It enforces policy on every action regardless of which workflow is running or which agents are active.

The next product step is to evolve the workflow primitives into:

- Domain workflow registry with relationship graph definitions
- Lead-agent routing decisions as first-class audit records
- Agent graph nodes with shared type vocabulary and explicit activation policies
- Domain-neutral policy, review, and audit evidence

The main product design opportunity is to make the runtime policy, review, and audit surfaces show the governance evidence in a way that helps a governance lead understand what happened, why it happened, and what action is needed.

## Product Positioning

IntelliGuard should not be positioned as a customer support product. It should be positioned as a governance control plane for domain-specific agentic workflows.

Recommended product statement:

> IntelliGuard is a domain-agnostic governance platform for building, registering, and running AI agent workflows. Teams use it to register or build configured agents, compose them into domain-specific workflows, and enforce guardrails, human review, and audit evidence across every agentic execution.

The platform is the rails. The agents and workflows are domain-specific things users register, build, compose, and run on those rails.

The core platform model is:

```text
IntelliGuard
  ├── Control Plane (register, build, and configure)
  │     ├── Agent Registry     → unique configured agent identities
  │     ├── Agent Builder      → optional native agent creation
  │     ├── Agent Harnesses    → runtime adapters for external agents
  │     ├── Tool Registry     → tools with side-effect levels and access controls
  │     ├── Guardrail Engine  → attach runtime policies to agents
  │     ├── Evaluator Engine  → attach evaluators to agents
  │     └── Knowledge Bases   → attach KBs to agents
  │
  ├── Agentic Workflows (compose and run)
  │     ├── Workflow Designer  → graph editor for domain workflow definitions
  │     ├── Lead Agent Nodes   → receive requests and route workflow execution
  │     ├── Gate/Task Nodes    → perform domain checks and domain work
  │     └── Review/Approval/Terminal Nodes → govern and release outcomes
  │
  └── Governance Runtime (enforce across everything)
        ├── Guardrail evaluation on every action
        ├── Human review routing when policy triggers
        └── Audit evidence across all agents, handoffs, and decisions
```

Domain workflows are reusable governed operating contexts. A domain workflow is a relationship graph that defines which lead node owns the request, which agent nodes may run, when those nodes activate, what tools those nodes may use, what policies apply, and which runtime events require review.

Examples:

- Banking account inquiry workflow
- Insurance claim review workflow
- Healthcare intake workflow
- HR onboarding workflow
- Legal document review workflow
- Security incident triage workflow
- Customer support investigation workflow

The customer support workflow should remain a demo workflow that proves the governance pattern. It should not leak into platform naming, product architecture, or generic policy concepts.

Agent execution modes:

| Mode | Meaning | Governance strength |
|---|---|---|
| Native | Built and run by IntelliGuard | Strongest |
| Harnessed external | Built elsewhere, invoked through an IntelliGuard Agent Harness | Strong |
| Observed external | Runs elsewhere and only emits logs or events into IntelliGuard | Weak, audit-only |

The product should make this distinction explicit. If IntelliGuard does not mediate an agent's tool calls, handoffs, and final response, it can observe the agent but cannot fully govern the workflow.

## Domain Workflow Model

The platform supports domain-specific workflows composed of agents that users register or build in the Control Plane.

A workflow is a **relationship graph**, not a fixed linear script. It is a governed operating environment defined by:

- Domain name
- Agent nodes using the shared controlled vocabulary
- Edges — delegation relationships and capability connections between graph nodes
- Activation policies and activation stages
- Tool access per node
- Runtime guardrail policy bindings
- Human review rules
- Audit and evidence requirements

Use one shared controlled vocabulary for registered agents and workflow nodes:

```text
agent_type / node_type
  -> lead_agent
  -> gate_agent
  -> task_agent
  -> review_agent
  -> approval_agent
  -> terminal_agent
```

Definitions:

- `lead_agent`: receives the request, routes intent, coordinates workflow execution, and aggregates results.
- `gate_agent`: performs required checks before progress, such as authentication, consent, eligibility, or prerequisite validation.
- `task_agent`: performs domain work, such as lookup, analysis, recommendation, or update preparation.
- `review_agent`: reviews outputs, risk, compliance, quality, or final-response safety.
- `approval_agent`: coordinates or represents human approval checkpoints.
- `terminal_agent`: produces, validates, or releases the final response or result.

The Workflow Designer must enforce:

```text
node.node_type == registered_agent.agent_type
```

This removes the need for separate agent-category and graph-role mapping tables. `sub_agent`, `specialist_agent`, `lead_orchestrator`, `essential`, `optional`, and `standalone_agent` should not be used as future product vocabulary.

A registered `agent_id` represents a unique configured agent. If the same underlying agent runtime is configured with different tools, knowledge bases, policies, or workflow responsibilities, it must be registered as a different `agent_id`. Runtime overrides to tools, knowledge bases, policies, or graph role are not allowed under the same `agent_id`; those changes require a new registered agent identity or a new versioned agent identity.

The graph defines the **possibility space**: which agents exist, what they can do, when they can activate, and which handoffs are permitted. The lead agent decides the **execution path** within that space at runtime based on the user request. The governance runtime enforces that execution stays inside the graph and inside policy.

```text
User request
  -> Lead agent receives request
  -> Always-on pre-route gate agents activate, such as authentication or intake
  -> Lead agent selects conditional task agents based on request intent
  -> Governance runtime validates each selected handoff against the registered graph
  -> Selected agents request tools
  -> Runtime guardrails evaluate each action
  -> Risky actions pause for human review
  -> Approved actions resume, denied actions stop
  -> Final-stage review or terminal agents activate, such as outcome review
  -> Final response is checked and audited
  -> Lead agent routing decision is recorded as an audit event
```

Use `activation_policy` and `activation_stage` instead of `essential` and `optional`.

```text
node
  -> node_id
  -> agent_id
  -> node_type
  -> activation_policy  # always | conditional | on_risk | human_required
  -> activation_stage   # pre_route | routed | pre_tool | post_tool | final_review
```

This lets a workflow require authentication before routing, conditionally invoke domain task agents, trigger review agents only when risk is detected, and require final response review without treating those cases as the same execution behavior.

The lead routing decision should be recorded as a concrete audit event, not only as a generic "lead agent ran" trace.

```text
LEAD_ROUTING_DECISION
  -> workflow_run_id
  -> workflow_definition_id
  -> graph_version_hash
  -> lead_agent_id
  -> user_request_id or session_id
  -> user_intent
  -> selected_node_ids[]
  -> skipped_conditional_node_ids[]
  -> required_nodes_activated[]
  -> handoff_edges_used[]
  -> routing_reason
  -> policy_snapshot_hash
  -> decision_timestamp
```

A workflow run is not compliant unless every activated node exists in the registered graph, every used handoff edge exists in the graph version identified by `graph_version_hash`, and every required node for the executed activation stages is present in `required_nodes_activated`.

Review is triggered by runtime risk discovered during a normal user request. It is not a hardcoded workflow step. A review-triggering script can exist as a test harness, but any domain workflow can create review items when policy requires it.

### Lead Agent Responsibilities

The lead agent should:

- Interpret the user request.
- Select the domain workflow if not already fixed by the entry point.
- Determine which conditional nodes are needed.
- Enforce required activation stages, such as authentication, intake, approval, or final review.
- Delegate work to graph nodes through registered edges.
- Collect graph node outputs.
- Respect guardrail decisions.
- Stop, pause, or continue the workflow based on policy outcomes.
- Produce a final response only after final-response checks pass.

The lead agent should not be trusted as the policy authority. It proposes the plan and delegates tasks, but the governance runtime enforces whether actions are allowed, reviewed, or blocked.

### Agent Node Responsibilities

Every workflow node is backed by a registered configured agent. The node type describes the role that agent plays in the graph, and the agent's `agent_type` must match the node's `node_type`.

- `lead_agent`: routes the request, selects conditional nodes, records routing reasons, and aggregates results.
- `gate_agent`: performs required checks before progress, such as authentication, consent, eligibility, or prerequisite validation.
- `task_agent`: performs domain work, such as account lookup, claim review, transaction analysis, document review, or update preparation.
- `review_agent`: reviews outputs, risk, compliance, quality, or final-response safety.
- `approval_agent`: coordinates human approval checkpoints and records approval state.
- `terminal_agent`: produces, validates, or releases the final response or result.

Each registered agent should have:

- Agent identity and type from the shared vocabulary
- Environment
- Owner
- Allowed tools
- Allowed actions
- Data scope
- Side-effect level
- Assigned guardrail policy
- Evaluation policy
- Native, harnessed external, or observed external execution mode

### Runtime Review Model

Human review should be created when runtime policy detects risk, not because a workflow has a hardcoded review step.

Review-triggering examples:

- Authentication failed or incomplete.
- Agent requests data outside authenticated session scope.
- Tool arguments reference a different account, customer, patient, claim, employee, or case.
- Agent requests sensitive PII or regulated data exposure.
- Agent requests high-value financial transaction access.
- Agent requests a write/update/delete action.
- Agent tries to send external communication.
- Agent attempts unusual delegation or a disallowed handoff.
- Risk score reaches the review threshold.

Current review-trigger scripts should be treated as demo/test harnesses only. They are useful for QA and demos because they create predictable pending review items, but they are not the target product abstraction.

## Current Product State

### Domain Workflows

The current codebase has multi-agent workflow runs and a Workflow Builder, but the workflow model still behaves mostly like a configured sequence of steps. To meet the platform goal, workflow definitions need to evolve into domain workflow definitions.

Current gap:

- Workflows are not yet clearly modeled as reusable domain operating contexts.
- Lead-agent routing decisions are not first-class records.
- Specialist agents are available as identities, but workflow definitions do not yet clearly express graph nodes, activation stages, edges, and capability maps.
- Current implementation labels such as `lead_orchestrator`, `sub_agent`, and `specialist_agent` should be treated as legacy labels and migrated to the shared `agent_type / node_type` vocabulary.
- Current demo workflows are customer-support-oriented and should remain examples, not platform assumptions.
- Review can be triggered by runtime policy, but approved reviews do not yet resume paused workflow execution.

Target state:

- A domain workflow defines the lead node, agent nodes, node types, activation policies, activation stages, edges, capabilities, tool scopes, policy bindings, and review rules.
- The lead agent chooses which conditional nodes to activate based on the user request.
- The governance runtime validates every selected node, handoff, tool call, argument, side effect, and final response.
- Review is created when runtime policy detects risk during a normal domain workflow.
- Audit evidence links the user request, workflow, lead agent, activated nodes, tools, policy decisions, review decisions, and final response.

### Runtime Policies

The Runtime Policies screen originally showed only:

- Policy name
- Policy description
- Environment

The first implementation pass now exposes more policy controls, including thresholds, tool access, argument validation, side-effect controls, review routing, and response safety. The underlying policy model still needs to become more domain-neutral and workflow-aware.

The policy surface should continue expanding to show:

- Allowed tools
- Blocked tools
- Blocked prompt/output patterns
- Maximum returned records
- PII block/redaction behavior
- Review-required risk types
- Review and block thresholds
- Scoped entity rules across domains
- Workflow handoff and approval gates
- Model gateway controls once the gateway exists

The product issue is not only lack of backend data. The issue is making the enforced control model legible enough that a governance lead can understand what is enforced across domains, agents, workflows, tools, and runtime stages.

### Review Queue

The Review Queue screen now supports populated review cards with evidence, reviewer notes, approve, and deny actions. It still needs a stronger domain workflow context.

When there are no pending review records, the UI should help users understand how review works and how to generate a review scenario during demo/testing. When there are pending records, the reviewer should see the original user request, workflow, lead agent, specialist agent, tool, arguments, risk findings, policy reason, and approval impact.

### Audit Events

The Audit Events screen originally flattened live records into repeated rows like:

- `ALLOW`
- `BLOCK`
- Reason
- Risk score

The first implementation pass improved the evidence display with structured rows and expandable metadata. The next gap is making audit evidence domain-aware and workflow-aware enough to answer:

- Which agent caused the event
- Which tool was requested
- Whether the event happened pre-tool, post-tool, or final-response
- Which workflow or session it belongs to
- Which risk type was detected
- Which policy rule triggered
- What evidence was captured in metadata
- Which domain workflow was running
- Which lead-agent routing decision activated the specialist
- Whether the event happened before or after human approval

The audit data is useful, but it should become the system of record for domain workflow governance, not only a list of individual tool-call decisions.

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
- Subject/user/entity scope
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

Generic review-required risk patterns include:

- `bulk_entity_search`
- `sensitive_data_exposure`
- `high_value_resource_access`
- `side_effect_action`
- `cross_scope_entity_access`

Current customer-support demo risk type examples include:

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

For multi-agent workflows, governance should cover graph routing, node activation, and node behavior.

Recommended controls:

- Which graph nodes can hand off to which nodes
- Which node types can request which tools
- Whether lead agents can override decisions
- Whether `review_agent` decisions are advisory or blocking
- Whether `approval_agent` is required before continuation
- Whether workflow-level approval is required before response delivery

This is important because the platform is positioned around agentic workflows, not only single-agent calls.

### 7. Anomaly Controls

Add controls that detect suspicious runtime behavior.

Recommended controls:

- Repeated failed tool calls
- High-volume record access
- Repeated access to the same subject/entity
- Unusual agent/tool combination
- Tool calls outside normal workflow order
- Too many blocked or reviewed actions in one session

These controls make the platform feel more like a governance control plane and less like a static rule checker.

### 8. Rate Limiting Controls

Add controls that cap how much an agent can do within a session or time window.

Recommended controls:

- Maximum tool calls per session
- Maximum tool calls per minute (deferred; Phase 3 implements session-level limits first)
- Maximum unique subjects or entities accessed per session
- Maximum failed tool calls before session suspension
- Cooldown period after a block decision

Without rate limiting, a well-scoped allowlist still cannot stop an agent that issues 200 sequential single-record queries to exfiltrate a dataset. Rate limits are the primary defense against low-and-slow data exfiltration.

### 9. Session Scope Binding

Add controls that validate tool arguments against the declared session context.

Recommended controls:

- Require that scoped entity IDs in tool arguments match the authenticated or declared session subject
- Block tools that reference entity IDs not established in the session context
- Flag when an agent attempts to pivot from the declared subject to a different entity mid-session

This control is distinct from tool allowlists. A tool can be allowed in general but still be disallowed if it is being used for an entity outside the session scope.

Domain-specific examples:

- Banking: `account_id` must match the authenticated account scope.
- Customer support: `customer_id` must match the verified customer scope.
- Healthcare: `patient_id` must match the consented patient scope.
- Insurance: `claim_id` must belong to the authenticated policyholder or assigned case.
- HR: `employee_id` must match the authorized employee or HR case scope.

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

> No pending reviews. Run a review-triggering domain scenario, such as a sensitive data request or write action that requires approval, to create a review item.

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
- Whether the same subject/entity has appeared in recent blocked events
- Whether the risk score is above or below the median for this risk type

These signals do not make the decision. They give the reviewer calibration data so the decision is better informed.

## Demo And Testing Workflow

Use golden test scenarios for product demos, QA, and regression checks. These scenarios should be framed as examples of the generic governance model, not as the only supported product domain.

The current customer support scenarios are useful demo fixtures because they are easy to understand and already map to the current local tools. Longer term, each supported demo domain should have its own golden path:

- Banking support: account inquiry, sensitive transaction review, contact update approval.
- Insurance: claim lookup, document review, payment recommendation approval.
- Healthcare: intake, consent check, records access review.
- HR: employee record lookup, profile update approval.
- Security operations: incident triage, external notification approval.

The important product behavior is consistent across domains:

```text
User request
  -> Lead agent routes to specialists
  -> Runtime policy evaluates model/tool/workflow actions
  -> Safe actions are allowed
  -> Risky actions pause for review
  -> Unsafe actions are blocked
  -> Final response and audit evidence are recorded
```

### 1. Safe Path

Current customer support demo prompt:

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

Current customer support demo prompt:

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

Current customer support demo prompt:

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

Current customer support demo prompt:

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

Current customer support demo prompt:

Prompt:

```text
Investigate recent transactions for customer C123 and prepare a safe support summary
```

Use the multi-agent run endpoint or the Workflow Builder.

Expected outcome:

- Lead agent routes to identity `gate_agent` and transaction `task_agent` nodes
- Each activated graph node is governed independently
- Audit events are written per node session
- Workflow trace shows all steps with per-step decisions
- Final response is gated by the response safety check

Screens to check:

- Agentic Workflows (confirm the run appears)
- Workflow Trace (confirm all steps are visible with decisions)
- Audit Events (confirm events span multiple session IDs linked to the workflow)
- Review Queue (if any step triggered review)

This scenario demonstrates that governance spans across agent boundaries, not only within a single agent call.

### 6. Domain Workflow Routing Path

Target platform scenario:

```text
I need to check my bank account.
```

Expected outcome:

- Lead agent receives the user request.
- Lead agent selects the banking account inquiry workflow.
- Identity or authentication specialist runs first.
- Account or transaction specialists are invoked only if authentication succeeds.
- Tool calls are scoped to authenticated account or customer context.
- Risky requests, such as high-value transaction access or account detail exposure, create review items.
- Final response is checked for sensitive data leakage.
- Audit events link user request, workflow, lead agent, specialist agents, tool calls, policy decisions, and review outcomes.

Screens to check:

- Agentic Workflows
- Workflow Trace
- Review Queue
- Audit Events
- Runtime Policies

Current implementation note:

- The current `review_trigger_workflow.py` script is a test harness that installs or runs a predictable review-triggering workflow.
- It should not be treated as the target product workflow model.
- The target model is dynamic domain workflow routing, where review emerges from policy decisions during normal user-request execution.

## Recommended Product Flow For Demo

Use this flow when testing or presenting the platform:

1. Start in the Agentic Workflows page and show the domain workflow list.
2. Open a demo workflow, such as customer support investigation or banking account inquiry.
3. Show the lead node, agent nodes, node types, activation policies, activation stages, and graph edges.
4. Open Runtime Policies and show the active controls.
5. Run the safe path and show an allowed audit trail.
6. Run the review path and resolve the review item.
7. Run the block path and show why it was denied.
8. Open Workflow Trace to connect all events into a run-level story.
9. Open Audit Events and inspect the evidence drawer.

This tells the core product story:

> Register domain workflows, govern lead and specialist agent behavior, route risky runtime actions to humans, and preserve evidence for audit.

## Implementation Plan For Further Work

### Implementation Status

#### Ready for Review

| Item | Phase | Notes |
|---|---|---|
| Audit Events row redesign — stats bar, colored evidence badges, column reorder (Agent, Reason, Stage, Risk, Decision, Time), decision filter pills, left-border accent | Phase 1 | Implemented in dashboard; light/dark mode contrast fixed via CSS class overrides |
| Review Queue populated states — agent, tool, user query, risk score, reason, approve/deny actions, reviewer note required for denial, status filter (All/Pending/Approved/Denied) | Phase 1 | Implemented in dashboard |
| Landing page product-neutral copy and gateway wording | Positioning | Commits landed |

#### To Be Started

| Item | Phase |
|---|---|
| Runtime Policies summary cards — thresholds, allowed/blocked tools, review routing, PII behavior | Phase 1 |
| Domain workflow surfaces reframe — graph nodes, node types, activation stages, edges, policy bindings | Phase 1B |
| Close audit backend gaps — `policy_id`, `policy_version`, promote `stage` to first-class field | Phase 2 |
| Tool argument validation and session scope binding | Phase 3 |
| Rate limiting controls (session-level) | Phase 3 |
| Domain workflow graph definition with lead-routing audit payload | Phase 4 |
| Workflow pause/resume after human approval | Phase 4 |
| Model gateway guardrails | Phase 5 |
| Policy simulation and audit export | Phase 6 |
| Evaluator system — tool/agent/workflow certification, LLM-as-judge, judge calibration | Evaluation Center |

---

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

### Platform Architecture Direction

The codebase should move toward a domain-agnostic workflow governance architecture built around two surfaces: an agent registry and optional agent factory (Control Plane) and a workflow graph composer (Agentic Workflows).

Current demo-specific customer support code is acceptable as a sample, but platform modules should not encode customer support as the product model. New implementation should separate:

- Generic governance runtime (domain-agnostic, always enforced)
- Domain workflow graph definitions (user-authored, domain-specific)
- Demo workflow fixtures (sample graphs for customer support, banking, etc.)
- Domain-specific tools and agents (registered or built via Control Plane, referenced in graphs)
- Agent harness adapters for external agents that were created outside IntelliGuard
- Policy and review enforcement (domain-agnostic, applied per agent and workflow)

Recommended workflow graph abstraction:

```text
DomainWorkflow
  -> workflow_id
  -> domain
  -> graph_version_hash
  -> lead_node_id
  -> nodes[]                # all agents in the graph
        -> node_id
        -> agent_id
        -> node_type         # lead_agent | gate_agent | task_agent | review_agent | approval_agent | terminal_agent
        -> activation_policy # always | conditional | on_risk | human_required
        -> activation_stage  # pre_route | routed | pre_tool | post_tool | final_review
        -> capabilities
        -> allowed_tools
        -> data_scope
        -> side_effect_level
  -> edges[]                # permitted delegation relationships
        -> edge_id
        -> from_node_id
        -> to_node_id
        -> conditions        # when this handoff is permitted
  -> policy_bindings
  -> review_rules
```

Edges are pure graph-topology records. They should not duplicate source or target agent identities, because agent identity is derivable through `node_id -> agent_id`. This avoids stale edge records if a graph node is edited before publishing a new graph version.

Nodes activate according to their configured `activation_policy` and `activation_stage`. Conditional nodes are available for the lead agent to select based on request intent. The governance runtime validates every handoff against the registered edge list — an agent cannot delegate to a node that has no edge in the graph.

The Workflow Designer should let users build this graph visually: add agent nodes, select a node type from the shared vocabulary, set activation policy and stage, draw delegation edges, and attach policy bindings. The runtime uses the graph as the constraint set the lead agent must operate within.

Required lead-routing audit payload:

```text
LEAD_ROUTING_DECISION
  -> workflow_run_id
  -> workflow_definition_id
  -> graph_version_hash
  -> lead_agent_id
  -> user_request_id or session_id
  -> user_intent
  -> selected_node_ids[]
  -> skipped_conditional_node_ids[]
  -> required_nodes_activated[]
  -> handoff_edges_used[]
  -> routing_reason
  -> policy_snapshot_hash
  -> decision_timestamp
```

The routing audit event must prove that the runtime stayed inside the approved graph version. `handoff_edges_used[]` records which registered edges were traversed, and `required_nodes_activated[]` records which required nodes ran.

External agents:

- Control Plane should support native agents and external agents.
- External agents can participate in Agentic Workflows only through an IntelliGuard Agent Harness contract.
- The harness defines invocation method, input schema, output schema, timeout behavior, health checks, tool mediation mode, and audit emission.
- If IntelliGuard does not mediate the external agent's tool calls, handoffs, and final response, the platform can only observe the agent. It cannot fully govern the workflow.

Implementation rules:

- Do not add more customer-support-specific behavior to generic platform modules.
- Keep customer support, banking, insurance, healthcare, and other examples as explicit sample workflow graphs or fixtures.
- Keep policy, review, audit, and workflow enforcement domain-neutral.
- Control Plane and Workflow Designer must use the same controlled vocabulary for `agent_type` and `node_type`.
- Workflow Designer must reject a graph node when `node.node_type` does not match the selected agent's `agent_type`.
- A registered `agent_id` is a unique configured agent identity. Different tools, knowledge bases, policies, workflow responsibilities, or external harness configurations require a different `agent_id` or a new versioned agent identity.

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

### Phase 1B: Reframe Workflow Surfaces As Domain Workflows

Objective:

- Make the UI and data model communicate that IntelliGuard governs many domain workflows, not only one customer-support scenario.

Scope:

- Rename or reframe the workflow list as Domain Workflows where appropriate.
- Show workflow domain, lead node, graph nodes, node types, activation policies, activation stages, graph edges, and active policy binding.
- Keep existing Agentic Workflows navigation if changing labels would be too disruptive, but make the content domain-oriented.
- Treat "Domain Workflows" as the conceptual label for the governed workflow definitions shown inside the existing Agentic Workflows page, not necessarily a separate route.
- Treat current customer support workflows as demo entries.
- Add at least one non-customer-support sample definition, such as banking account inquiry, without hardcoding new domain behavior into generic runtime modules.

Domain workflow card should show:

- Domain
- Workflow name
- Lead agent
- Node count
- Node types
- Activation policies
- Activation stages
- Edge count
- Review rules
- Environment
- Last run decision

Workflow detail should show:

- Lead node responsibility
- Agent nodes by type
- Activation policy and stage for each node
- Capabilities each node provides
- Tools each node can request
- Registered handoff edges
- Policy assignment
- Review and approval gates
- Recent runs and audit evidence

Backend work:

- Introduce typed workflow definition structures for domain, graph nodes, graph edges, shared node/agent type vocabulary, activation policies, activation stages, and policy bindings.
- Keep existing JSONB compatibility while adding typed parsing at the service boundary.
- Move demo workflow definitions into explicit example scripts or fixtures, not database bootstrap.
- Ensure workflow records can represent dynamic specialist activation rather than only a fixed list of steps.
- Add a graph version hash and concrete `LEAD_ROUTING_DECISION` audit payload.

Testing:

- Add tests for installing a sample domain workflow definition.
- Add tests for lead-agent routing metadata.
- Add tests that review is triggered by runtime policy during a normal domain workflow run.

Do not add yet:

- Full autonomous planning.
- LLM-based routing.
- Workflow resume after approval.

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
- The current customer support rules should be treated as demo-specific examples of generic scoped entity validation.

Next controls:

- Add tool argument validation policies.
- Validate entity scope, such as account, customer, patient, claim, employee, case, or ticket ID matching the session context.
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

- Empty or broad search filter: block or review.
- Sensitive data exposure flag, such as `include_email: true`: review.
- Scoped entity ID different from authenticated session entity: block.
- Broad date range or excessive result limit: review.
- Write/update/delete action: require review before execution.

Rate limiting controls to add in this phase:

Argument validation alone cannot stop low-and-slow exfiltration — an agent issuing 200 sequential single-record queries against an allowed tool bypasses all tool-level rules. Rate limits are the primary defense.

- Maximum tool calls per session.
- Maximum unique subject or entity IDs accessed per session.
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
- Each activated graph node tool call is governed independently.
- Workflow decision aggregation is basic: any `BLOCK` makes the workflow `BLOCK`; otherwise any `REVIEW` makes it `REVIEW`; otherwise `ALLOW`.
- Workflow-level evaluators exist after workflow execution.
- Current workflow execution is closer to configured step execution than true lead-agent dynamic routing.
- Approved reviews do not yet resume paused workflow execution.

Missing controls:

- Domain workflow graph definition with nodes, edges, shared node/agent types, activation policies, activation stages, and capabilities.
- Lead-agent routing decision audit payload.
- Conditional node activation based on user request.
- Handoff allow/deny policy.
- Step-level approval gates.
- Final workflow response approval.
- Workflow pause/resume after human approval.
- Configurable risk aggregation.

Recommended implementation:

- Add allowed graph edges, such as lead node to identity node, account node, transaction node, claims node, or other domain-specific task/review nodes.
- Add a lead-agent routing event that records selected nodes, skipped conditional nodes, required nodes activated, handoff edges used, and routing reason.
- Validate each activated graph node before it runs.
- Add step gates: always allow, require review, block.
- Add workflow pause/resume state so approved review decisions can continue the pending action or node.
- Add workflow release gate before final response delivery.
- Compute workflow-level risk from max step risk, blocked count, review count, and high-risk event count.

Minimal first version:

- Validate that every activated graph node is in the workflow graph definition.
- Validate that each node's registered agent belongs to the expected environment.
- Validate that each handoff uses a registered graph edge.
- Validate that required nodes for the executed activation stages are present in the routing audit payload.
- Persist enough paused execution state to resume idempotently after review approval.
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

1. Reframe platform surfaces around domain-agnostic workflow governance, not customer support.
2. Improve Audit Events so records show agent, tool, stage, risk type, workflow/session, and metadata.
3. Record policy version/hash and stage consistently for audit events.
4. Improve Review Queue empty and populated states so testing and reviewer workflows are clear.
5. Expand Runtime Policies so users can see actual controls, thresholds, and review routing.

Secondary priority:

1. Add domain workflow definition support for graph nodes, graph edges, activation stages, and capabilities.
2. Add concrete lead-agent routing decision audit payloads.
3. Add workflow pause/resume after human approval. This requires async execution state, idempotent continuation, and clear handling for denied or expired reviews.
4. Add policy detail drawers.
5. Add audit grouping by workflow/session.
6. Add tool argument validation and session scope binding.
7. Add side-effect controls for write/external tools.
8. Add review history views.
9. Add risk trend summaries.
10. Add SLA countdown to the review queue.
11. Add Zod schemas for dashboard API records as views become richer.

Later:

1. Dynamic LLM-based lead-agent routing.
2. Workflow handoff allow/deny policy.
3. Step-level and final-response approval gates.
4. Model gateway guardrails (gated on LLM gateway existing).
5. Policy simulation.
6. Audit export for compliance download.
7. Batch actions and smart context panel in review queue.
8. Agent health scorecard per agent.
