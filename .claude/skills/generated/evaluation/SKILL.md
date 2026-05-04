---
name: evaluation
description: "Skill for the Evaluation area of intelliguard. 76 symbols across 12 files."
---

# Evaluation

76 symbols | 12 files | Cohesion: 94%

## When to Use

- Working with code in `tests/`
- Understanding how test_all_pass_for_well_formed_agent, test_missing_domain_fails_identity_check, test_missing_model_fails work
- Modifying evaluation-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tests/evaluation/test_enforcement.py` | _store_with_cert, test_certified_tool_passes_in_production, test_draft_tool_blocked_in_production, test_draft_tool_allowed_in_lower_environment, test_failed_tool_blocked_in_lower_environment (+9) |
| `agent_governance/evaluation/agent_evaluators.py` | run_agent_evaluators, _check_agent_type_valid, _check_tool_scope_defined, _check_attached_tools_certified, _check_guardrail_assigned (+7) |
| `tests/evaluation/test_agent_evaluators.py` | _base_agent, _base_assignments, test_all_pass_for_well_formed_agent, test_missing_domain_fails_identity_check, test_missing_model_fails (+5) |
| `agent_governance/evaluation/workflow_evaluators.py` | run_workflow_evaluators, _nodes, _edges, _check_graph_defined, _check_node_types_match_agents (+4) |
| `agent_governance/evaluation/tool_evaluators.py` | run_tool_evaluators, compute_config_hash, _check_input_schema, _check_required_arguments, _check_output_schema (+3) |
| `tests/evaluation/test_workflow_evaluators.py` | _workflow, _assignments, test_workflow_evaluators_pass_for_valid_certified_graph, test_uncertified_node_agent_fails, test_node_type_mismatch_fails (+1) |
| `tests/evaluation/test_tool_evaluators.py` | _base_tool, test_all_pass_for_well_formed_tool, test_missing_input_schema_fails, test_pii_field_in_output_schema_triggers_review, test_compute_config_hash_is_stable_and_changes_on_contract_change |
| `tests/evaluation/test_certification.py` | test_review_without_fail_certifies, test_fail_blocks_certification, test_valid_transitions, test_invalid_transition_raises |
| `agent_governance/evaluation/enforcement.py` | check_tool_certification, check_agent_certification, check_workflow_certification |
| `agent_governance/evaluation/certification.py` | decide_certification, _evidence, validate_transition |

## Entry Points

Start here when exploring this area:

- **`test_all_pass_for_well_formed_agent`** (Function) — `tests/evaluation/test_agent_evaluators.py:32`
- **`test_missing_domain_fails_identity_check`** (Function) — `tests/evaluation/test_agent_evaluators.py:37`
- **`test_missing_model_fails`** (Function) — `tests/evaluation/test_agent_evaluators.py:44`
- **`test_invalid_agent_type_fails`** (Function) — `tests/evaluation/test_agent_evaluators.py:51`
- **`test_task_agent_empty_tools_triggers_review`** (Function) — `tests/evaluation/test_agent_evaluators.py:58`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `test_all_pass_for_well_formed_agent` | Function | `tests/evaluation/test_agent_evaluators.py` | 32 |
| `test_missing_domain_fails_identity_check` | Function | `tests/evaluation/test_agent_evaluators.py` | 37 |
| `test_missing_model_fails` | Function | `tests/evaluation/test_agent_evaluators.py` | 44 |
| `test_invalid_agent_type_fails` | Function | `tests/evaluation/test_agent_evaluators.py` | 51 |
| `test_task_agent_empty_tools_triggers_review` | Function | `tests/evaluation/test_agent_evaluators.py` | 58 |
| `test_uncertified_attached_tool_fails` | Function | `tests/evaluation/test_agent_evaluators.py` | 65 |
| `test_no_guardrail_fails` | Function | `tests/evaluation/test_agent_evaluators.py` | 72 |
| `test_compute_config_hash_stable_and_changes_on_guardrail` | Function | `tests/evaluation/test_agent_evaluators.py` | 79 |
| `run_agent_evaluators` | Function | `agent_governance/evaluation/agent_evaluators.py` | 13 |
| `test_all_pass_for_well_formed_tool` | Function | `tests/evaluation/test_tool_evaluators.py` | 26 |
| `test_missing_input_schema_fails` | Function | `tests/evaluation/test_tool_evaluators.py` | 31 |
| `test_pii_field_in_output_schema_triggers_review` | Function | `tests/evaluation/test_tool_evaluators.py` | 38 |
| `test_compute_config_hash_is_stable_and_changes_on_contract_change` | Function | `tests/evaluation/test_tool_evaluators.py` | 45 |
| `run_tool_evaluators` | Function | `agent_governance/evaluation/tool_evaluators.py` | 60 |
| `compute_config_hash` | Function | `agent_governance/evaluation/tool_evaluators.py` | 71 |
| `run_workflow_evaluators` | Function | `agent_governance/evaluation/workflow_evaluators.py` | 10 |
| `test_workflow_evaluators_pass_for_valid_certified_graph` | Function | `tests/evaluation/test_workflow_evaluators.py` | 66 |
| `test_uncertified_node_agent_fails` | Function | `tests/evaluation/test_workflow_evaluators.py` | 72 |
| `test_node_type_mismatch_fails` | Function | `tests/evaluation/test_workflow_evaluators.py` | 82 |
| `test_workflow_config_hash_changes_when_edges_change` | Function | `tests/evaluation/test_workflow_evaluators.py` | 92 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Run_agent_evaluators → _metadata` | cross_community | 4 |
| `Compute_agent_config_hash → _metadata` | intra_community | 3 |
| `Run_workflow_evaluators → _nodes` | intra_community | 3 |
| `Run_workflow_evaluators → _edges` | intra_community | 3 |
| `Run_agent_evaluators → _agent_tools` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "test_all_pass_for_well_formed_agent"})` — see callers and callees
2. `gitnexus_query({query: "evaluation"})` — find related execution flows
3. Read key files listed above for implementation details
