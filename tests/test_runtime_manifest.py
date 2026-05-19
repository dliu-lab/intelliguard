from __future__ import annotations

import pytest
from pydantic import ValidationError

from intelliguard.adk.manifest import RuntimeManifest


def _manifest_payload() -> dict:
    return {
        "manifest_version": "1.0",
        "workflow_definition_id": "customer-support-workflow",
        "deployment_id": "dep_123",
        "environment": "pre_prod",
        "runtime_type": "native",
        "graph_version_hash": "graph123",
        "nodes": [
            {
                "node_id": "lead",
                "agent_id": "support-lead",
                "node_type": "lead_agent",
                "allowed_tools": [],
                "runtime": {"framework": "native"},
            }
        ],
        "edges": [],
        "policy_snapshots": {"support-lead": "policy123"},
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


def test_runtime_manifest_accepts_certified_payload() -> None:
    manifest = RuntimeManifest.model_validate(_manifest_payload())

    assert manifest.workflow_definition_id == "customer-support-workflow"
    assert manifest.runtime_limits.max_parallel_nodes == 4


def test_runtime_manifest_requires_runtime_limits() -> None:
    payload = _manifest_payload()
    payload.pop("runtime_limits")

    with pytest.raises(ValidationError, match="runtime_limits"):
        RuntimeManifest.model_validate(payload)


def test_runtime_manifest_hash_is_stable() -> None:
    first = RuntimeManifest.model_validate(_manifest_payload())
    second = RuntimeManifest.model_validate(_manifest_payload())

    assert first.manifest_hash() == second.manifest_hash()


def test_runtime_manifest_hash_includes_node_metadata_but_excludes_top_level_metadata() -> None:
    first_payload = _manifest_payload()
    second_payload = _manifest_payload()
    second_payload["metadata"] = {"generated_at": "different"}

    first = RuntimeManifest.model_validate(first_payload)
    second = RuntimeManifest.model_validate(second_payload)

    assert first.manifest_hash() == second.manifest_hash()

    second_payload["nodes"][0]["metadata"] = {"contract_affecting": True}
    changed = RuntimeManifest.model_validate(second_payload)

    assert first.manifest_hash() != changed.manifest_hash()


def test_runtime_manifest_accepts_hooks_and_hash_includes_them() -> None:
    baseline = RuntimeManifest.model_validate(_manifest_payload())
    payload = _manifest_payload()
    payload["hooks"] = [
        {
            "hook_id": "legal-review",
            "display_name": "Legal review",
            "hook_point": "before_workflow",
            "action": "pause_for_review",
            "conditions": {"environment": "pre_prod"},
            "required_roles": ["legal"],
            "review_message": "Legal approval is required before this workflow runs.",
        }
    ]

    manifest = RuntimeManifest.model_validate(payload)

    assert manifest.hooks[0].hook_id == "legal-review"
    assert manifest.hooks[0].hook_point == "before_workflow"
    assert manifest.hooks[0].action == "pause_for_review"
    assert manifest.manifest_hash() != baseline.manifest_hash()
