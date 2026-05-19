from __future__ import annotations

import pytest

from intelliguard.adk.manifest import RuntimeManifest
from intelliguard.runtime.manifest_compiler import (
    ManifestCompileError,
    build_manifest_snapshots,
    compile_workflow_manifest,
    compute_kb_version_snapshot,
)
from intelliguard.workflows.graph import workflow_graph_hash


def _workflow(edges: list[dict] | None = None) -> dict:
    nodes = [
        {
            "node_id": "lead",
            "agent_id": "lead-agent",
            "node_type": "lead_agent",
            "allowed_tools": ["lookup_customer"],
        },
        {
            "node_id": "risk",
            "agent_id": "risk-agent",
            "node_type": "task_agent",
            "allowed_tools": ["score_risk"],
        },
    ]
    return {
        "workflow_definition_id": "workflow-1",
        "environment": "production",
        "domain": "banking",
        "graph_version_hash": None,
        "nodes": nodes,
        "edges": edges
        or [
            {
                "edge_id": "lead->risk",
                "from_node_id": "lead",
                "to_node_id": "risk",
                "conditions": {},
            }
        ],
    }


def test_certified_workflow_compiles_to_runtime_manifest_with_recomputed_graph_hash() -> None:
    workflow = _workflow()

    manifest = compile_workflow_manifest(
        workflow=workflow,
        certification={"status": "CERTIFIED"},
        deployment_id="deploy-1",
        snapshots={
            "agents": {"lead-agent": "agent-hash"},
            "tools": {"lookup_customer": "tool-hash"},
            "evaluators": {"workflow_graph_baseline": "eval-hash"},
            "policies": {"guardrail-default": "policy-hash"},
            "knowledge": {"banking-kb": "kb-hash"},
        },
    )

    assert isinstance(manifest, RuntimeManifest)
    assert manifest.graph_version_hash == workflow_graph_hash(workflow["nodes"], workflow["edges"])
    assert manifest.agent_snapshots == {"lead-agent": "agent-hash"}
    assert manifest.tool_snapshots == {"lookup_customer": "tool-hash"}
    assert manifest.evaluator_snapshots == {"workflow_graph_baseline": "eval-hash"}
    assert manifest.policy_snapshots == {"guardrail-default": "policy-hash"}
    assert manifest.knowledge_snapshots == {"banking-kb": "kb-hash"}
    assert manifest.runtime_limits.timeout_seconds == 300


def test_uncertified_workflow_is_rejected() -> None:
    with pytest.raises(ManifestCompileError, match="certified"):
        compile_workflow_manifest(
            workflow=_workflow(),
            certification={"status": "NEEDS_REEVALUATION"},
            deployment_id="deploy-1",
            snapshots={},
        )


def test_kb_snapshot_uses_published_version_and_index_identity() -> None:
    published = {
        "version_id": "kbv-1",
        "kb_id": "banking-kb",
        "version": "v1.0.0",
        "status": "published",
        "profile": {"environment": "production", "domain": "banking"},
        "file_manifest": [{"file_name": "policy.pdf", "checksum": "abc"}],
        "retrieval_mode": "vector",
        "vector_backend": "pgvector",
        "embedding_model": "text-embedding-3-small",
        "chunking_strategy": "semantic",
        "chunk_size": 1024,
        "chunk_overlap": 160,
        "index_version_id": "idx-1",
        "kb_scope": "domain",
        "scope_ref": "banking",
    }
    reindexed = {**published, "index_version_id": "idx-2"}

    assert compute_kb_version_snapshot(published) != compute_kb_version_snapshot(reindexed)

    snapshots = build_manifest_snapshots(
        workflow=_workflow(),
        agents=[{"agent_id": "lead-agent", "config_hash": "agent-hash"}],
        tools=[{"tool_name": "lookup_customer", "artifact_digest": "tool-hash"}],
        evaluators=[{"evaluator_id": "workflow_graph_baseline", "config_hash": "eval-hash"}],
        guardrails=[{"policy_id": "guardrail-default", "config_hash": "policy-hash"}],
        kb_versions=[
            published,
            {**published, "version_id": "kbv-draft", "status": "draft"},
            {**published, "kb_id": "claims-kb", "scope_ref": "claims"},
        ],
        kb_assignments=[],
    )

    assert snapshots["knowledge"] == {"banking-kb": compute_kb_version_snapshot(published)}


def test_agent_scoped_kb_snapshot_requires_assignment_to_workflow_agent() -> None:
    agent_scoped = {
        "version_id": "kbv-agent",
        "kb_id": "risk-kb",
        "version": "v2.0.0",
        "status": "published",
        "profile": {"environment": "production", "domain": "banking"},
        "file_manifest": [],
        "retrieval_mode": "file",
        "vector_backend": "pgvector",
        "embedding_model": "local/default",
        "chunking_strategy": "semantic",
        "chunk_size": 1024,
        "chunk_overlap": 160,
        "index_version_id": "idx-agent",
        "kb_scope": "agent",
        "scope_ref": "risk-agent",
    }

    snapshots = build_manifest_snapshots(
        workflow=_workflow(),
        agents=[],
        tools=[],
        evaluators=[],
        guardrails=[],
        kb_versions=[agent_scoped],
        kb_assignments=[{"agent_id": "risk-agent", "kb_id": "risk-kb"}],
    )

    assert snapshots["knowledge"] == {"risk-kb": compute_kb_version_snapshot(agent_scoped)}


def test_changing_workflow_edge_changes_manifest_hash() -> None:
    first = compile_workflow_manifest(
        workflow=_workflow(),
        certification={"status": "CERTIFIED"},
        deployment_id="deploy-1",
        snapshots={},
    )
    second = compile_workflow_manifest(
        workflow=_workflow(
            edges=[
                {
                    "edge_id": "lead->risk-risk-only",
                    "from_node_id": "lead",
                    "to_node_id": "risk",
                    "conditions": {"risk": "high"},
                }
            ]
        ),
        certification={"status": "CERTIFIED"},
        deployment_id="deploy-1",
        snapshots={},
    )

    assert first.manifest_hash() != second.manifest_hash()


def test_review_rule_hooks_compile_into_runtime_manifest() -> None:
    workflow = _workflow()
    workflow["review_rules"] = {
        "hooks": [
            {
                "hook_id": "legal-review",
                "display_name": "Legal review",
                "hook_point": "before_workflow",
                "action": "pause_for_review",
                "required_roles": ["legal"],
                "review_message": "Legal approval is required before this workflow runs.",
            }
        ]
    }

    manifest = compile_workflow_manifest(
        workflow=workflow,
        certification={"status": "CERTIFIED"},
        deployment_id="deploy-1",
        snapshots={},
    )

    assert len(manifest.hooks) == 1
    assert manifest.hooks[0].hook_id == "legal-review"
    assert manifest.hooks[0].action == "pause_for_review"
