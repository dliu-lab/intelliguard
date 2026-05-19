from __future__ import annotations

import inspect

from pydantic import TypeAdapter

from intelliguard.adk.manifest import RuntimeManifest
from intelliguard.runtime.dispatcher import RuntimeWorkItem
from intelliguard.runtime.native_runner import _workflow_definition_from_manifest
from intelliguard.temporal import activities, workflows
from intelliguard.temporal.starter import (
    temporal_input_for_item,
    temporal_workflow_id_for_run,
)


def test_temporal_workflow_input_is_serializable() -> None:
    payload = workflows.TemporalWorkflowInput(
        run_id="run-1",
        deployment_id="deploy-1",
        user_query="Handle case",
        input_payload={"priority": "high"},
    )

    dumped = TypeAdapter(workflows.TemporalWorkflowInput).dump_python(payload, mode="json")

    assert dumped["run_id"] == "run-1"
    assert dumped["input_payload"] == {"priority": "high"}


def test_temporal_start_payload_includes_review_signal_metadata() -> None:
    item = RuntimeWorkItem(
        run_id="run-1",
        deployment_id="deploy-1",
        user_query="Handle case",
        input_payload={"priority": "high"},
        idempotency_key="case-1",
    )
    workflow_id = temporal_workflow_id_for_run(item.run_id)

    payload = temporal_input_for_item(item, workflow_id=workflow_id)

    assert payload.run_id == item.run_id
    assert payload.input_payload["priority"] == "high"
    assert payload.input_payload["temporal_workflow_id"] == workflow_id
    assert payload.idempotency_key == "case-1"


def test_native_runner_carries_temporal_metadata_into_workflow_definition() -> None:
    manifest = RuntimeManifest.model_validate(
        {
            "manifest_version": "1.0",
            "workflow_definition_id": "workflow-1",
            "deployment_id": "deploy-1",
            "environment": "demo",
            "runtime_type": "temporal",
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

    workflow_definition = _workflow_definition_from_manifest(
        manifest,
        runtime_context={
            "temporal_workflow_id": "wf-temporal",
            "temporal_run_id": "run-temporal",
        },
    )

    assert workflow_definition["metadata"]["temporal_workflow_id"] == "wf-temporal"
    assert workflow_definition["metadata"]["temporal_run_id"] == "run-temporal"


def test_activity_names_are_stable() -> None:
    assert activities.ACTIVITY_NAMES == (
        "load_deployment_manifest",
        "execute_agent_node",
        "invoke_governed_tool",
        "run_session_evaluators",
        "run_workflow_evaluators",
        "record_workflow_event",
        "complete_runtime_run",
    )


def test_workflow_does_not_directly_call_runtime_services() -> None:
    source = inspect.getsource(workflows.DurableAgentWorkflow)

    forbidden_tokens = ["GovernanceStore", "ToolGateway", "ModelGateway", "requests.", "urllib."]
    assert not any(token in source for token in forbidden_tokens)


def test_activities_reuse_process_level_dependencies(monkeypatch) -> None:
    created: list[str] = []

    class FakeStore:
        def __init__(self, database_url: str) -> None:
            created.append(database_url)

    monkeypatch.setattr(activities, "GovernanceStore", FakeStore)
    first = activities.configure_activity_dependencies("postgresql://example")
    second = activities.configure_activity_dependencies("postgresql://example")

    assert first is second
    assert created == ["postgresql://example"]
