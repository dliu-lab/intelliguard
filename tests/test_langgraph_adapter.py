from __future__ import annotations

import importlib.util

import pytest

from intelliguard.adk.manifest import RuntimeManifest
from intelliguard.adapters.langgraph import LangGraphBuildAdapter
from intelliguard.runtime.tool_gateway import ToolGatewayRequest


def _manifest() -> RuntimeManifest:
    return RuntimeManifest.model_validate(
        {
            "manifest_version": "1.0",
            "workflow_definition_id": "workflow-1",
            "deployment_id": "deploy-1",
            "environment": "demo",
            "runtime_type": "langgraph",
            "graph_version_hash": "graph-hash",
            "nodes": [
                {
                    "node_id": "lead",
                    "agent_id": "lead-agent",
                    "node_type": "lead_agent",
                    "runtime": {"tool_name": "lookup_customer"},
                },
                {
                    "node_id": "risk",
                    "agent_id": "risk-agent",
                    "node_type": "task_agent",
                    "runtime": {"tool_name": "score_risk"},
                },
            ],
            "edges": [
                {
                    "edge_id": "lead->risk",
                    "from_node_id": "lead",
                    "to_node_id": "risk",
                    "conditions": {"decision": "ALLOW"},
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


def test_langgraph_adapter_imports_without_optional_dependency() -> None:
    assert LangGraphBuildAdapter.framework == "langgraph"


def test_langgraph_adapter_raises_clear_error_without_langgraph() -> None:
    if importlib.util.find_spec("langgraph"):
        pytest.skip("LangGraph installed; build path tested separately")
    with pytest.raises(RuntimeError, match="langgraph"):
        LangGraphBuildAdapter().build(_manifest())


def test_langgraph_build_uses_tool_gateway_when_langgraph_is_installed() -> None:
    pytest.importorskip(
        "langgraph", reason="Install the langgraph extra to run adapter build tests"
    )
    captured: list[ToolGatewayRequest] = []

    class Gateway:
        def invoke(self, request: ToolGatewayRequest):
            captured.append(request)
            return {"decision": "ALLOW", "result": {"ok": True}}

    graph = LangGraphBuildAdapter(tool_gateway=Gateway()).build(_manifest())

    assert graph is not None
