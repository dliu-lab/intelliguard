from __future__ import annotations

from typing import Any

from intelliguard.api import services as api_services


class FakeStore:
    def find_agent_identity(self, agent_id: str) -> dict[str, Any] | None:
        if agent_id == "lead-agent":
            return {"agent_id": "lead-agent", "config_hash": "agent-hash"}
        return None

    def list_agent_kb_assignments(self, agent_id: str) -> list[dict[str, Any]]:
        return []

    def list_knowledge_bases(self, environment: str | None = None) -> list[dict[str, Any]]:
        return []

    def list_tool_records(self, environment: str | None = None) -> list[dict[str, Any]]:
        return []

    def list_guardrail_policies(self, environment: str | None = None) -> list[dict[str, Any]]:
        return []

    def list_agent_evaluator_assignments(self, agent_id: str) -> list[dict[str, Any]]:
        if agent_id == "lead-agent":
            return [
                {
                    "agent_id": "lead-agent",
                    "evaluator_id": "assigned-workflow-evaluator",
                    "trigger": "after_workflow",
                    "config": {},
                }
            ]
        return []

    def get_evaluator_template(self, evaluator_id: str) -> dict[str, Any] | None:
        if evaluator_id == "assigned-workflow-evaluator":
            return {"evaluator_id": evaluator_id, "config_hash": "assigned-eval-hash"}
        if evaluator_id == "unassigned-evaluator":
            return {"evaluator_id": evaluator_id, "config_hash": "unassigned-eval-hash"}
        return None

    def list_evaluator_templates(self) -> list[dict[str, Any]]:
        return [
            {
                "evaluator_id": "assigned-workflow-evaluator",
                "config_hash": "assigned-eval-hash",
            },
            {"evaluator_id": "unassigned-evaluator", "config_hash": "unassigned-eval-hash"},
        ]


def test_workflow_manifest_snapshots_only_include_assigned_evaluators() -> None:
    snapshots = api_services.workflow_manifest_snapshots(
        {
            "workflow_definition_id": "workflow-1",
            "environment": "staging",
            "domain": "support",
            "nodes": [
                {
                    "node_id": "lead",
                    "agent_id": "lead-agent",
                    "node_type": "lead_agent",
                    "allowed_tools": [],
                }
            ],
        },
        FakeStore(),
    )

    assert snapshots["evaluators"] == {"assigned-workflow-evaluator": "assigned-eval-hash"}
