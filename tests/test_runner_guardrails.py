from __future__ import annotations

from examples.review_trigger_workflow import (
    DEFAULT_LOCAL_DATABASE_URL,
    build_database_url,
    install_review_trigger_workflow,
    run_review_trigger_workflow,
)
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


def test_audit_events_include_policy_snapshot_and_stage(store):
    store.upsert_guardrail_policy(
        {
            "policy_id": "pol_audit_test",
            "display_name": "Audit Test Policy",
            "description": "",
            "environment": "demo",
            "config": {
                "allowed_tools": [],
                "blocked_tools": [],
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
        policy_id="pol_audit_test",
        mode="enforce",
        threshold_overrides={},
    )
    session_id = new_id("sess")
    runner = _make_runner(store)
    result = runner.evaluate_tool_call(
        session_id=session_id,
        user_query="Show recent transactions for customer C123",
        tool_name="get_customer_transactions",
        tool_args={"customer_id": "C123"},
    )

    assert result.decision == "ALLOW"
    events = store.list_audit_events(limit=10, environment="demo")
    event = next(item for item in events if item["event_id"] == result.audit_event_id)
    assert event["stage"] == "pre_tool"
    assert event["policy_snapshot_hash"]
    assert event["policy_id"] is not None  # runner must wire policy_id through
    assert event["metadata"]["guardrail_mode"] == "enforce"
    assert event["metadata"]["decision_thresholds"] == {"review": 50, "block": 80}
    # cleanup
    assignment = store.get_agent_guardrail_assignment("customer-support-agent", "demo")
    store.delete_agent_guardrail_assignment(assignment["assignment_id"])


def test_missing_required_tool_argument_is_blocked(store):
    session_id = new_id("sess")
    runner = _make_runner(store)
    result = runner.evaluate_tool_call(
        session_id=session_id,
        user_query="Show recent transactions for customer C123",
        tool_name="get_customer_transactions",
        tool_args={},
    )

    assert result.decision == "BLOCK"
    assert "INVALID_TOOL_ARGUMENTS" in result.risk_types
    assert "missing required arguments" in result.reason


def test_customer_id_scope_mismatch_is_blocked(store):
    session_id = new_id("sess")
    runner = _make_runner(store)
    result = runner.evaluate_tool_call(
        session_id=session_id,
        user_query="Show recent transactions for customer C123",
        tool_name="get_customer_transactions",
        tool_args={"customer_id": "C456"},
    )

    assert result.decision == "BLOCK"
    assert "SESSION_SCOPE_VIOLATION" in result.risk_types


def test_side_effect_tool_requires_review_before_execution(store):
    session_id = new_id("sess")
    runner = _make_runner(store)
    result = runner.evaluate_tool_call(
        session_id=session_id,
        user_query="Update contact details for customer C123",
        tool_name="update_contact_info",
        tool_args={"customer_id": "C123", "new_value": {"phone": "+61 400 000 000"}},
    )

    assert result.decision == "REVIEW"
    assert result.review_id
    assert "SIDE_EFFECT_REQUIRES_REVIEW" in result.risk_types


def test_review_trigger_workflow_script_creates_review_item(store):
    workflow_definition = install_review_trigger_workflow(store)
    assert workflow_definition["workflow_definition_id"] == "review-trigger-email-search"

    result = run_review_trigger_workflow(store)

    assert result["decision"] == "REVIEW"
    reviews = store.list_review_queue(environment="demo")
    review = next(
        item
        for item in reviews
        if item["workflow_id"] == result["workflow_id"] and item["tool_name"] == "search_customers"
    )
    assert review["status"] == "PENDING"
    assert "PII_EXPOSURE" in review["risk_types"]
    assert review["tool_args"]["filter"]["include_email"] is True


def test_review_trigger_workflow_cli_database_url_helpers(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)

    assert (
        build_database_url(
            database_url=None,
            host=None,
            port=None,
            database="governance",
            user="governance",
            password="governance",
        )
        == DEFAULT_LOCAL_DATABASE_URL
    )
    assert (
        build_database_url(
            database_url=None,
            host="db.example.test",
            port=6543,
            database="governance",
            user="governance",
            password="secret",
        )
        == "postgresql+psycopg://governance:secret@db.example.test:6543/governance"
    )


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
