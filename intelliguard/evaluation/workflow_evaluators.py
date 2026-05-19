from __future__ import annotations

import hashlib
import json
from typing import Any

from intelliguard.evaluation.tool_evaluators import CriterionResult
from intelliguard.workflow_graph import LEAD_NODE_ID, NODE_TYPES


def run_workflow_evaluators(
    workflow: dict[str, Any], assignments: dict[str, Any]
) -> list[CriterionResult]:
    return [
        _check_graph_defined(workflow),
        _check_node_types_match_agents(workflow, assignments),
        _check_edges_valid(workflow),
        _check_nodes_certified(workflow, assignments),
        _check_review_or_terminal_path(workflow),
    ]


def compute_workflow_config_hash(workflow: dict[str, Any]) -> str:
    fields = {
        "domain": workflow.get("domain", ""),
        "edges": workflow.get("edges") or [],
        "environment": workflow.get("environment", ""),
        "lead_agent_id": workflow.get("lead_agent_id", ""),
        "nodes": workflow.get("nodes") or [],
        "policy_bindings": workflow.get("policy_bindings") or {},
        "review_rules": workflow.get("review_rules") or {},
        "steps": workflow.get("steps") or [],
    }
    canonical = json.dumps(fields, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _nodes(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = workflow.get("nodes")
    return [node for node in nodes if isinstance(node, dict)] if isinstance(nodes, list) else []


def _edges(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    edges = workflow.get("edges")
    return [edge for edge in edges if isinstance(edge, dict)] if isinstance(edges, list) else []


def _check_graph_defined(workflow: dict[str, Any]) -> CriterionResult:
    nodes = _nodes(workflow)
    lead_nodes = [node for node in nodes if node.get("node_type") == "lead_agent"]
    if not nodes or not lead_nodes:
        return CriterionResult(
            criterion_name="workflow_graph_defined",
            status="FAIL",
            score=0,
            evidence_sentence="Workflow graph must contain nodes and one lead_agent node.",
            input_snapshot={"node_count": len(nodes), "lead_count": len(lead_nodes)},
            observed_value={"node_count": len(nodes), "lead_count": len(lead_nodes)},
            expected_value={"nodes": ">= 1", "lead_agent_nodes": ">= 1"},
        )
    return CriterionResult(
        criterion_name="workflow_graph_defined",
        status="PASS",
        score=100,
        evidence_sentence=f"Workflow graph contains {len(nodes)} node(s) with a lead node.",
        input_snapshot={"node_count": len(nodes), "lead_count": len(lead_nodes)},
    )


def _check_node_types_match_agents(
    workflow: dict[str, Any], assignments: dict[str, Any]
) -> CriterionResult:
    nodes = _nodes(workflow)
    agents = {
        str(agent.get("agent_id")): str(agent.get("agent_type"))
        for agent in assignments.get("agents", [])
        if isinstance(agent, dict)
    }
    mismatches = []
    missing = []
    invalid = []
    for node in nodes:
        node_id = str(node.get("node_id") or "")
        agent_id = str(node.get("agent_id") or "")
        node_type = str(node.get("node_type") or "")
        agent_type = agents.get(agent_id)
        if node_type not in NODE_TYPES:
            invalid.append(f"{node_id}:{node_type}")
        if not agent_type:
            missing.append(agent_id)
        elif node_type != agent_type:
            mismatches.append(f"{node_id}:{node_type}!={agent_type}")
    if missing or mismatches or invalid:
        return CriterionResult(
            criterion_name="node_type_matches_registered_agent",
            status="FAIL",
            score=0,
            evidence_sentence="Workflow nodes must use the registered agent_type for each agent.",
            input_snapshot={"nodes": nodes, "agents": agents},
            observed_value={
                "invalid_node_types": invalid,
                "missing_agents": sorted(set(missing)),
                "mismatches": mismatches,
            },
            expected_value={"node_type": "registered agent_type"},
        )
    return CriterionResult(
        criterion_name="node_type_matches_registered_agent",
        status="PASS",
        score=100,
        evidence_sentence="All workflow node types match registered agent types.",
        input_snapshot={"nodes": nodes, "agents": agents},
    )


def _check_edges_valid(workflow: dict[str, Any]) -> CriterionResult:
    nodes = _nodes(workflow)
    node_ids = {str(node.get("node_id")) for node in nodes if node.get("node_id")}
    edges = _edges(workflow)
    invalid_edges = []
    outgoing_from_lead = 0
    for edge in edges:
        from_node_id = str(edge.get("from_node_id") or "")
        to_node_id = str(edge.get("to_node_id") or "")
        if from_node_id == LEAD_NODE_ID:
            outgoing_from_lead += 1
        if (
            not from_node_id
            or not to_node_id
            or from_node_id == to_node_id
            or from_node_id not in node_ids
            or to_node_id not in node_ids
            or to_node_id == LEAD_NODE_ID
        ):
            invalid_edges.append(f"{from_node_id}->{to_node_id}")
    if invalid_edges or (len(nodes) > 1 and not outgoing_from_lead):
        return CriterionResult(
            criterion_name="handoff_edges_valid",
            status="FAIL",
            score=0,
            evidence_sentence="Workflow graph has invalid handoff edges.",
            input_snapshot={"node_ids": sorted(node_ids), "edges": edges},
            observed_value={
                "invalid_edges": invalid_edges,
                "lead_outgoing_edges": outgoing_from_lead,
            },
            expected_value={"edges": "known nodes, no self loops, no handoff into lead"},
        )
    return CriterionResult(
        criterion_name="handoff_edges_valid",
        status="PASS",
        score=100,
        evidence_sentence=f"Workflow graph contains {len(edges)} valid handoff edge(s).",
        input_snapshot={"node_ids": sorted(node_ids), "edges": edges},
    )


def _check_nodes_certified(
    workflow: dict[str, Any], assignments: dict[str, Any]
) -> CriterionResult:
    node_agent_ids = sorted(
        {
            str(node.get("agent_id"))
            for node in _nodes(workflow)
            if str(node.get("agent_id") or "")
        }
    )
    statuses = {
        str(agent_id): str((cert or {}).get("status") or "DRAFT")
        for agent_id, cert in (assignments.get("agent_certifications") or {}).items()
    }
    uncertified = sorted(
        f"{agent_id}:{statuses.get(agent_id, 'DRAFT')}"
        for agent_id in node_agent_ids
        if statuses.get(agent_id) != "CERTIFIED"
    )
    if uncertified:
        return CriterionResult(
            criterion_name="workflow_nodes_certified",
            status="FAIL",
            score=0,
            evidence_sentence="Workflow references agents that are not certified.",
            input_snapshot={"agent_ids": node_agent_ids, "statuses": statuses},
            observed_value={"uncertified": uncertified},
            expected_value={"all_workflow_agents": "CERTIFIED"},
        )
    return CriterionResult(
        criterion_name="workflow_nodes_certified",
        status="PASS",
        score=100,
        evidence_sentence="All workflow node agents are certified.",
        input_snapshot={"agent_ids": node_agent_ids, "statuses": statuses},
    )


def _check_review_or_terminal_path(workflow: dict[str, Any]) -> CriterionResult:
    nodes = _nodes(workflow)
    review_rules = workflow.get("review_rules") if isinstance(workflow.get("review_rules"), dict) else {}
    governance_nodes = [
        node
        for node in nodes
        if node.get("node_type") in {"review_agent", "approval_agent", "terminal_agent"}
    ]
    if not governance_nodes and not review_rules:
        return CriterionResult(
            criterion_name="review_or_terminal_path_defined",
            status="REVIEW",
            score=60,
            evidence_sentence="Workflow has no review, approval, terminal node, or review rules.",
            input_snapshot={"nodes": nodes, "review_rules": review_rules},
            observed_value={"governance_node_count": 0, "review_rule_count": 0},
            expected_value={"governance_exit": "review, approval, terminal node, or review rule"},
        )
    return CriterionResult(
        criterion_name="review_or_terminal_path_defined",
        status="PASS",
        score=100,
        evidence_sentence="Workflow declares a governance review or terminal path.",
        input_snapshot={"nodes": nodes, "review_rules": review_rules},
    )
