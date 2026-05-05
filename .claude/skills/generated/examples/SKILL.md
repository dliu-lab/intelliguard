---
name: examples
description: "Skill for the Examples area of intelliguard. 9 symbols across 3 files."
---

# Examples

9 symbols | 3 files | Cohesion: 67%

## When to Use

- Working with code in `examples/`
- Understanding how test_review_trigger_workflow_script_creates_review_item, review_trigger_workflow_definition, install_review_trigger_workflow work
- Modifying examples-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `examples/review_trigger_workflow.py` | review_trigger_workflow_definition, install_review_trigger_workflow, _store_database_url, run_review_trigger_workflow, build_database_url (+1) |
| `tests/test_runner_guardrails.py` | test_review_trigger_workflow_script_creates_review_item, test_review_trigger_workflow_cli_database_url_helpers |
| `agent_governance/settings.py` | load_settings |

## Entry Points

Start here when exploring this area:

- **`test_review_trigger_workflow_script_creates_review_item`** (Function) — `tests/test_runner_guardrails.py:200`
- **`review_trigger_workflow_definition`** (Function) — `examples/review_trigger_workflow.py:20`
- **`install_review_trigger_workflow`** (Function) — `examples/review_trigger_workflow.py:67`
- **`run_review_trigger_workflow`** (Function) — `examples/review_trigger_workflow.py:104`
- **`test_review_trigger_workflow_cli_database_url_helpers`** (Function) — `tests/test_runner_guardrails.py:254`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `test_review_trigger_workflow_script_creates_review_item` | Function | `tests/test_runner_guardrails.py` | 200 |
| `review_trigger_workflow_definition` | Function | `examples/review_trigger_workflow.py` | 20 |
| `install_review_trigger_workflow` | Function | `examples/review_trigger_workflow.py` | 67 |
| `run_review_trigger_workflow` | Function | `examples/review_trigger_workflow.py` | 104 |
| `test_review_trigger_workflow_cli_database_url_helpers` | Function | `tests/test_runner_guardrails.py` | 254 |
| `build_database_url` | Function | `examples/review_trigger_workflow.py` | 75 |
| `main` | Function | `examples/review_trigger_workflow.py` | 118 |
| `load_settings` | Function | `agent_governance/settings.py` | 25 |
| `_store_database_url` | Function | `examples/review_trigger_workflow.py` | 71 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Main → _emit_user_and_agent_events` | cross_community | 5 |
| `Main → _action_for_tool` | cross_community | 5 |
| `Run_review_trigger_workflow → _emit_user_and_agent_events` | cross_community | 5 |
| `Run_review_trigger_workflow → _action_for_tool` | cross_community | 5 |
| `Run_review_trigger_workflow → _apply_mode` | cross_community | 5 |
| `Main → _apply_mode` | cross_community | 4 |
| `Main → _summarize_result` | cross_community | 4 |
| `Main → _assessment_payload` | cross_community | 4 |
| `Main → _run_post_session_evaluators` | cross_community | 4 |
| `Main → _audit` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Agent_governance | 4 calls |

## How to Explore

1. `gitnexus_context({name: "test_review_trigger_workflow_script_creates_review_item"})` — see callers and callees
2. `gitnexus_query({query: "examples"})` — find related execution flows
3. Read key files listed above for implementation details
