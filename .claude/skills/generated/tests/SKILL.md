---
name: tests
description: "Skill for the Tests area of intelliguard. 24 symbols across 5 files."
---

# Tests

24 symbols | 5 files | Cohesion: 69%

## When to Use

- Working with code in `tests/`
- Understanding how test_policy_compliance_all_allow, test_policy_compliance_with_block, test_tool_use_correctness_granted_tools work
- Modifying tests-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tests/test_runner_guardrails.py` | test_review_only_mode_downgrades_block, test_missing_required_tool_argument_is_blocked, test_side_effect_tool_requires_review_before_execution, _make_runner, test_no_assignment_falls_back_to_yaml (+4) |
| `tests/test_evaluators.py` | _make_session, test_policy_compliance_all_allow, test_policy_compliance_with_block, test_tool_use_correctness_granted_tools, test_tool_use_correctness_ungrant_tool (+2) |
| `tests/test_store_governance.py` | test_get_sessions_for_workflow, test_evaluation_result_lifecycle, register_test_agent, test_list_review_queue_returns_all_statuses, test_audit_event_records_policy_id_and_stage |
| `tests/conftest.py` | _ensure_database, db_url |
| `agent_governance/models.py` | new_id |

## Entry Points

Start here when exploring this area:

- **`test_policy_compliance_all_allow`** (Function) — `tests/test_evaluators.py:12`
- **`test_policy_compliance_with_block`** (Function) — `tests/test_evaluators.py:46`
- **`test_tool_use_correctness_granted_tools`** (Function) — `tests/test_evaluators.py:80`
- **`test_tool_use_correctness_ungrant_tool`** (Function) — `tests/test_evaluators.py:111`
- **`test_pii_leakage_clean`** (Function) — `tests/test_evaluators.py:132`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `test_policy_compliance_all_allow` | Function | `tests/test_evaluators.py` | 12 |
| `test_policy_compliance_with_block` | Function | `tests/test_evaluators.py` | 46 |
| `test_tool_use_correctness_granted_tools` | Function | `tests/test_evaluators.py` | 80 |
| `test_tool_use_correctness_ungrant_tool` | Function | `tests/test_evaluators.py` | 111 |
| `test_pii_leakage_clean` | Function | `tests/test_evaluators.py` | 132 |
| `test_pii_leakage_detected` | Function | `tests/test_evaluators.py` | 146 |
| `test_get_sessions_for_workflow` | Function | `tests/test_store_governance.py` | 151 |
| `test_evaluation_result_lifecycle` | Function | `tests/test_store_governance.py` | 194 |
| `test_review_only_mode_downgrades_block` | Function | `tests/test_runner_guardrails.py` | 67 |
| `test_missing_required_tool_argument_is_blocked` | Function | `tests/test_runner_guardrails.py` | 156 |
| `test_side_effect_tool_requires_review_before_execution` | Function | `tests/test_runner_guardrails.py` | 185 |
| `new_id` | Function | `agent_governance/models.py` | 23 |
| `test_no_assignment_falls_back_to_yaml` | Function | `tests/test_runner_guardrails.py` | 26 |
| `test_assignment_enforce_mode_uses_db_policy` | Function | `tests/test_runner_guardrails.py` | 32 |
| `test_audit_events_include_policy_snapshot_and_stage` | Function | `tests/test_runner_guardrails.py` | 108 |
| `test_customer_id_scope_mismatch_is_blocked` | Function | `tests/test_runner_guardrails.py` | 171 |
| `test_disabled_mode_allows_everything` | Function | `tests/test_runner_guardrails.py` | 281 |
| `register_test_agent` | Function | `tests/test_store_governance.py` | 13 |
| `test_list_review_queue_returns_all_statuses` | Function | `tests/test_store_governance.py` | 244 |
| `test_audit_event_records_policy_id_and_stage` | Function | `tests/test_store_governance.py` | 271 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Agent_governance | 7 calls |

## How to Explore

1. `gitnexus_context({name: "test_policy_compliance_all_allow"})` — see callers and callees
2. `gitnexus_query({query: "tests"})` — find related execution flows
3. Read key files listed above for implementation details
