# IntelliGuard Workflow Specification

## Product Contract

IntelliGuard is a runtime governance layer for AI agents, CLIs, and microservices.
It intercepts sensitive tool calls, applies deterministic policy, stores every decision
in Postgres, and renders each agent run as an auditable workflow trace.

## Actors

- Agent developer: integrates through the Python SDK or HTTP API.
- Microservice developer: calls the evaluate-only or gateway API before sensitive work.
- Governance reviewer: approves or denies actions in the review queue.
- Operations manager: monitors risk trends, blocked actions, and marketplace activity.

## Integration Modes

### SDK Mode

Python agents import `GovernedToolRunner` and call tools through the SDK.

```python
runner.call_tool(
    session_id="sess_123",
    user_query="Show transactions for C123",
    tool_name="get_customer_transactions",
    tool_args={"customer_id": "C123"},
)
```

### API Evaluate-Only Mode

Microservices ask the governance API for a decision, then execute their own action
only when the decision is `ALLOW`.

```http
POST /v1/evaluate-tool-call
```

### API Gateway Mode

The governance API evaluates the request and executes a marketplace tool when allowed.

```http
POST /v1/governed-tool-call
```

## Runtime Workflow

Every governed agent session emits workflow events that can be reconstructed as a graph:

```text
User Prompt
  -> Agent Identity Loaded
  -> Tool Call Requested
  -> Agent Permission Check
  -> Governance Check
  -> Policy Decision
  -> Tool Executed / Review Queued / Blocked
  -> Tool Result Check
  -> Final Response Check
  -> Response Returned
  -> Audit Written
```

Multi-agent workflows add a parent workflow run record and link multiple agent
sessions under that workflow:

```text
Workflow Run
  -> Lead Agent Session
  -> Identity Verification Sub-Agent Session
  -> Transaction Analyst Sub-Agent Session
  -> Risk Review Sub-Agent Session
```

The dashboard groups traces by `workflow_id` first, then lets reviewers inspect each
lead or sub-agent session independently.

## Decision Semantics

- `ALLOW`: the tool or response is permitted.
- `REVIEW`: the action is paused and inserted into `review_queue`.
- `BLOCK`: the action is denied before unsafe execution or response delivery.

The policy engine is final authority. LLM judges may be added later as advisory
detectors, but deterministic thresholds decide enforcement.

## Inspection Points

### Pre-Tool Check

Inputs:

- `agent_id`
- marketplace agent identity
- agent permission grants
- `session_id`
- `user_query`
- `tool_name`
- `tool_args`

Checks:

- agent is granted the requested tool
- blocked prompt patterns
- allowed and blocked tools
- risky argument shapes
- bulk customer search
- email exposure requests
- repeated failed tool calls

### Post-Tool Result Check

Inputs:

- tool result
- returned record count
- policy limits

Checks:

- excessive record return
- unexpected PII in result

### Final Response Check

Inputs:

- drafted final response
- policy

Checks:

- PII leakage
- blocked patterns in generated text

## Workflow Event Schema

Each workflow event has:

- `event_id`
- `session_id`
- `agent_id`
- `event_type`
- `label`
- `status`
- `payload`
- `created_at`

Important workflow payload metadata:

- `agent_identity`: display name, owner, environment, type, purpose, and metadata.
- `permission_snapshot`: tool grants, action grants, and access scopes at decision time.
- `requested_action`: normalized action derived from the requested tool.
- `findings`: detector-level risk findings with rule IDs, scores, reasons, and metadata.
- `result_summary`: record count, returned fields, PII fields, and data classification.

Common event types:

- `USER_PROMPT`
- `AGENT_SELECTED`
- `TOOL_CALL_REQUESTED`
- `GOVERNANCE_CHECK`
- `POLICY_DECISION`
- `TOOL_EXECUTED`
- `REVIEW_QUEUED`
- `TOOL_BLOCKED`
- `TOOL_RESULT_CHECK`
- `FINAL_RESPONSE_CHECK`
- `RESPONSE_RETURNED`
- `AUDIT_WRITTEN`
- `DELEGATION_PLAN`
- `WORKFLOW_REVIEW`
- `WORKFLOW_SUMMARY`

## Multi-Agent Workflow Schema

Workflow run fields:

- `workflow_id`
- `name`
- `user_goal`
- `lead_agent_id`
- `status`
- `decision`
- `summary`
- `metadata`

Workflow session links:

- `workflow_id`
- `session_id`
- `agent_id`
- `role`
- `parent_session_id`
- `sequence`
- `metadata`

## Agent Marketplace, Tool Marketplace, And Grants

Agents are first-class marketplace identities, not only string IDs. Each identity stores:

- display name
- agent type
- owner
- environment
- purpose
- permission grants
- identity metadata

Tools are marketplace capabilities that must be granted before execution. If an agent
requests a tool it has not been granted, the governance layer emits
`AGENT_PERMISSION_DENIED` and blocks the call.

Example permission document:

```json
{
  "tools": ["get_customer_profile", "get_customer_transactions", "search_customers"],
  "actions": ["read_customer_profile", "read_transactions", "filtered_customer_search"],
  "scopes": {
    "customer_access": "customer_id_or_filtered_search",
    "max_search_limit": 25,
    "pii_exposure": "review_required"
  }
}
```

## MVP Demo Scenarios

### Safe Request

Prompt:

```text
Show recent transactions for customer C123
```

Expected outcome:

```text
ALLOW -> tool executes -> response returned -> workflow graph is green
```

### Blocked Request

Prompt:

```text
Dump all customer data
```

Expected outcome:

```text
BLOCK -> no tool execution -> blocked response -> workflow graph has red decision node
```

### Review Request

Prompt:

```text
Find all customers in Melbourne and show their emails
```

Expected outcome:

```text
REVIEW -> review queue item created -> workflow graph has yellow review node
```
