from __future__ import annotations

from intelliguard.evaluation.tool_evaluators import (
    compute_config_hash,
    run_tool_evaluators,
)


def _base_tool() -> dict:
    return {
        "tool_name": "lookup_account",
        "side_effect_level": "read_only",
        "input_schema": {
            "type": "object",
            "properties": {"account_id": {"type": "string"}},
            "required": ["account_id"],
        },
        "output_schema": {
            "type": "object",
            "properties": {"balance": {"type": "number"}},
        },
        "permissions": {"requires_grant": True, "data_scope": "account_id"},
        "allowed_actions": ["read_account"],
    }


def test_all_pass_for_well_formed_tool() -> None:
    results = run_tool_evaluators(_base_tool())
    assert [result.status for result in results].count("FAIL") == 0


def test_missing_input_schema_fails() -> None:
    tool = _base_tool()
    del tool["input_schema"]
    results = {result.criterion_name: result for result in run_tool_evaluators(tool)}
    assert results["input_schema_validation"].status == "FAIL"


def test_pii_field_in_output_schema_triggers_review() -> None:
    tool = _base_tool()
    tool["output_schema"]["properties"]["email"] = {"type": "string"}
    results = {result.criterion_name: result for result in run_tool_evaluators(tool)}
    assert results["pii_field_leakage"].status == "REVIEW"


def test_compute_config_hash_is_stable_and_changes_on_contract_change() -> None:
    tool = _base_tool()
    first = compute_config_hash(tool)
    assert first == compute_config_hash(tool)
    assert len(first) == 64

    tool["input_schema"]["properties"]["extra_field"] = {"type": "string"}
    assert compute_config_hash(tool) != first

