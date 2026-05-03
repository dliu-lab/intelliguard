# IntelliGuard Runtime Evaluators

Runtime evaluators are the production-time subset of the evaluator system.
They do not rerun every build-time certification check. Their job is to detect
trace quality issues, safety drift, policy violations, and operational risk in
real executions.

Runtime evaluation should be mostly deterministic and asynchronous where
possible. LLM-as-judge is used only for sampled subjective quality checks and
must not block a user-facing response.

## Runtime Evaluator Set

```text
1. Policy Compliance Evaluator
2. Tool Use / Scope Evaluator
3. Response Safety Evaluator
4. Workflow Trajectory Evaluator
5. Judge Drift / Quality Evaluator
6. Runtime Health Evaluator
```

## 1. Policy Compliance Evaluator

Purpose: verify that runtime decisions followed the active policy.

Method: deterministic.

Checks:

```text
risk score vs active threshold
ALLOW / REVIEW / BLOCK decision correctness
review-required actions routed to Review Queue
blocked tools were not executed
policy_id captured
policy_snapshot_hash captured
event evaluated under current vs stale policy
```

Inputs:

```text
audit_events
policy_decisions
review_queue
active policy metadata
```

Output:

```text
PASS / FAIL / REVIEW
evidence sentence
linked audit_event_ids
```

## 2. Tool Use / Scope Evaluator

Purpose: verify that tools were used safely in the actual runtime session.

Method: deterministic.

Checks:

```text
agent used only attached tools
agent used only certified tools in production
tool args matched registered schema
customer_id / account_id matched authenticated session scope
limit / date range / entity arguments stayed within policy
side-effect tools required approval before execution
tool output respected redaction policy
tool emitted required audit evidence
```

Inputs:

```text
tool_calls
agent tool grants
tool_certifications
session context
audit_events
guardrail policy
```

Output:

```text
PASS / FAIL / REVIEW
invalid tool calls
invalid arguments
scope violations
linked tool_call_ids
```

## 3. Response Safety Evaluator

Purpose: verify that the final response is safe to release or was safely routed.

Method: hybrid.

Use deterministic checks for:

```text
PII leakage
forbidden sensitive fields
policy-blocked phrases
unredacted tool output
missing review for sensitive response
```

Use LLM-as-judge for sampled semantic checks:

```text
groundedness against trace/tool outputs
unsafe financial, legal, medical, or compliance claims
instruction-following safety
response completeness where a reference answer exists
```

Inputs:

```text
final response
tool outputs
audit_events
policy decisions
KB snippets or reference records
```

Output:

```text
SAFE / REVIEW / BLOCK
criterion-level evidence
judge version when LLM-as-judge is used
```

## 4. Workflow Trajectory Evaluator

Purpose: verify that multi-agent workflows followed the registered workflow
graph and did not produce a good-looking answer through an invalid path.

Method: deterministic.

Checks:

```text
lead routing decision recorded
activated nodes exist in registered graph
handoffs followed registered edges
required gate nodes ran
review / approval nodes ran when required
skipped nodes were allowed to be skipped
no repeated failure loop
final response maps to completed workflow state
```

Inputs:

```text
workflow_events
workflow_definitions
workflow_session_links
agent_sessions
review_queue
audit_events
```

Output:

```text
PASS / FAIL / REVIEW
selected nodes
skipped nodes
handoff edges used
invalid handoffs
linked workflow_id and session_ids
```

## 5. Judge Drift / Quality Evaluator

Purpose: detect quality drift in production and monitor LLM judge reliability.

Method: LLM-as-judge plus human calibration.

This evaluator is sampled only. It should never run on every request and should
never block the response path.

Checks:

```text
task completion
helpfulness
clarity
groundedness
tone
judge-human disagreement rate
```

Inputs:

```text
full trace
final response
tool outputs
policy context
human corrections
judge version
few-shot calibration examples
```

Output:

```text
PASS / FAIL / REVIEW
low-precision score: 1 / 2 / 3
judge reasoning
judge-human agreement metadata
```

## 6. Runtime Health Evaluator

Purpose: detect operational degradation that creates governance or reliability
risk.

Method: deterministic.

Checks:

```text
tool latency
tool error rate
model latency
retry count
timeout rate
rate-limit hits
token budget
cost budget
repeated failures by agent / tool / session
unusual agent-tool combinations
high-volume entity access
```

Inputs:

```text
tool_calls
agent_sessions
audit_events
evaluation_results
runtime metrics
```

Output:

```text
PASS / FAIL / REVIEW
metric values
threshold crossed
linked agent_id / tool_id / session_id
```

## Sampling Policy

Runtime evaluators should be sampled by risk and version freshness.

```text
high_risk: 100%
review_queue_items: 100%
blocked_events: 100%
new_agent_version: 50%
new_tool_version: 50%
normal_low_risk: 5%
internal_test: 1%
```

The sampling policy should be configurable by environment.

```text
local / sandbox:
  low sampling by default
  manual run allowed

demo / staging:
  higher sampling for new versions and test traces

production:
  mandatory sampling for high-risk, blocked, and review-routed traces
```

## Runtime Execution Model

Runtime evaluation has two paths.

Synchronous path:

```text
policy compliance checks needed for immediate enforcement
tool scope checks before side-effect execution
response safety checks required before release in high-risk flows
```

Asynchronous path:

```text
workflow trajectory evaluation
judge drift / quality evaluation
runtime health aggregation
sampled post-run response safety evaluation
```

LLM-as-judge work must run through a durable worker/queue in production. FastAPI
BackgroundTasks are acceptable only for MVP.

## Review Queue Routing

Failed runtime evaluations may create Review Queue items. They must use a
specific review_type so evaluation failures do not get confused with human
approval gates.

```text
review_type:
  evaluation_failure
  judge_disagreement
```

Evaluation-triggered review items should include:

```text
evaluation_run_id
evaluation_result_id
failed_criterion_ids
target_type
target_id
trace_id
audit_event_ids
evidence_summary
recommended_action
```

## Storage Requirements

Runtime evaluator output should use the shared evaluation tables:

```text
evaluation_runs
evaluation_results
evaluation_criterion_results
human_corrections
judge_alignment_metrics
```

Each runtime result should link back to the production trace:

```text
trace_id
workflow_id
session_id
agent_id
tool_id
audit_event_ids
review_id, if routed to review
```

## Product Principle

Build-time certification decides whether a tool, agent, or workflow is allowed
to run.

Runtime evaluation verifies that certified systems continue behaving safely in
real traces.
