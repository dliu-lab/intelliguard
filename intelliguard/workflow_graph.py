from __future__ import annotations

import hashlib
import json
from typing import Any


NODE_TYPES = {
    "gate_agent",
    "lead_agent",
    "task_agent",
    "review_agent",
    "approval_agent",
    "terminal_agent",
}

ACTIVATION_POLICIES = {"always", "on_risk", "conditional", "human_required"}
ACTIVATION_STAGES = {"pre_tool", "post_tool", "pre_route", "routed", "final_review"}

LEGACY_AGENT_TYPE_MAP = {
    "lead_orchestrator": "lead_agent",
    "sub_agent": "task_agent",
    "specialist_agent": "task_agent",
    "support_assistant": "task_agent",
    "custom_agent": "task_agent",
    "cli_agent": "task_agent",
}

LEAD_NODE_ID = "lead"


class WorkflowGraphError(ValueError):
    pass


def normalize_agent_type(agent_type: str | None) -> str:
    value = (agent_type or "").strip()
    return LEGACY_AGENT_TYPE_MAP.get(value, value)


def validate_agent_type(agent_type: str | None) -> str:
    normalized = normalize_agent_type(agent_type)
    if normalized not in NODE_TYPES:
        raise WorkflowGraphError(
            f"Unsupported agent_type '{agent_type}'. Expected one of {sorted(NODE_TYPES)}."
        )
    return normalized


def workflow_graph_hash(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> str:
    payload = json.dumps(
        {"nodes": nodes, "edges": edges},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def normalize_workflow_graph(
    payload: dict[str, Any], agent_types_by_id: dict[str, str]
) -> dict[str, Any]:
    raw_nodes = payload.get("nodes")
    raw_edges = payload.get("edges")
    steps = [step for step in payload.get("steps", []) if isinstance(step, dict)]
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}

    nodes = _normalize_nodes(
        raw_nodes=raw_nodes,
        steps=steps,
        lead_agent_id=str(payload["lead_agent_id"]),
        agent_types_by_id=agent_types_by_id,
    )
    edges = _normalize_edges(raw_edges=raw_edges, metadata=metadata, steps=steps, nodes=nodes)
    graph_version_hash = str(
        payload.get("graph_version_hash") or workflow_graph_hash(nodes=nodes, edges=edges)
    )

    return {
        "nodes": nodes,
        "edges": edges,
        "graph_version_hash": graph_version_hash,
        "policy_bindings": payload.get("policy_bindings")
        or metadata.get("policy_bindings")
        or {},
        "review_rules": payload.get("review_rules") or metadata.get("review_rules") or {},
    }


def _normalize_nodes(
    raw_nodes: Any,
    steps: list[dict[str, Any]],
    lead_agent_id: str,
    agent_types_by_id: dict[str, str],
) -> list[dict[str, Any]]:
    nodes_input = raw_nodes if isinstance(raw_nodes, list) and raw_nodes else None
    if nodes_input is None:
        nodes_input = [_lead_node(lead_agent_id), *[_node_from_step(step) for step in steps]]

    seen_node_ids: set[str] = set()
    nodes: list[dict[str, Any]] = []

    for raw_node in nodes_input:
        if not isinstance(raw_node, dict):
            continue

        node_id = str(raw_node.get("node_id") or raw_node.get("step_id") or "").strip()
        agent_id = str(raw_node.get("agent_id") or "").strip()
        if not node_id or not agent_id:
            raise WorkflowGraphError("Every workflow node requires node_id and agent_id.")
        if node_id in seen_node_ids:
            raise WorkflowGraphError(f"Duplicate workflow node_id '{node_id}'.")

        registered_type = validate_agent_type(agent_types_by_id.get(agent_id))
        node_type = validate_agent_type(str(raw_node.get("node_type") or registered_type))
        if node_type != registered_type:
            raise WorkflowGraphError(
                f"Workflow node '{node_id}' has node_type '{node_type}' but registered agent "
                f"'{agent_id}' is '{registered_type}'."
            )

        activation_policy = _enum_value(
            raw_node.get("activation_policy"),
            ACTIVATION_POLICIES,
            _default_activation_policy(node_type),
            "activation_policy",
        )
        activation_stage = _enum_value(
            raw_node.get("activation_stage"),
            ACTIVATION_STAGES,
            _default_activation_stage(node_type),
            "activation_stage",
        )

        seen_node_ids.add(node_id)
        nodes.append(
            {
                **raw_node,
                "node_id": node_id,
                "agent_id": agent_id,
                "node_type": node_type,
                "activation_policy": activation_policy,
                "activation_stage": activation_stage,
                "capabilities": _list_value(raw_node.get("capabilities")),
                "allowed_tools": _list_value(raw_node.get("allowed_tools")),
                "data_scope": raw_node.get("data_scope")
                if isinstance(raw_node.get("data_scope"), dict)
                else {},
                "side_effect_level": str(raw_node.get("side_effect_level") or "read_only"),
            }
        )

    if not any(node["node_type"] == "lead_agent" for node in nodes):
        raise WorkflowGraphError("Workflow graph requires one lead_agent node.")

    return nodes


def _normalize_edges(
    raw_edges: Any,
    metadata: dict[str, Any],
    steps: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    node_ids = {node["node_id"] for node in nodes}
    edges_input = raw_edges if isinstance(raw_edges, list) and raw_edges else None

    if edges_input is None and isinstance(metadata.get("visual_connections"), list):
        edges_input = [
            {
                "edge_id": f"{item.get('from')}->{item.get('to')}",
                "from_node_id": item.get("from"),
                "to_node_id": item.get("to"),
                "conditions": item.get("conditions") or {},
            }
            for item in metadata["visual_connections"]
            if isinstance(item, dict)
        ]

    if edges_input is None:
        edges_input = [
            {
                "edge_id": f"{LEAD_NODE_ID}->{step.get('step_id') or step.get('agent_id')}",
                "from_node_id": LEAD_NODE_ID,
                "to_node_id": step.get("step_id") or step.get("agent_id"),
                "conditions": {},
            }
            for step in steps
        ]

    edges: list[dict[str, Any]] = []
    seen_edge_ids: set[str] = set()

    for raw_edge in edges_input:
        if not isinstance(raw_edge, dict):
            continue

        from_node_id = str(raw_edge.get("from_node_id") or raw_edge.get("from") or "").strip()
        to_node_id = str(raw_edge.get("to_node_id") or raw_edge.get("to") or "").strip()
        if not from_node_id or not to_node_id or from_node_id == to_node_id:
            raise WorkflowGraphError("Workflow edges require distinct from_node_id and to_node_id.")
        if from_node_id not in node_ids or to_node_id not in node_ids:
            raise WorkflowGraphError(
                f"Workflow edge '{from_node_id}->{to_node_id}' references an unknown node."
            )
        if to_node_id == LEAD_NODE_ID:
            raise WorkflowGraphError("Workflow edges cannot hand off back to the lead node.")

        edge_id = str(raw_edge.get("edge_id") or f"{from_node_id}->{to_node_id}")
        if edge_id in seen_edge_ids:
            continue

        seen_edge_ids.add(edge_id)
        edges.append(
            {
                **raw_edge,
                "edge_id": edge_id,
                "from_node_id": from_node_id,
                "to_node_id": to_node_id,
                "conditions": raw_edge.get("conditions")
                if isinstance(raw_edge.get("conditions"), dict)
                else {},
            }
        )

    return edges


def _lead_node(lead_agent_id: str) -> dict[str, Any]:
    return {
        "node_id": LEAD_NODE_ID,
        "agent_id": lead_agent_id,
        "node_type": "lead_agent",
        "activation_policy": "always",
        "activation_stage": "pre_route",
        "capabilities": ["route_request", "coordinate_workflow"],
        "allowed_tools": [],
        "data_scope": {},
        "side_effect_level": "none",
    }


def _node_from_step(step: dict[str, Any]) -> dict[str, Any]:
    return {
        **step,
        "node_id": step.get("step_id") or step.get("agent_id"),
        "node_type": step.get("node_type"),
        "activation_policy": step.get("activation_policy") or "conditional",
        "activation_stage": step.get("activation_stage") or "routed",
        "capabilities": step.get("capabilities") or [step.get("task") or step.get("label") or ""],
        "allowed_tools": [step["tool_name"]] if step.get("tool_name") else [],
        "data_scope": step.get("data_scope") or {},
        "side_effect_level": step.get("side_effect_level") or "read_only",
    }


def _default_activation_policy(node_type: str) -> str:
    if node_type in {"lead_agent", "gate_agent"}:
        return "always"
    if node_type in {"review_agent", "approval_agent"}:
        return "on_risk" if node_type == "review_agent" else "human_required"
    return "conditional"


def _default_activation_stage(node_type: str) -> str:
    if node_type == "lead_agent":
        return "pre_route"
    if node_type == "gate_agent":
        return "pre_route"
    if node_type in {"review_agent", "approval_agent", "terminal_agent"}:
        return "final_review"
    return "routed"


def _enum_value(value: Any, allowed: set[str], default: str, label: str) -> str:
    candidate = str(value or default)
    if candidate not in allowed:
        raise WorkflowGraphError(
            f"Invalid {label} '{candidate}'. Expected one of {sorted(allowed)}."
        )
    return candidate


def _list_value(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item)]
