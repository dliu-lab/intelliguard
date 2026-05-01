from __future__ import annotations

from agent_governance.models import GuardrailPolicy, EvaluatorTemplate, new_id
from agent_governance.store import GovernanceStore


def test_models_importable():
    assert GuardrailPolicy.__tablename__ == "guardrail_policies"
    assert EvaluatorTemplate.__tablename__ == "evaluator_templates"


def test_upsert_and_get_guardrail_policy(store):
    payload = {
        "policy_id": "pol_test_001",
        "display_name": "Test Policy",
        "description": "For tests",
        "environment": "staging",
        "config": {
            "allowed_tools": ["get_customer_profile"],
            "blocked_tools": [],
            "max_records_returned": 50,
            "block_pii_in_response": True,
            "redact_pii_in_response": False,
            "blocked_patterns": [],
            "review_required_for": [],
            "decision_thresholds": {"review": 40, "block": 70},
        },
    }
    result = store.upsert_guardrail_policy(payload)
    assert result["policy_id"] == "pol_test_001"
    assert result["display_name"] == "Test Policy"

    fetched = store.get_guardrail_policy("pol_test_001")
    assert fetched["config"]["max_records_returned"] == 50

    listed = store.list_guardrail_policies(environment="staging")
    assert any(p["policy_id"] == "pol_test_001" for p in listed)


def test_guardrail_assignment_lifecycle(store):
    # create policy first
    store.upsert_guardrail_policy(
        {
            "policy_id": "pol_assign_test",
            "display_name": "Assign Test Policy",
            "description": "",
            "environment": "demo",
            "config": {"decision_thresholds": {"review": 50, "block": 80}},
        }
    )
    result = store.upsert_agent_guardrail_assignment(
        agent_id="customer-support-agent",
        environment="demo",
        policy_id="pol_assign_test",
        mode="enforce",
        threshold_overrides={},
    )
    assert result["agent_id"] == "customer-support-agent"
    assert result["mode"] == "enforce"

    fetched = store.get_agent_guardrail_assignment("customer-support-agent", "demo")
    assert fetched["policy_id"] == "pol_assign_test"

    listed = store.list_agent_guardrail_assignments("customer-support-agent")
    assert any(a["policy_id"] == "pol_assign_test" for a in listed)

    deleted = store.delete_agent_guardrail_assignment(result["assignment_id"])
    assert deleted is True
    assert store.get_agent_guardrail_assignment("customer-support-agent", "demo") is None


def test_delete_agent_identity_removes_governance_assignments(store):
    agent = store.upsert_agent_identity(
        {
            "agent_id": "delete-me-agent",
            "display_name": "Delete Me Agent",
            "agent_type": "custom_agent",
            "owner": "Tests",
            "environment": "demo",
            "purpose": "Temporary agent for deletion tests.",
            "permissions": {"tools": ["get_customer_profile"]},
            "metadata": {},
        }
    )
    store.upsert_guardrail_policy(
        {
            "policy_id": "pol_delete_agent",
            "display_name": "Delete Agent Policy",
            "description": "",
            "environment": "demo",
            "config": {"decision_thresholds": {"review": 50, "block": 80}},
        }
    )
    guardrail = store.upsert_agent_guardrail_assignment(
        agent_id=agent["agent_id"],
        environment="demo",
        policy_id="pol_delete_agent",
        mode="enforce",
        threshold_overrides={},
    )
    evaluator = store.upsert_agent_evaluator_assignment(
        agent_id=agent["agent_id"],
        environment="demo",
        evaluator_id="eval_policy_compliance",
        trigger="after_run",
        config={},
    )

    assert store.delete_agent_identity(agent["agent_id"]) is True
    assert store.delete_agent_identity(agent["agent_id"]) is False
    assert not any(item["agent_id"] == agent["agent_id"] for item in store.list_agents())
    assert store.delete_agent_guardrail_assignment(guardrail["assignment_id"]) is False
    assert store.delete_agent_evaluator_assignment(evaluator["assignment_id"]) is False


def test_get_sessions_for_workflow(store):
    workflow_id = store.create_agent_workflow(
        name="Test workflow", user_goal="test", lead_agent_id="customer-support-agent"
    )
    session_id = new_id("sess")
    store.ensure_agent_session(session_id, "customer-support-agent", "test query")
    store.link_session_to_workflow(
        workflow_id=workflow_id,
        session_id=session_id,
        agent_id="customer-support-agent",
        role="lead",
    )
    sessions = store.get_sessions_for_workflow(workflow_id)
    assert any(s["session_id"] == session_id for s in sessions)


def test_evaluator_template_and_assignment(store):
    templates = store.list_evaluator_templates()
    # seeded 5 built-ins in Task 3
    assert any(t["evaluator_id"] == "eval_policy_compliance" for t in templates)

    result = store.upsert_agent_evaluator_assignment(
        agent_id="customer-support-agent",
        environment="demo",
        evaluator_id="eval_policy_compliance",
        trigger="after_run",
        config={},
    )
    assert result["evaluator_id"] == "eval_policy_compliance"
    assert result["trigger"] == "after_run"

    assignments = store.list_agent_evaluator_assignments("customer-support-agent")
    assert any(a["evaluator_id"] == "eval_policy_compliance" for a in assignments)

    by_trigger = store.get_agent_evaluator_assignments_for_trigger(
        "customer-support-agent", "demo", "after_run"
    )
    assert any(a["evaluator_id"] == "eval_policy_compliance" for a in by_trigger)

    deleted = store.delete_agent_evaluator_assignment(result["assignment_id"])
    assert deleted is True


def test_evaluation_result_lifecycle(store):
    session_id = new_id("sess")
    store.ensure_agent_session(session_id, "customer-support-agent", "test query")

    result = store.add_evaluation_result(
        session_id=session_id,
        workflow_id=None,
        agent_id="customer-support-agent",
        evaluator_id="eval_policy_compliance",
        score=90,
        passed=True,
        findings=[{"check": "policy_decisions", "result": "pass", "detail": "9/10 ALLOW"}],
        trigger="after_run",
    )
    assert result["score"] == 90
    assert result["passed"] is True

    session_results = store.list_session_evaluation_results(session_id)
    assert any(r["evaluator_id"] == "eval_policy_compliance" for r in session_results)

    all_results = store.list_evaluation_results(agent_id="customer-support-agent")
    assert any(r["session_id"] == session_id for r in all_results)


def test_list_review_queue_returns_all_statuses(store: GovernanceStore) -> None:
    store.ensure_agent_session("sess_rev_all", "test-agent", "test query")
    rev_id = store.add_review_item(
        session_id="sess_rev_all",
        agent_id="test-agent",
        tool_name="get_data",
        tool_args={},
        user_query="test query",
        risk_score=60,
        risk_types=["sensitive_data_exposure"],
        reason="test",
    )
    store.resolve_review_item(rev_id, "APPROVED", "looks fine")

    pending = store.list_review_queue(status="PENDING")
    approved = store.list_review_queue(status="APPROVED")
    all_items = store.list_review_queue(status="ALL")

    assert not any(r["review_id"] == rev_id for r in pending)
    assert any(r["review_id"] == rev_id for r in approved)
    assert any(r["review_id"] == rev_id for r in all_items)
    resolved = next(r for r in approved if r["review_id"] == rev_id)
    assert resolved["reviewer_note"] == "looks fine"
    assert resolved["resolved_at"] is not None
