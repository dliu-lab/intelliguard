from __future__ import annotations

from intelliguard.evaluation.workflow_evaluators import (
    compute_workflow_config_hash,
    run_workflow_evaluators,
)


def _workflow() -> dict:
    return {
        "workflow_definition_id": "banking-account-inquiry",
        "domain": "banking",
        "environment": "demo",
        "lead_agent_id": "lead-agent",
        "nodes": [
            {
                "node_id": "lead",
                "agent_id": "lead-agent",
                "node_type": "lead_agent",
                "activation_policy": "always",
                "activation_stage": "pre_route",
            },
            {
                "node_id": "inquiry",
                "agent_id": "task-agent",
                "node_type": "task_agent",
                "activation_policy": "conditional",
                "activation_stage": "routed",
            },
            {
                "node_id": "review",
                "agent_id": "review-agent",
                "node_type": "review_agent",
                "activation_policy": "on_risk",
                "activation_stage": "final_review",
            },
        ],
        "edges": [
            {"edge_id": "lead->inquiry", "from_node_id": "lead", "to_node_id": "inquiry"},
            {
                "edge_id": "inquiry->review",
                "from_node_id": "inquiry",
                "to_node_id": "review",
            },
        ],
        "policy_bindings": {},
        "review_rules": {},
        "steps": [],
    }


def _assignments() -> dict:
    return {
        "agents": [
            {"agent_id": "lead-agent", "agent_type": "lead_agent"},
            {"agent_id": "task-agent", "agent_type": "task_agent"},
            {"agent_id": "review-agent", "agent_type": "review_agent"},
        ],
        "agent_certifications": {
            "lead-agent": {"status": "CERTIFIED"},
            "task-agent": {"status": "CERTIFIED"},
            "review-agent": {"status": "CERTIFIED"},
        },
    }


def test_workflow_evaluators_pass_for_valid_certified_graph() -> None:
    results = run_workflow_evaluators(_workflow(), _assignments())

    assert {result.status for result in results} == {"PASS"}


def test_uncertified_node_agent_fails() -> None:
    assignments = _assignments()
    assignments["agent_certifications"]["task-agent"] = {"status": "FAILED"}

    results = run_workflow_evaluators(_workflow(), assignments)
    statuses = {result.criterion_name: result.status for result in results}

    assert statuses["workflow_nodes_certified"] == "FAIL"


def test_node_type_mismatch_fails() -> None:
    workflow = _workflow()
    workflow["nodes"][1]["node_type"] = "review_agent"

    results = run_workflow_evaluators(workflow, _assignments())
    statuses = {result.criterion_name: result.status for result in results}

    assert statuses["node_type_matches_registered_agent"] == "FAIL"


def test_workflow_config_hash_changes_when_edges_change() -> None:
    workflow = _workflow()
    first_hash = compute_workflow_config_hash(workflow)
    workflow["edges"].append(
        {"edge_id": "lead->review", "from_node_id": "lead", "to_node_id": "review"}
    )

    assert compute_workflow_config_hash(workflow) != first_hash
