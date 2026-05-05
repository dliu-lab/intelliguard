from __future__ import annotations

import api.main as api_main
from agent_governance.evaluation.rules import evaluation_rule_catalog
from agent_governance.store import GovernanceStore


def _super_admin_user() -> dict:
    return {
        "email": "admin@example.com",
        "role": "Admin",
        "is_super_admin": True,
        "allowed_environments": [],
        "permissions_by_environment": {},
    }


def test_evaluation_rule_catalog_includes_certification_and_runtime_rules() -> None:
    templates = [
        {
            "evaluator_id": "eval_response_quality",
            "display_name": "Response Quality",
            "evaluator_type": "response_quality",
            "scope": "workflow",
            "description": "Judge final response quality.",
            "default_config": {"pass_threshold": 80},
            "llm_enabled": True,
        }
    ]

    catalog = evaluation_rule_catalog(templates)
    groups = {group["group_id"]: group for group in catalog}

    assert "tool_certification" in groups
    assert "agent_certification" in groups
    assert "workflow_certification" in groups
    assert "knowledge_base_evaluation" in groups
    assert "runtime_evaluators" in groups
    assert {rule["rule_id"] for rule in groups["tool_certification"]["rules"]} >= {
        "input_schema_validation",
        "permission_model_validation",
        "pii_field_leakage",
    }
    assert groups["runtime_evaluators"]["rules"][0]["engine"] == "LLM-as-judge"
    assert groups["runtime_evaluators"]["rules"][0]["default_config"] == {"pass_threshold": 80}


def test_evaluation_rules_endpoint_returns_catalog(
    monkeypatch,
    store: GovernanceStore,
) -> None:
    monkeypatch.setattr(api_main, "store", store)

    catalog = api_main.list_evaluation_rules(_super_admin_user())

    groups = {group["group_id"]: group for group in catalog}
    assert "runtime_evaluators" in groups
    assert any(
        rule["rule_id"] == "eval_policy_compliance"
        for rule in groups["runtime_evaluators"]["rules"]
    )
    response_quality_rule = next(
        rule
        for rule in groups["runtime_evaluators"]["rules"]
        if rule["rule_id"] == "eval_response_quality"
    )
    assert response_quality_rule["default_config"]["judge"]["provider"] == "ollama"
    assert response_quality_rule["default_config"]["judge"]["model"] == "qwen3.5:9b"
