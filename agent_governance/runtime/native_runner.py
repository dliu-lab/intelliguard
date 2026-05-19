from __future__ import annotations

from typing import Any

from agent_governance.adk.manifest import RuntimeManifest
from agent_governance.multi_agent import run_customer_support_workflow
from agent_governance.runtime.contracts import RuntimeExecutionRequest, RuntimeExecutionResult
from agent_governance.tools import ToolRegistry


class NativeRuntimeRunner:
    runtime_type = "native"

    def __init__(
        self,
        *,
        database_url: str,
        policy_path: str,
        tools: ToolRegistry | None = None,
    ) -> None:
        self.database_url = database_url
        self.policy_path = policy_path
        self.tools = tools

    def supports(self, runtime_type: str) -> bool:
        return runtime_type == self.runtime_type

    def execute(self, request: RuntimeExecutionRequest) -> RuntimeExecutionResult:
        result = run_customer_support_workflow(
            database_url=self.database_url,
            policy_path=self.policy_path,
            tools=self.tools,
            query=request.user_query,
            workflow_definition=_workflow_definition_from_manifest(
                request.manifest,
                runtime_context=_runtime_context_from_request(request),
            ),
        )
        return RuntimeExecutionResult(
            run_id=request.run_id,
            workflow_id=str(result["workflow_id"]),
            decision=str(result["decision"]),
            status="COMPLETED",
            summary=str(result["summary"]),
            output_payload={
                "lead_session_id": result.get("lead_session_id"),
                "sessions": result.get("sessions") or {},
                "step_results": result.get("step_results") or [],
                "tool_calls": [
                    step_result
                    for step_result in result.get("step_results") or []
                    if isinstance(step_result, dict) and step_result.get("tool_name")
                ],
                "evaluator_results": result.get("evaluator_results") or [],
            },
        )


def _workflow_definition_from_manifest(
    manifest: RuntimeManifest,
    runtime_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    nodes = [node.model_dump(mode="json") for node in manifest.nodes]
    edges = [edge.model_dump(mode="json") for edge in manifest.edges]
    lead_node = next(
        (node for node in nodes if node.get("node_type") == "lead_agent"),
        nodes[0] if nodes else {},
    )
    steps = []
    for node in nodes:
        if node.get("node_id") == lead_node.get("node_id"):
            continue
        runtime = node.get("runtime") if isinstance(node.get("runtime"), dict) else {}
        steps.append(
            {
                **node,
                "step_id": node.get("node_id"),
                "tool_name": runtime.get("tool_name"),
                "tool_args": runtime.get("tool_args") or {},
            }
        )
    runtime_context = {
        key: value
        for key, value in (runtime_context or {}).items()
        if key in {"temporal_workflow_id", "temporal_run_id"} and value
    }
    return {
        "workflow_definition_id": manifest.workflow_definition_id,
        "name": manifest.metadata.get("name") or manifest.workflow_definition_id,
        "description": manifest.metadata.get("description") or "",
        "owner": manifest.metadata.get("owner") or "runtime",
        "environment": manifest.environment,
        "domain": manifest.metadata.get("domain") or "",
        "lead_agent_id": lead_node.get("agent_id"),
        "trigger_type": "deployment",
        "steps": steps,
        "nodes": nodes,
        "edges": edges,
        "policy_bindings": {},
        "review_rules": {},
        "graph_version_hash": manifest.graph_version_hash,
        "metadata": {
            **(manifest.metadata or {}),
            **runtime_context,
            "deployment_id": manifest.deployment_id,
            "runtime_type": manifest.runtime_type,
            "manifest_hash": manifest.manifest_hash(),
        },
    }


def _runtime_context_from_request(request: RuntimeExecutionRequest) -> dict[str, Any]:
    return {
        key: request.input_payload[key]
        for key in ("temporal_workflow_id", "temporal_run_id")
        if key in request.input_payload
    }
