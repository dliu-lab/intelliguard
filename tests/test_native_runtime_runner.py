from __future__ import annotations

from agent_governance.adk.manifest import RuntimeManifest
from agent_governance.runtime.contracts import RuntimeExecutionRequest, RuntimeExecutionResult
from agent_governance.runtime import native_runner
from agent_governance.runtime.native_runner import NativeRuntimeRunner


def _manifest() -> RuntimeManifest:
    return RuntimeManifest.model_validate(
        {
            "manifest_version": "1.0",
            "workflow_definition_id": "workflow-1",
            "deployment_id": "deploy-1",
            "environment": "demo",
            "runtime_type": "native",
            "graph_version_hash": "graph-hash",
            "nodes": [
                {"node_id": "lead", "agent_id": "lead-agent", "node_type": "lead_agent"},
                {
                    "node_id": "risk",
                    "agent_id": "risk-agent",
                    "node_type": "task_agent",
                    "allowed_tools": ["score_risk"],
                    "runtime": {"tool_name": "score_risk"},
                },
            ],
            "edges": [
                {
                    "edge_id": "lead->risk",
                    "from_node_id": "lead",
                    "to_node_id": "risk",
                    "conditions": {},
                }
            ],
            "policy_snapshots": {},
            "tool_snapshots": {},
            "evaluator_snapshots": {},
            "knowledge_snapshots": {},
            "runtime_limits": {
                "timeout_seconds": 300,
                "max_parallel_nodes": 4,
                "max_tool_calls": 30,
                "max_llm_calls": 20,
                "max_cost_usd": 5.0,
            },
        }
    )


def test_native_runner_wraps_existing_multi_agent_workflow(monkeypatch) -> None:
    calls: dict[str, object] = {}

    def fake_run_customer_support_workflow(**kwargs):
        calls.update(kwargs)
        return {
            "workflow_id": "workflow-run-1",
            "decision": "ALLOW",
            "summary": "completed",
            "lead_session_id": "sess-lead",
            "sessions": {"risk": "sess-risk"},
            "step_results": [
                {
                    "step_id": "risk",
                    "agent_id": "risk-agent",
                    "tool_name": "score_risk",
                    "decision": "ALLOW",
                    "session_id": "sess-risk",
                }
            ],
            "evaluator_results": [
                {"evaluator_id": "workflow_completion", "score": 100, "passed": True}
            ],
        }

    monkeypatch.setattr(
        native_runner,
        "run_customer_support_workflow",
        fake_run_customer_support_workflow,
    )

    runner = NativeRuntimeRunner(database_url="postgresql://test", policy_path="policy.yaml")
    result = runner.execute(
        RuntimeExecutionRequest(
            run_id="run-1",
            manifest=_manifest(),
            user_query="Handle case C123",
            idempotency_key="case-C123",
        )
    )

    workflow_definition = calls["workflow_definition"]
    assert runner.supports("native") is True
    assert runner.supports("langgraph") is False
    assert workflow_definition["workflow_definition_id"] == "workflow-1"
    assert workflow_definition["lead_agent_id"] == "lead-agent"
    assert workflow_definition["steps"][0]["step_id"] == "risk"
    assert workflow_definition["steps"][0]["tool_name"] == "score_risk"
    assert workflow_definition["metadata"]["deployment_id"] == "deploy-1"
    assert result == RuntimeExecutionResult(
        run_id="run-1",
        workflow_id="workflow-run-1",
        decision="ALLOW",
        status="COMPLETED",
        summary="completed",
        output_payload={
            "lead_session_id": "sess-lead",
            "sessions": {"risk": "sess-risk"},
            "tool_calls": [
                {
                    "step_id": "risk",
                    "agent_id": "risk-agent",
                    "tool_name": "score_risk",
                    "decision": "ALLOW",
                    "session_id": "sess-risk",
                }
            ],
            "step_results": [
                {
                    "step_id": "risk",
                    "agent_id": "risk-agent",
                    "tool_name": "score_risk",
                    "decision": "ALLOW",
                    "session_id": "sess-risk",
                }
            ],
            "evaluator_results": [
                {"evaluator_id": "workflow_completion", "score": 100, "passed": True}
            ],
        },
    )
