from __future__ import annotations

from intelliguard.adk.manifest import RuntimeManifest
from intelliguard.runtime.contracts import (
    RuntimeExecutionRequest,
    RuntimeExecutionResult,
    RuntimeRunner,
)


def _manifest() -> RuntimeManifest:
    return RuntimeManifest.model_validate(
        {
            "manifest_version": "1.0",
            "workflow_definition_id": "workflow-1",
            "deployment_id": "deploy-1",
            "environment": "demo",
            "runtime_type": "native",
            "graph_version_hash": "graph-hash",
            "nodes": [{"node_id": "lead", "agent_id": "agent-1", "node_type": "lead_agent"}],
            "edges": [],
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


class EchoRuntimeRunner:
    runtime_type = "native"

    def supports(self, runtime_type: str) -> bool:
        return runtime_type == self.runtime_type

    def execute(self, request: RuntimeExecutionRequest) -> RuntimeExecutionResult:
        return RuntimeExecutionResult(
            run_id=request.run_id,
            workflow_id="workflow-run-1",
            decision="APPROVED",
            status="COMPLETED",
            summary=request.user_query,
            output_payload={"idempotency_key": request.idempotency_key},
        )


def test_runtime_execution_request_carries_manifest_and_idempotency_key() -> None:
    request = RuntimeExecutionRequest(
        run_id="run-1",
        manifest=_manifest(),
        user_query="Handle case C123",
        input_payload={"customer_id": "C123"},
        idempotency_key="case-C123",
    )

    assert request.manifest.deployment_id == "deploy-1"
    assert request.input_payload == {"customer_id": "C123"}
    assert request.idempotency_key == "case-C123"


def test_runtime_runner_protocol_returns_common_result_shape() -> None:
    runner: RuntimeRunner = EchoRuntimeRunner()
    result = runner.execute(
        RuntimeExecutionRequest(
            run_id="run-1",
            manifest=_manifest(),
            user_query="Summarize case",
            idempotency_key="case-1",
        )
    )

    assert runner.supports("native") is True
    assert runner.supports("langgraph") is False
    assert result == RuntimeExecutionResult(
        run_id="run-1",
        workflow_id="workflow-run-1",
        decision="APPROVED",
        status="COMPLETED",
        summary="Summarize case",
        output_payload={"idempotency_key": "case-1"},
    )
