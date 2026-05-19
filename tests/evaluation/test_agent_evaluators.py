from __future__ import annotations

from intelliguard.evaluation.agent_evaluators import (
    compute_agent_config_hash,
    run_agent_evaluators,
)


def _base_agent() -> dict:
    return {
        "agent_id": "test-agent",
        "agent_type": "task_agent",
        "purpose": "Reviews account cases using governed tools.",
        "permissions": {"tools": ["lookup_account"]},
        "metadata": {"domain": "banking", "llm": {"model": "ollama/qwen3.5:9b"}},
    }


def _base_assignments() -> dict:
    return {
        "guardrails": [{"policy_id": "pol_001", "environment": "demo"}],
        "evaluators": [{"evaluator_id": "agent_baseline"}],
        "knowledge": [],
        "tools": [
            {
                "tool_name": "lookup_account",
                "certification": {"status": "CERTIFIED"},
            }
        ],
    }


def test_all_pass_for_well_formed_agent() -> None:
    results = run_agent_evaluators(_base_agent(), _base_assignments())
    assert [result.status for result in results].count("FAIL") == 0


def test_missing_domain_fails_identity_check() -> None:
    agent = _base_agent()
    agent["metadata"] = {"llm": {"model": "ollama/qwen3.5:9b"}}
    results = {result.criterion_name: result for result in run_agent_evaluators(agent, _base_assignments())}
    assert results["identity_declared"].status == "FAIL"


def test_missing_model_fails() -> None:
    agent = _base_agent()
    agent["metadata"] = {"domain": "banking", "llm": {}}
    results = {result.criterion_name: result for result in run_agent_evaluators(agent, _base_assignments())}
    assert results["model_declared"].status == "FAIL"


def test_invalid_agent_type_fails() -> None:
    agent = _base_agent()
    agent["agent_type"] = "magic_agent"
    results = {result.criterion_name: result for result in run_agent_evaluators(agent, _base_assignments())}
    assert results["agent_type_valid"].status == "FAIL"


def test_task_agent_empty_tools_triggers_review() -> None:
    agent = _base_agent()
    agent["permissions"] = {"tools": []}
    results = {result.criterion_name: result for result in run_agent_evaluators(agent, _base_assignments())}
    assert results["tool_scope_defined"].status == "REVIEW"


def test_uncertified_attached_tool_fails() -> None:
    assignments = _base_assignments()
    assignments["tools"] = [{"tool_name": "lookup_account", "certification": {"status": "FAILED"}}]
    results = {result.criterion_name: result for result in run_agent_evaluators(_base_agent(), assignments)}
    assert results["attached_tools_certified"].status == "FAIL"


def test_no_guardrail_fails() -> None:
    assignments = _base_assignments()
    assignments["guardrails"] = []
    results = {result.criterion_name: result for result in run_agent_evaluators(_base_agent(), assignments)}
    assert results["guardrail_assigned"].status == "FAIL"


def test_compute_config_hash_stable_and_changes_on_guardrail() -> None:
    first = compute_agent_config_hash(_base_agent(), _base_assignments())
    assert first == compute_agent_config_hash(_base_agent(), _base_assignments())
    assert len(first) == 64

    assignments = _base_assignments()
    assignments["guardrails"] = [{"policy_id": "pol_different"}]
    assert compute_agent_config_hash(_base_agent(), assignments) != first

