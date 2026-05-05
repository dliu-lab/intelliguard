from __future__ import annotations

from agent_governance.evaluation.judge import JudgeResult
from agent_governance.models import new_id
from agent_governance.evaluators import EvaluatorEngine


def _make_session(store, agent_id="customer-support-agent"):
    session_id = new_id("sess")
    store.ensure_agent_session(session_id, agent_id, "test query")
    return session_id


def test_policy_compliance_all_allow(store):
    session_id = _make_session(store)
    store.add_policy_decision(
        session_id=session_id,
        agent_id="customer-support-agent",
        tool_name="get_customer_profile",
        decision="ALLOW",
        risk_score=0,
        risk_types=[],
        reason="OK",
        triggered_rules=[],
    )
    store.add_policy_decision(
        session_id=session_id,
        agent_id="customer-support-agent",
        tool_name="get_customer_transactions",
        decision="ALLOW",
        risk_score=0,
        risk_types=[],
        reason="OK",
        triggered_rules=[],
    )
    engine = EvaluatorEngine(store)
    template = {
        "evaluator_id": "eval_policy_compliance",
        "evaluator_type": "policy_compliance",
        "scope": "agent",
        "default_config": {"pass_threshold": 80},
    }
    result = engine._run_evaluator(template, {"config": {}}, session_id=session_id)
    assert result.score == 100
    assert result.passed is True


def test_policy_compliance_with_block(store):
    session_id = _make_session(store)
    store.add_policy_decision(
        session_id=session_id,
        agent_id="customer-support-agent",
        tool_name="t1",
        decision="ALLOW",
        risk_score=0,
        risk_types=[],
        reason="OK",
        triggered_rules=[],
    )
    store.add_policy_decision(
        session_id=session_id,
        agent_id="customer-support-agent",
        tool_name="t2",
        decision="BLOCK",
        risk_score=90,
        risk_types=["TOOL_MISUSE"],
        reason="blocked",
        triggered_rules=[],
    )
    engine = EvaluatorEngine(store)
    template = {
        "evaluator_id": "eval_policy_compliance",
        "evaluator_type": "policy_compliance",
        "scope": "agent",
        "default_config": {"pass_threshold": 80},
    }
    result = engine._run_evaluator(template, {"config": {}}, session_id=session_id)
    assert result.score == 50
    assert result.passed is False


def test_tool_use_correctness_granted_tools(store):
    session_id = _make_session(store)
    store.add_policy_decision(
        session_id=session_id,
        agent_id="customer-support-agent",
        tool_name="get_customer_profile",
        decision="ALLOW",
        risk_score=0,
        risk_types=[],
        reason="OK",
        triggered_rules=[],
    )
    store.add_tool_call(
        session_id=session_id,
        agent_id="customer-support-agent",
        tool_name="get_customer_profile",
        tool_args={},
        decision="ALLOW",
    )
    engine = EvaluatorEngine(store)
    template = {
        "evaluator_id": "eval_tool_use_correctness",
        "evaluator_type": "tool_use_correctness",
        "scope": "agent",
        "default_config": {"pass_threshold": 100},
    }
    result = engine._run_evaluator(template, {"config": {}}, session_id=session_id)
    assert result.score == 100
    assert result.passed is True


def test_tool_use_correctness_ungrant_tool(store):
    session_id = _make_session(store)
    store.add_tool_call(
        session_id=session_id,
        agent_id="customer-support-agent",
        tool_name="drop_database",
        tool_args={},
        decision="BLOCK",
    )
    engine = EvaluatorEngine(store)
    template = {
        "evaluator_id": "eval_tool_use_correctness",
        "evaluator_type": "tool_use_correctness",
        "scope": "agent",
        "default_config": {"pass_threshold": 100},
    }
    result = engine._run_evaluator(template, {"config": {}}, session_id=session_id)
    assert result.score < 100
    assert result.passed is False


def test_pii_leakage_clean(store):
    session_id = _make_session(store)
    engine = EvaluatorEngine(store)
    template = {
        "evaluator_id": "eval_pii_leakage",
        "evaluator_type": "pii_leakage",
        "scope": "agent",
        "default_config": {"pass_threshold": 100},
    }
    result = engine._run_evaluator(template, {"config": {}}, session_id=session_id)
    assert result.score == 100
    assert result.passed is True


def test_pii_leakage_detected(store):
    session_id = _make_session(store)
    store.add_audit_event(
        session_id=session_id,
        agent_id="customer-support-agent",
        risk_type="PII_LEAKAGE",
        decision="BLOCK",
        reason="PII detected",
        tool_name=None,
        risk_score=88,
    )
    engine = EvaluatorEngine(store)
    template = {
        "evaluator_id": "eval_pii_leakage",
        "evaluator_type": "pii_leakage",
        "scope": "agent",
        "default_config": {"pass_threshold": 100},
    }
    result = engine._run_evaluator(template, {"config": {}}, session_id=session_id)
    assert result.score == 0
    assert result.passed is False


def test_llm_enabled_response_quality_uses_judge(monkeypatch, store):
    session_id = _make_session(store)
    store.add_workflow_event(
        session_id=session_id,
        agent_id="customer-support-agent",
        event_type="WORKFLOW_SUMMARY",
        label="Lead summary",
        status="ALLOW",
        payload={"summary": "The final answer is grounded in approved context."},
    )
    calls = []

    def fake_run_judge_sync(criterion_name, input_data, judge_config):
        calls.append(
            {
                "criterion_name": criterion_name,
                "input_data": input_data,
                "judge_config": judge_config,
            }
        )
        return JudgeResult(
            criterion_name=criterion_name,
            status="PASS",
            score=91,
            evidence_sentence="The judge approved the response.",
            judge_model="judge-model",
            prompt_version="response-v1",
            raw_response='{"status":"PASS","score":91}',
        )

    monkeypatch.setattr("agent_governance.evaluators.run_judge_sync", fake_run_judge_sync)

    engine = EvaluatorEngine(store)
    template = {
        "evaluator_id": "eval_response_quality",
        "evaluator_type": "response_quality",
        "scope": "workflow",
        "llm_enabled": True,
        "default_config": {
            "pass_threshold": 80,
            "judge": {
                "model": "default-judge-model",
                "prompt_version": "response-v1",
                "rubric": "Judge the final response against recorded workflow evidence.",
            },
        },
    }

    result = engine._run_evaluator(
        template,
        {"config": {"judge": {"provider": "ollama", "model": "qwen3.5:9b"}}},
        session_id=session_id,
    )

    assert result.score == 91
    assert result.passed is True
    assert result.findings[0]["result"] == "pass"
    assert result.findings[0]["detail"] == "The judge approved the response."
    assert calls[0]["criterion_name"] == "response_quality"
    assert calls[0]["input_data"]["events"][0]["event_type"] == "WORKFLOW_SUMMARY"
    assert calls[0]["judge_config"]["provider"] == "ollama"
    assert calls[0]["judge_config"]["model"] == "qwen3.5:9b"
    assert calls[0]["judge_config"]["prompt_version"] == "response-v1"
    assert (
        calls[0]["judge_config"]["rubric"]
        == "Judge the final response against recorded workflow evidence."
    )
