from __future__ import annotations

from agent_governance.runner import GovernedToolRunner
from agent_governance.policy import PolicyConfig
from agent_governance.models import new_id
from agent_governance.tools import build_customer_tool_registry


def _make_runner(store):
    return GovernedToolRunner(
        agent_id="customer-support-agent",
        database_url=store.session_factory.kw["bind"].url.render_as_string(hide_password=False),
        policy_path="policies/policy.yaml",
        tools=build_customer_tool_registry(),
    )


def test_no_assignment_falls_back_to_yaml(store):
    runner = _make_runner(store)
    assert runner.guardrail_mode == "enforce"
    assert isinstance(runner.policy, PolicyConfig)


def test_assignment_enforce_mode_uses_db_policy(store):
    store.upsert_guardrail_policy(
        {
            "policy_id": "pol_runner_test",
            "display_name": "Runner Test Policy",
            "description": "",
            "environment": "demo",
            "config": {
                "allowed_tools": [],
                "blocked_tools": [],
                "max_records_returned": 10,
                "block_pii_in_response": True,
                "redact_pii_in_response": False,
                "blocked_patterns": [],
                "review_required_for": [],
                "decision_thresholds": {"review": 30, "block": 60},
            },
        }
    )
    store.upsert_agent_guardrail_assignment(
        agent_id="customer-support-agent",
        environment="demo",
        policy_id="pol_runner_test",
        mode="enforce",
        threshold_overrides={},
    )
    runner = _make_runner(store)
    assert runner.guardrail_mode == "enforce"
    assert runner.policy.max_records_returned == 10
    assert runner.policy.decision_thresholds.block == 60
    # cleanup
    assignment = store.get_agent_guardrail_assignment("customer-support-agent", "demo")
    store.delete_agent_guardrail_assignment(assignment["assignment_id"])


def test_review_only_mode_downgrades_block(store):
    store.upsert_guardrail_policy(
        {
            "policy_id": "pol_review_only",
            "display_name": "Review Only",
            "description": "",
            "environment": "demo",
            "config": {
                "allowed_tools": [],
                "blocked_tools": ["get_customer_profile"],
                "max_records_returned": 100,
                "block_pii_in_response": True,
                "redact_pii_in_response": False,
                "blocked_patterns": [],
                "review_required_for": [],
                "decision_thresholds": {"review": 50, "block": 80},
            },
        }
    )
    store.upsert_agent_guardrail_assignment(
        agent_id="customer-support-agent",
        environment="demo",
        policy_id="pol_review_only",
        mode="review_only",
        threshold_overrides={},
    )
    session_id = new_id("sess")
    runner = _make_runner(store)
    result = runner.evaluate_tool_call(
        session_id=session_id,
        user_query="get profile",
        tool_name="get_customer_profile",
        tool_args={"customer_id": "C123"},
    )
    # policy blocks get_customer_profile but review_only downgrades to REVIEW
    assert result.decision == "REVIEW"
    # cleanup
    assignment = store.get_agent_guardrail_assignment("customer-support-agent", "demo")
    store.delete_agent_guardrail_assignment(assignment["assignment_id"])


def test_disabled_mode_allows_everything(store):
    store.upsert_guardrail_policy(
        {
            "policy_id": "pol_disabled",
            "display_name": "Disabled",
            "description": "",
            "environment": "demo",
            "config": {
                "allowed_tools": [],
                "blocked_tools": ["get_customer_profile"],
                "max_records_returned": 100,
                "block_pii_in_response": True,
                "redact_pii_in_response": False,
                "blocked_patterns": [],
                "review_required_for": [],
                "decision_thresholds": {"review": 50, "block": 80},
            },
        }
    )
    store.upsert_agent_guardrail_assignment(
        agent_id="customer-support-agent",
        environment="demo",
        policy_id="pol_disabled",
        mode="disabled",
        threshold_overrides={},
    )
    session_id = new_id("sess")
    runner = _make_runner(store)
    result = runner.evaluate_tool_call(
        session_id=session_id,
        user_query="get profile",
        tool_name="get_customer_profile",
        tool_args={"customer_id": "C123"},
    )
    assert result.decision == "ALLOW"
    # cleanup
    assignment = store.get_agent_guardrail_assignment("customer-support-agent", "demo")
    store.delete_agent_guardrail_assignment(assignment["assignment_id"])
