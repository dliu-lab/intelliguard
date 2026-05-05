---
name: agent-governance
description: "Skill for the Agent_governance area of intelliguard. 131 symbols across 17 files."
---

# Agent_governance

131 symbols | 17 files | Cohesion: 89%

## When to Use

- Working with code in `agent_governance/`
- Understanding how test_multi_agent_workflow_records_lead_routing_decision, test_multi_agent_workflow_requires_explicit_definition, build_customer_tool_registry work
- Modifying agent_governance-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `agent_governance/models.py` | Base, Customer, CustomerTransaction, SupportCase, User (+30) |
| `agent_governance/runner.py` | _apply_mode, evaluate_tool_call, call_tool, check_final_response, _run_post_session_evaluators (+8) |
| `agent_governance/workflow_graph.py` | normalize_agent_type, validate_agent_type, workflow_graph_hash, normalize_workflow_graph, _normalize_nodes (+7) |
| `agent_governance/multi_agent.py` | _workflow_connections, _incoming_connections, run_customer_support_workflow, _workflow_summary, _workflow_steps (+4) |
| `agent_governance/knowledge_indexing.py` | process_pending_documents, embed_texts, embed_query, _embed, normalize_chunking_strategy (+4) |
| `agent_governance/detectors.py` | redact_pii, _contains_any, assess_tool_result, assess_final_response, _customer_ids_in_query (+3) |
| `agent_governance/evaluators.py` | run_for_session, run_for_workflow, _run_evaluator, _policy_compliance, _tool_use_correctness (+3) |
| `agent_governance/monitoring.py` | _record_status, _certification_summary, _decision_totals, _risk_type_distribution, _agent_leaderboard (+2) |
| `agent_governance/policy.py` | _argument_rule_from_dict, _side_effect_control_from_dict, policy_from_dict, load_policy, policy_snapshot_hash (+1) |
| `agent_governance/tools.py` | build_customer_tool_registry, _customer_to_dict, get_customer_profile, search_customers |

## Entry Points

Start here when exploring this area:

- **`test_multi_agent_workflow_records_lead_routing_decision`** (Function) — `tests/test_runner_guardrails.py:218`
- **`test_multi_agent_workflow_requires_explicit_definition`** (Function) — `tests/test_runner_guardrails.py:241`
- **`build_customer_tool_registry`** (Function) — `agent_governance/tools.py:132`
- **`run_customer_support_workflow`** (Function) — `agent_governance/multi_agent.py:98`
- **`normalize_agent_type`** (Function) — `agent_governance/workflow_graph.py:35`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `Base` | Class | `agent_governance/models.py` | 33 |
| `Customer` | Class | `agent_governance/models.py` | 37 |
| `CustomerTransaction` | Class | `agent_governance/models.py` | 49 |
| `SupportCase` | Class | `agent_governance/models.py` | 60 |
| `User` | Class | `agent_governance/models.py` | 70 |
| `UserSession` | Class | `agent_governance/models.py` | 83 |
| `UserEnvironmentAccess` | Class | `agent_governance/models.py` | 94 |
| `AgentIdentity` | Class | `agent_governance/models.py` | 108 |
| `AgentWorkflow` | Class | `agent_governance/models.py` | 123 |
| `WorkflowDefinition` | Class | `agent_governance/models.py` | 138 |
| `WorkflowSessionLink` | Class | `agent_governance/models.py` | 160 |
| `AgentSession` | Class | `agent_governance/models.py` | 179 |
| `ToolCall` | Class | `agent_governance/models.py` | 190 |
| `PolicyDecision` | Class | `agent_governance/models.py` | 203 |
| `AuditEvent` | Class | `agent_governance/models.py` | 218 |
| `ReviewQueueItem` | Class | `agent_governance/models.py` | 235 |
| `WorkflowEvent` | Class | `agent_governance/models.py` | 253 |
| `GuardrailPolicy` | Class | `agent_governance/models.py` | 270 |
| `AgentGuardrailAssignment` | Class | `agent_governance/models.py` | 282 |
| `EvaluatorTemplate` | Class | `agent_governance/models.py` | 298 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Main → _emit_user_and_agent_events` | cross_community | 5 |
| `Main → _action_for_tool` | cross_community | 5 |
| `Run_review_trigger_workflow → _emit_user_and_agent_events` | cross_community | 5 |
| `Run_review_trigger_workflow → _action_for_tool` | cross_community | 5 |
| `Run_review_trigger_workflow → _apply_mode` | cross_community | 5 |
| `Run_customer_support_agent → _assessment_payload` | cross_community | 5 |
| `Run_customer_support_agent → _action_for_tool` | cross_community | 5 |
| `Main → _apply_mode` | cross_community | 4 |
| `Main → _summarize_result` | cross_community | 4 |
| `Main → _assessment_payload` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| _components | 4 calls |
| Examples | 1 calls |

## How to Explore

1. `gitnexus_context({name: "test_multi_agent_workflow_records_lead_routing_decision"})` — see callers and callees
2. `gitnexus_query({query: "agent_governance"})` — find related execution flows
3. Read key files listed above for implementation details
