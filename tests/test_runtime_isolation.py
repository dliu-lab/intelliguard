from __future__ import annotations

from agent_governance.adk.manifest import RuntimeManifest
from agent_governance.runtime.isolation import (
    determine_worker_pool,
    validate_manifest_has_no_secret_values,
)


def _manifest(**overrides) -> RuntimeManifest:
    payload = {
        "manifest_version": "1.0",
        "workflow_definition_id": "workflow-1",
        "deployment_id": "deploy-1",
        "environment": "pre_prod",
        "runtime_type": "native",
        "graph_version_hash": "graph-hash",
        "nodes": [
            {
                "node_id": "lead",
                "agent_id": "agent-1",
                "node_type": "lead_agent",
                "allowed_tools": ["lookup"],
                "metadata": {"tool_side_effects": {"lookup": "read_only"}},
            }
        ],
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
        "metadata": {"data_classification": "internal"},
    }
    payload.update(overrides)
    return RuntimeManifest.model_validate(payload)


def test_read_only_agents_can_use_shared_pool() -> None:
    assert determine_worker_pool(_manifest()) == "shared-readonly"


def test_write_tools_require_governed_write_pool() -> None:
    manifest = _manifest(
        nodes=[
            {
                "node_id": "lead",
                "agent_id": "agent-1",
                "node_type": "lead_agent",
                "allowed_tools": ["refund"],
                "metadata": {"tool_side_effects": {"refund": "write"}},
            }
        ]
    )

    assert determine_worker_pool(manifest) == "shared-governed-write"


def test_untrusted_code_requires_isolated_pool() -> None:
    manifest = _manifest(
        nodes=[
            {
                "node_id": "lead",
                "agent_id": "agent-1",
                "node_type": "lead_agent",
                "runtime": {"code_trust": "untrusted"},
            }
        ]
    )

    assert determine_worker_pool(manifest) == "isolated-agent-code"


def test_production_requires_data_classification() -> None:
    manifest = _manifest(environment="production", metadata={})

    assert determine_worker_pool(manifest) == "human-review"


def test_connector_secret_values_cannot_appear_in_manifest_json() -> None:
    manifest = _manifest(metadata={"data_classification": "internal", "secret_ref": "vault://ok"})

    validate_manifest_has_no_secret_values(manifest)

    bad_manifest = _manifest(metadata={"data_classification": "internal", "api_key": "sk-live"})
    try:
        validate_manifest_has_no_secret_values(bad_manifest)
    except ValueError as exc:
        assert "secret value" in str(exc)
    else:
        raise AssertionError("manifest secret values must be rejected")
