---
name: agent-governance
description: "Skill for the Agent_governance area of intelliguard. 126 symbols across 20 files."
---

# Agent_governance

126 symbols | 20 files | Cohesion: 83%

## When to Use

- Working with code in `agent_governance/`
- Understanding how test_multi_agent_workflow_records_lead_routing_decision, test_multi_agent_workflow_requires_explicit_definition, build_customer_tool_registry work
- Modifying agent_governance-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `agent_governance/models.py` | Base, Customer, CustomerTransaction, SupportCase, User (+25) |
| `agent_governance/runner.py` | _apply_mode, evaluate_tool_call, call_tool, check_final_response, _run_post_session_evaluators (+8) |
| `agent_governance/workflow_graph.py` | normalize_agent_type, validate_agent_type, _normalize_nodes, _lead_node, _node_from_step (+7) |
| `agent_governance/multi_agent.py` | _workflow_connections, _incoming_connections, run_customer_support_workflow, _workflow_summary, _workflow_steps (+4) |
| `agent_governance/tools.py` | build_customer_tool_registry, register, register_configured_tool, get, metadata_for (+3) |
| `agent_governance/detectors.py` | redact_pii, _contains_any, assess_tool_result, assess_final_response, _customer_ids_in_query (+3) |
| `agent_governance/db.py` | seed_guardrail_defaults, seed_demo_data, seed_agent_identities, seed_workflow_definitions, build_engine (+3) |
| `agent_governance/evaluators.py` | run_for_session, run_for_workflow, _run_evaluator, _policy_compliance, _tool_use_correctness (+3) |
| `agent_governance/monitoring.py` | _record_status, _certification_summary, _decision_totals, _risk_type_distribution, _agent_leaderboard (+2) |
| `agent_governance/policy.py` | _argument_rule_from_dict, _side_effect_control_from_dict, policy_from_dict, load_policy, policy_snapshot_hash (+1) |

## Entry Points

Start here when exploring this area:

- **`test_multi_agent_workflow_records_lead_routing_decision`** (Function) — `tests/test_runner_guardrails.py:218`
- **`test_multi_agent_workflow_requires_explicit_definition`** (Function) — `tests/test_runner_guardrails.py:241`
- **`build_customer_tool_registry`** (Function) — `agent_governance/tools.py:132`
- **`run_customer_support_workflow`** (Function) — `agent_governance/multi_agent.py:98`
- **`register`** (Function) — `agent_governance/tools.py:17`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `Base` | Class | `agent_governance/models.py` | 27 |
| `Customer` | Class | `agent_governance/models.py` | 31 |
| `CustomerTransaction` | Class | `agent_governance/models.py` | 43 |
| `SupportCase` | Class | `agent_governance/models.py` | 54 |
| `User` | Class | `agent_governance/models.py` | 64 |
| `UserSession` | Class | `agent_governance/models.py` | 77 |
| `UserEnvironmentAccess` | Class | `agent_governance/models.py` | 88 |
| `AgentIdentity` | Class | `agent_governance/models.py` | 102 |
| `AgentWorkflow` | Class | `agent_governance/models.py` | 117 |
| `WorkflowDefinition` | Class | `agent_governance/models.py` | 132 |
| `WorkflowSessionLink` | Class | `agent_governance/models.py` | 154 |
| `AgentSession` | Class | `agent_governance/models.py` | 173 |
| `ToolCall` | Class | `agent_governance/models.py` | 184 |
| `PolicyDecision` | Class | `agent_governance/models.py` | 197 |
| `AuditEvent` | Class | `agent_governance/models.py` | 212 |
| `ReviewQueueItem` | Class | `agent_governance/models.py` | 229 |
| `WorkflowEvent` | Class | `agent_governance/models.py` | 247 |
| `GuardrailPolicy` | Class | `agent_governance/models.py` | 264 |
| `AgentGuardrailAssignment` | Class | `agent_governance/models.py` | 276 |
| `EvaluatorTemplate` | Class | `agent_governance/models.py` | 292 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Store → _argument_rule_from_dict` | cross_community | 6 |
| `Store → _side_effect_control_from_dict` | cross_community | 6 |
| `Main → _emit_user_and_agent_events` | cross_community | 5 |
| `Main → _action_for_tool` | cross_community | 5 |
| `Run_review_trigger_workflow → _emit_user_and_agent_events` | cross_community | 5 |
| `Run_review_trigger_workflow → _action_for_tool` | cross_community | 5 |
| `Run_review_trigger_workflow → _apply_mode` | cross_community | 5 |
| `Run_customer_support_agent → _assessment_payload` | cross_community | 5 |
| `Run_customer_support_agent → _action_for_tool` | cross_community | 5 |
| `Main → _apply_mode` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| _components | 1 calls |
| Examples | 1 calls |

## How to Explore

1. `gitnexus_context({name: "test_multi_agent_workflow_records_lead_routing_decision"})` — see callers and callees
2. `gitnexus_query({query: "agent_governance"})` — find related execution flows
3. Read key files listed above for implementation details
