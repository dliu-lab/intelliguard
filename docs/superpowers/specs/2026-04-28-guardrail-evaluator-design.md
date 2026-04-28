# Guardrail & Evaluator Governance System

**Date:** 2026-04-28  
**Status:** Approved  
**Scope:** Per-agent guardrail policy assignments and rule-based agent evaluators with UI, API, and runtime integration.

---

## Overview

IntelliGuard currently enforces a single global policy (YAML file) across all agents. This spec adds two separate governance layers per agent:

- **Guardrails** — runtime enforcement before/during/after tool use. Block, allow, or route to review based on a named policy assigned to the agent per environment.
- **Evaluators** — quality/risk assessment after a run. Produce scores, findings, and audit records. Do not block in real time.

Both are scoped by environment. A staging agent may run experimental evaluators in `review_only` mode while production uses strict enforced guardrails.

---

## Data Model

### `guardrail_policies`
Named, reusable policy definitions stored in the database. The existing YAML policy seeds the first row on startup as "Default Policy."

| Column | Type | Notes |
|---|---|---|
| `policy_id` | String PK | e.g. `pol_abc123` |
| `display_name` | String | Human-readable name |
| `description` | Text | |
| `environment` | String | e.g. `demo`, `staging`, `production` |
| `config` | JSONB | Mirrors `PolicyConfig`: `allowed_tools`, `blocked_tools`, `decision_thresholds`, `block_pii_in_response`, `redact_pii_in_response`, `max_records_returned`, `blocked_patterns`, `review_required_for` |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

### `agent_guardrail_assignments`
Links an agent to a guardrail policy per environment, with optional threshold overrides.

| Column | Type | Notes |
|---|---|---|
| `assignment_id` | String PK | |
| `agent_id` | String FK → `agent_identities` | |
| `environment` | String | |
| `policy_id` | String FK → `guardrail_policies` | |
| `mode` | String | `enforce` \| `review_only` \| `disabled` |
| `threshold_overrides` | JSONB | e.g. `{"block": 70, "review": 40}` — overrides policy defaults per agent |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

**Unique constraint:** `(agent_id, environment)` — one active guardrail policy per agent per environment

**Mode semantics:**
- `enforce` — policy decisions are applied as-is (BLOCK/REVIEW/ALLOW)
- `review_only` — all BLOCK decisions are downgraded to REVIEW (safe experimentation)
- `disabled` — guardrails are skipped entirely for this agent/environment

### `evaluator_templates`
Named evaluator types with default configuration. Seeded at startup with the five built-in rule-based evaluators.

| Column | Type | Notes |
|---|---|---|
| `evaluator_id` | String PK | e.g. `eval_policy_compliance` |
| `display_name` | String | |
| `evaluator_type` | String | `policy_compliance` \| `tool_use_correctness` \| `pii_leakage` \| `workflow_completion` \| `response_quality` |
| `scope` | String | `agent` \| `workflow` — determines whether this evaluator runs per session or once per workflow |
| `description` | Text | |
| `default_config` | JSONB | Type-specific defaults (e.g. `{"pass_threshold": 80}`) |
| `llm_enabled` | Boolean | `false` for all rule-based evaluators; hook for future LLM evaluators |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

### `agent_evaluator_assignments`
Links an agent to evaluator templates per environment.

| Column | Type | Notes |
|---|---|---|
| `assignment_id` | String PK | |
| `agent_id` | String FK → `agent_identities` | |
| `environment` | String | |
| `evaluator_id` | String FK → `evaluator_templates` | |
| `trigger` | String | `after_run` \| `after_workflow` \| `manual` |
| `config` | JSONB | Per-assignment config overrides |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

**Unique constraint:** `(agent_id, environment, evaluator_id)`

### `evaluation_results`
Stores the output of each evaluator run, linked to a session (and optionally a workflow).

| Column | Type | Notes |
|---|---|---|
| `result_id` | String PK | |
| `session_id` | String FK → `agent_sessions` | |
| `workflow_id` | String nullable | Denormalized for fast lookup |
| `agent_id` | String | |
| `evaluator_id` | String FK → `evaluator_templates` | |
| `score` | Integer (0–100) | |
| `passed` | Boolean | `score >= pass_threshold` from config |
| `findings` | JSONB | `[{check, result, detail}]` |
| `trigger` | String | What triggered this evaluation |
| `created_at` | DateTime | |

---

## API Endpoints

All endpoints require bearer auth. Environment-scoping follows existing `visible_environment` / `require_environment_access` patterns.

### Guardrail Policies
```
GET    /v1/guardrail-policies                        list (env-scoped)
POST   /v1/guardrail-policies                        create
GET    /v1/guardrail-policies/{policy_id}            detail
PUT    /v1/guardrail-policies/{policy_id}            update
```

### Agent Guardrail Assignments
```
GET    /v1/agents/{agent_id}/guardrails              list assignments
POST   /v1/agents/{agent_id}/guardrails              assign policy
PUT    /v1/agents/{agent_id}/guardrails/{id}         update mode/thresholds
DELETE /v1/agents/{agent_id}/guardrails/{id}         remove
```

### Evaluator Templates
```
GET    /v1/evaluator-templates                       list all
POST   /v1/evaluator-templates                       create custom template
```

### Agent Evaluator Assignments
```
GET    /v1/agents/{agent_id}/evaluators              list assignments
POST   /v1/agents/{agent_id}/evaluators              assign evaluator
DELETE /v1/agents/{agent_id}/evaluators/{id}         remove
```

### Evaluation Results
```
GET    /v1/evaluation-results                        list (env-scoped, ?agent_id, ?session_id)
GET    /v1/sessions/{session_id}/evaluation-results  results for a session
POST   /v1/sessions/{session_id}/evaluate            trigger manual evaluation
```

---

## Runtime Integration

### Resolved policy construction
`GovernedToolRunner.__init__` currently loads the global YAML policy. It gains a new step:

1. Query `agent_guardrail_assignments` for `(agent_id, environment)` — pick the active assignment
2. If no assignment exists, fall back to global YAML policy (backwards compatible)
3. Merge `guardrail_policy.config` + `assignment.threshold_overrides` → `resolved PolicyConfig`
4. Store `assignment.mode` on the runner instance

### Mode enforcement
- `disabled` — skip all `assess_tool_call`, `assess_tool_result`, `assess_final_response` calls; pass through with ALLOW
- `review_only` — run assessments normally, then downgrade any BLOCK → REVIEW before recording
- `enforce` — existing behaviour, no change

### Evaluator execution

**Agent-level** (`scope=agent`): After `check_final_response` completes, `EvaluatorEngine.run_for_session()` is called:

1. Load `agent_evaluator_assignments` for `(agent_id, environment, trigger="after_run")`
2. Skip any assignment whose `evaluator_template.scope == "workflow"` — wrong level
3. For each matching assignment, run the evaluator against the session's DB records
4. Persist `EvaluationResult` rows (with `workflow_id=None`)
5. Emit `EVALUATION_COMPLETE` workflow event with scores as payload

**Workflow-level** (`scope=workflow`): Triggered at the end of `run_customer_support_workflow` in `multi_agent.py`, once all agent sessions are complete:

1. Load `agent_evaluator_assignments` for the lead agent `(lead_agent_id, environment, trigger="after_workflow")`
2. Skip any assignment whose `evaluator_template.scope == "agent"`
3. For each matching assignment, run the evaluator across all sessions in the workflow
4. Persist `EvaluationResult` rows linked to both `session_id` (lead) and `workflow_id`
5. Emit `WORKFLOW_EVALUATION_COMPLETE` event on the lead agent's session

### Full runtime flow
```
User runs workflow
  → GovernedToolRunner.__init__
      → load agent guardrail assignment (env-scoped)
      → resolve PolicyConfig (base + overrides)

  → guardrail pre-check        (assess_tool_call, resolved policy)
  → tool access check          (existing, unchanged)
  → tool result guardrail check (assess_tool_result, resolved policy)
  → final response guardrail check (check_final_response)

  → EvaluatorEngine.run_for_session(trigger="after_run")
      → policy_compliance evaluator
      → pii_leakage evaluator
      → tool_use_correctness evaluator
      → workflow_completion evaluator
      → response_quality evaluator
      → emit EVALUATION_COMPLETE workflow event

  → evaluation results stored → workflow trace updated
```

---

## Evaluator Engine — `agent_governance/evaluators.py`

Five rule-based evaluators. All read from existing DB tables. LLM mode is a no-op stub (`llm_enabled=False`).

**Agent-scoped** (`scope=agent`, trigger `after_run`) — run per agent session, measure individual agent behaviour:

| Evaluator | Data source | Score logic |
|---|---|---|
| `policy_compliance` | `policy_decisions` for session | `(ALLOW count / total decisions) * 100` |
| `tool_use_correctness` | `tool_calls` + agent `permissions.tools` | `(calls using granted tools / total calls) * 100` |
| `pii_leakage` | `audit_events` where `risk_type` contains PII | Any PII audit event = 0; none = 100 |

**Workflow-scoped** (`scope=workflow`, trigger `after_workflow`) — run once per workflow, measure overall outcome:

| Evaluator | Data source | Score logic |
|---|---|---|
| `workflow_completion` | all `agent_sessions.status` in workflow | all COMPLETED = 100; any BLOCK = 0; any REVIEW = 50 |
| `response_quality` | lead agent's `workflow_events` of type `FINAL_RESPONSE_CHECK` | `ALLOW` status = 100; `BLOCK` = 0 |

Each evaluator returns:
```python
@dataclass
class EvaluatorResult:
    score: int          # 0-100
    passed: bool        # score >= pass_threshold
    findings: list[dict]  # [{check, result, detail}]
```

---

## UI Changes

### Agent card — tabbed governance panel
Each agent card in the Agent Marketplace gains a 3-tab panel replacing the current flat tools list:

- **Tools tab** — existing grant/revoke tool UI, unchanged
- **Guardrails tab** — select policy + mode + threshold overrides, attach/remove assignments
- **Evaluators tab** — select evaluator template + trigger, attach/remove assignments

### Marketplaces — Governance tab
A third tab alongside Agent and Tool in the Marketplaces view:

- **Guardrail Policies section** — list of named policies; JSON editor form to create new ones (same pattern as agent/tool creation)
- **Evaluator Templates section** — list of built-in and custom evaluators; `llm_enabled` toggle (grayed out, labeled "Coming soon")

### Workflow Trace — evaluation nodes
Sessions with evaluation results show an `EVALUATION_COMPLETE` node at the end of the trace, expanding to show per-evaluator scores and pass/fail badges.

Workflow cards in the Workflows list show an evaluation summary badge:
- Green — all evaluators passed
- Amber — any evaluator scored below threshold
- Red — any evaluator failed (score = 0)

---

## Backwards Compatibility

- Agents with no guardrail assignment continue using the global YAML policy — no behaviour change
- The YAML policy is seeded as "Default Policy" in `guardrail_policies` on first startup
- Five built-in evaluator templates are seeded in `evaluator_templates` on first startup
- All new DB tables are additive; no existing tables are modified

---

## Out of Scope (deferred to Advisor spec)

- LLM-powered evaluators
- Natural language policy editing
- RAG over audit/policy data
- Evaluation result trending / analytics dashboard
