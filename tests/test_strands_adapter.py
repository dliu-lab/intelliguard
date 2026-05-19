from __future__ import annotations

import importlib.util

import pytest

from intelliguard.adk.manifest import RuntimeManifest
from intelliguard.adapters.strands import StrandsBuildAdapter
from intelliguard.runner import GovernedToolResult


class FakeStrandsAgent:
    name = "Claims Agent"
    instructions = "Handle claims."
    model = "anthropic.claude"
    tools = ["lookup_claim"]


class FakeStrandsTool:
    name = "lookup_claim"
    description = "Look up a claim."
    args_schema = {"type": "object", "properties": {"claim_id": {"type": "string"}}}


def _manifest() -> RuntimeManifest:
    return RuntimeManifest.model_validate(
        {
            "manifest_version": "1.0",
            "workflow_definition_id": "workflow-1",
            "deployment_id": "deploy-1",
            "environment": "demo",
            "runtime_type": "strands",
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


def test_strands_agent_maps_to_registration_payload() -> None:
    payload = StrandsBuildAdapter().agent_to_registration_payload(FakeStrandsAgent())

    assert payload["agent_id"] == "claims-agent"
    assert payload["display_name"] == "Claims Agent"
    assert payload["agent_type"] == "task_agent"
    assert payload["purpose"] == "Handle claims."
    assert payload["metadata"]["framework"] == "strands"
    assert payload["metadata"]["telemetry"]["agentic.adapter"] == "strands"


def test_strands_tool_maps_to_tool_record_payload() -> None:
    payload = StrandsBuildAdapter().tool_to_registration_payload(FakeStrandsTool())

    assert payload["tool_name"] == "lookup_claim"
    assert payload["description"] == "Look up a claim."
    assert payload["input_schema"] == FakeStrandsTool.args_schema
    assert payload["metadata"]["framework"] == "strands"


def test_strands_gateway_tool_callable_invokes_tool_gateway() -> None:
    calls = []

    class Gateway:
        def invoke(self, request):
            calls.append(request)
            return GovernedToolResult(
                decision="ALLOW",
                risk_score=0,
                risk_types=[],
                reason="ok",
                result={"claim_id": request.tool_args["claim_id"]},
            )

    adapter = StrandsBuildAdapter(tool_gateway=Gateway())
    wrapped = adapter.gateway_tool_callable(agent_id="agent-1", tool_name="lookup_claim")
    result = wrapped(session_id="sess-1", user_query="Claim CLM1", claim_id="CLM1")

    assert result == {"claim_id": "CLM1"}
    assert calls[0].agent_id == "agent-1"
    assert calls[0].tool_name == "lookup_claim"


def test_strands_build_raises_clear_error_without_optional_dependency() -> None:
    if importlib.util.find_spec("strands"):
        pytest.skip("Strands installed; build path is environment-dependent")
    with pytest.raises(RuntimeError, match="strands"):
        StrandsBuildAdapter().build(_manifest())
