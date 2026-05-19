from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from intelliguard.adk.manifest import RuntimeManifest
from intelliguard.runtime.isolation import (
    determine_worker_pool,
    validate_manifest_has_no_secret_values,
)
from intelliguard.workflow_graph import workflow_graph_hash


class ManifestCompileError(ValueError):
    pass


@dataclass(frozen=True)
class ManifestCompileOptions:
    runtime_type: str = "native"
    timeout_seconds: int = 300
    max_parallel_nodes: int = 4
    max_tool_calls: int = 30
    max_llm_calls: int = 20
    max_cost_usd: float = 5.0


def compute_kb_version_snapshot(version: dict[str, Any]) -> str:
    payload = {
        "version_id": version["version_id"],
        "kb_id": version["kb_id"],
        "version": version["version"],
        "status": version["status"],
        "profile": version.get("profile") or {},
        "file_manifest": version.get("file_manifest") or [],
        "retrieval_mode": version.get("retrieval_mode"),
        "vector_backend": version.get("vector_backend"),
        "embedding_model": version.get("embedding_model"),
        "chunking_strategy": version.get("chunking_strategy"),
        "chunk_size": version.get("chunk_size"),
        "chunk_overlap": version.get("chunk_overlap"),
        "index_version_id": version.get("index_version_id"),
    }
    return _hash_payload(payload)


def build_manifest_snapshots(
    *,
    workflow: dict[str, Any],
    agents: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    evaluators: list[dict[str, Any]],
    guardrails: list[dict[str, Any]],
    kb_versions: list[dict[str, Any]],
    kb_assignments: list[dict[str, Any]],
) -> dict[str, dict[str, str]]:
    workflow_agent_ids = {
        str(node.get("agent_id"))
        for node in workflow.get("nodes", [])
        if isinstance(node, dict) and node.get("agent_id")
    }
    allowed_tool_names = {
        str(tool_name)
        for node in workflow.get("nodes", [])
        if isinstance(node, dict)
        for tool_name in node.get("allowed_tools", [])
    }
    snapshots = {
        "agents": {
            str(agent["agent_id"]): _snapshot_value(agent)
            for agent in agents
            if agent.get("agent_id") in workflow_agent_ids
        },
        "tools": {
            str(_tool_name(tool)): _snapshot_value(tool)
            for tool in tools
            if _tool_name(tool)
            and (not allowed_tool_names or _tool_name(tool) in allowed_tool_names)
        },
        "evaluators": {
            str(evaluator["evaluator_id"]): _snapshot_value(evaluator)
            for evaluator in evaluators
            if evaluator.get("evaluator_id")
        },
        "policies": {
            str(policy["policy_id"]): _snapshot_value(policy)
            for policy in guardrails
            if policy.get("policy_id")
        },
        "knowledge": {},
    }
    assigned_kbs = {
        str(assignment.get("kb_id")): str(assignment.get("agent_id"))
        for assignment in kb_assignments
        if assignment.get("kb_id") and assignment.get("agent_id") in workflow_agent_ids
    }
    for version in kb_versions:
        if version.get("status") != "published":
            continue
        kb_id = str(version.get("kb_id") or "")
        if not kb_id:
            continue
        if _kb_version_matches_workflow(version, workflow, assigned_kbs):
            snapshots["knowledge"][kb_id] = compute_kb_version_snapshot(version)
    return snapshots


def compile_workflow_manifest(
    *,
    workflow: dict[str, Any],
    certification: dict[str, Any],
    deployment_id: str,
    snapshots: dict[str, dict[str, str]],
    options: ManifestCompileOptions | None = None,
) -> RuntimeManifest:
    options = options or ManifestCompileOptions()
    if certification.get("status") != "CERTIFIED":
        raise ManifestCompileError("Workflow must be certified before deployment.")
    nodes = workflow.get("nodes") or []
    edges = workflow.get("edges") or []
    metadata = {
        "source": "intelliguard-control-plane",
        **(workflow.get("metadata") or {}),
    }
    if workflow.get("environment") != "production":
        metadata.setdefault("data_classification", "internal")
    review_rules = (
        workflow.get("review_rules") if isinstance(workflow.get("review_rules"), dict) else {}
    )
    manifest = RuntimeManifest.model_validate(
        {
            "manifest_version": "1.0",
            "workflow_definition_id": workflow["workflow_definition_id"],
            "deployment_id": deployment_id,
            "environment": workflow["environment"],
            "runtime_type": options.runtime_type,
            "graph_version_hash": workflow.get("graph_version_hash")
            or workflow_graph_hash(nodes, edges),
            "nodes": nodes,
            "edges": edges,
            "agent_snapshots": snapshots.get("agents", {}),
            "policy_snapshots": snapshots.get("policies", {}),
            "tool_snapshots": snapshots.get("tools", {}),
            "evaluator_snapshots": snapshots.get("evaluators", {}),
            "guardrail_snapshots": snapshots.get("guardrails", {}),
            "knowledge_snapshots": snapshots.get("knowledge", {}),
            "runtime_limits": {
                "timeout_seconds": options.timeout_seconds,
                "max_parallel_nodes": options.max_parallel_nodes,
                "max_tool_calls": options.max_tool_calls,
                "max_llm_calls": options.max_llm_calls,
                "max_cost_usd": options.max_cost_usd,
            },
            "hooks": review_rules.get("hooks") or [],
            "metadata": metadata,
        }
    )
    validate_manifest_has_no_secret_values(manifest)
    manifest.metadata["worker_pool"] = determine_worker_pool(manifest)
    return manifest


def _snapshot_value(payload: dict[str, Any]) -> str:
    certification = payload.get("certification")
    if isinstance(certification, dict) and certification.get("config_hash"):
        return str(certification["config_hash"])
    for key in ("config_hash", "artifact_digest", "content_hash", "manifest_hash"):
        if payload.get(key):
            return str(payload[key])
    return _hash_payload(payload)


def _tool_name(tool: dict[str, Any]) -> str | None:
    value = tool.get("tool_name") or tool.get("name") or tool.get("tool_id")
    return str(value) if value else None


def _kb_version_matches_workflow(
    version: dict[str, Any],
    workflow: dict[str, Any],
    assigned_kbs: dict[str, str],
) -> bool:
    kb_id = str(version.get("kb_id") or "")
    kb_scope = str(version.get("kb_scope") or "").lower()
    scope_ref = str(version.get("scope_ref") or "")
    profile = version.get("profile") if isinstance(version.get("profile"), dict) else {}
    workflow_domain = str(workflow.get("domain") or "")
    workflow_environment = str(workflow.get("environment") or "")
    profile_domain = str(profile.get("domain") or "")
    profile_environment = str(profile.get("environment") or "")

    if kb_scope == "agent":
        return kb_id in assigned_kbs and assigned_kbs[kb_id] == scope_ref
    if kb_scope == "domain":
        if scope_ref:
            return scope_ref == workflow_domain
        return profile_domain == workflow_domain and profile_environment == workflow_environment
    if kb_scope == "shared":
        return scope_ref in {"", "shared", workflow_environment} or (
            profile_environment == workflow_environment and not profile_domain
        )
    return kb_id in assigned_kbs


def _hash_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:24]
