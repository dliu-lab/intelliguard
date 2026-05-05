---
name: tests
description: "Skill for the Tests area of intelliguard. 47 symbols across 8 files."
---

# Tests

47 symbols | 8 files | Cohesion: 84%

## When to Use

- Working with code in `tests/`
- Understanding how test_create_kb_with_files_requires_at_least_one_file, test_create_kb_with_files_rejects_existing_kb_id, test_create_file_kb_with_index_after_create_does_not_invoke_ingestion work
- Modifying tests-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tests/test_knowledge_ingestion.py` | _super_admin_user, _upload_file, test_create_kb_with_files_requires_at_least_one_file, test_create_kb_with_files_rejects_existing_kb_id, test_create_file_kb_with_index_after_create_does_not_invoke_ingestion (+9) |
| `tests/test_runner_guardrails.py` | test_audit_events_include_policy_snapshot_and_stage, test_customer_id_scope_mismatch_is_blocked, test_disabled_mode_allows_everything, _make_runner, test_no_assignment_falls_back_to_yaml (+4) |
| `tests/test_evaluators.py` | _make_session, test_policy_compliance_all_allow, test_policy_compliance_with_block, test_tool_use_correctness_granted_tools, test_tool_use_correctness_ungrant_tool (+2) |
| `tests/test_store_governance.py` | test_get_sessions_for_workflow, test_evaluation_result_lifecycle, register_test_agent, test_list_review_queue_returns_all_statuses, test_audit_event_records_policy_id_and_stage |
| `tests/test_agent_attachment_domains.py` | _super_admin_user, _create_agent, test_tool_grant_endpoint_rejects_cross_domain_tool, test_kb_assignment_endpoint_rejects_cross_domain_knowledge_base, test_kb_assignment_endpoint_allows_shared_same_environment_kb |
| `agent_governance/knowledge_storage.py` | save_upload, _safe_file_name, _safe_path_segment, _content_type_for_suffix |
| `tests/conftest.py` | _ensure_database, db_url |
| `agent_governance/models.py` | new_id |

## Entry Points

Start here when exploring this area:

- **`test_create_kb_with_files_requires_at_least_one_file`** (Function) — `tests/test_knowledge_ingestion.py:546`
- **`test_create_kb_with_files_rejects_existing_kb_id`** (Function) — `tests/test_knowledge_ingestion.py:572`
- **`test_create_file_kb_with_index_after_create_does_not_invoke_ingestion`** (Function) — `tests/test_knowledge_ingestion.py:608`
- **`test_create_file_kb_accepts_image_attachment`** (Function) — `tests/test_knowledge_ingestion.py:638`
- **`test_create_vector_kb_rejects_image_attachment`** (Function) — `tests/test_knowledge_ingestion.py:670`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `test_create_kb_with_files_requires_at_least_one_file` | Function | `tests/test_knowledge_ingestion.py` | 546 |
| `test_create_kb_with_files_rejects_existing_kb_id` | Function | `tests/test_knowledge_ingestion.py` | 572 |
| `test_create_file_kb_with_index_after_create_does_not_invoke_ingestion` | Function | `tests/test_knowledge_ingestion.py` | 608 |
| `test_create_file_kb_accepts_image_attachment` | Function | `tests/test_knowledge_ingestion.py` | 638 |
| `test_create_vector_kb_rejects_image_attachment` | Function | `tests/test_knowledge_ingestion.py` | 670 |
| `test_create_vector_kb_with_index_after_create_invokes_ingestion` | Function | `tests/test_knowledge_ingestion.py` | 701 |
| `test_create_vector_kb_uses_selected_chunking_settings_for_indexer` | Function | `tests/test_knowledge_ingestion.py` | 739 |
| `test_file_storage_writes_safe_upload` | Function | `tests/test_knowledge_ingestion.py` | 57 |
| `test_file_storage_rejects_empty_files` | Function | `tests/test_knowledge_ingestion.py` | 76 |
| `test_file_storage_accepts_image_files` | Function | `tests/test_knowledge_ingestion.py` | 88 |
| `test_file_storage_accepts_parser_specific_vector_files` | Function | `tests/test_knowledge_ingestion.py` | 112 |
| `test_file_storage_rejects_unsupported_files` | Function | `tests/test_knowledge_ingestion.py` | 130 |
| `save_upload` | Function | `agent_governance/knowledge_storage.py` | 93 |
| `test_policy_compliance_all_allow` | Function | `tests/test_evaluators.py` | 12 |
| `test_policy_compliance_with_block` | Function | `tests/test_evaluators.py` | 46 |
| `test_tool_use_correctness_granted_tools` | Function | `tests/test_evaluators.py` | 80 |
| `test_tool_use_correctness_ungrant_tool` | Function | `tests/test_evaluators.py` | 111 |
| `test_pii_leakage_clean` | Function | `tests/test_evaluators.py` | 132 |
| `test_pii_leakage_detected` | Function | `tests/test_evaluators.py` | 146 |
| `test_get_sessions_for_workflow` | Function | `tests/test_store_governance.py` | 151 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Agent_governance | 7 calls |

## How to Explore

1. `gitnexus_context({name: "test_create_kb_with_files_requires_at_least_one_file"})` — see callers and callees
2. `gitnexus_query({query: "tests"})` — find related execution flows
3. Read key files listed above for implementation details
