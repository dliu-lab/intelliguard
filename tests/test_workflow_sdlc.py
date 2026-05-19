from __future__ import annotations

from uuid import uuid4

import pytest

from intelliguard.persistence.store import GovernanceStore


def _workflow_payload(workflow_definition_id: str) -> dict:
    return {
        "workflow_definition_id": workflow_definition_id,
        "name": "SDLC Workflow",
        "description": "Workflow SDLC regression test.",
        "owner": "Tests",
        "environment": "demo",
        "domain": "banking",
        "lead_agent_id": "banking-lead-agent",
        "steps": [
            {
                "step_id": "auth_gate",
                "label": "Auth",
                "agent_id": "banking-auth-gate-agent",
                "node_type": "gate_agent",
                "activation_policy": "always",
                "activation_stage": "pre_route",
                "task": "Authenticate account scope.",
            }
        ],
    }


def _workflow_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:8]}"


def test_workflow_definition_defaults_to_draft_version(store: GovernanceStore) -> None:
    workflow_id = _workflow_id("sdlc-default")

    definition = store.upsert_workflow_definition(_workflow_payload(workflow_id))

    assert definition["workflow_root_id"] == workflow_id
    assert definition["version"] == "v1"
    assert definition["version_number"] == 1
    assert definition["lifecycle_status"] == "DRAFT"
    assert definition["previous_workflow_definition_id"] is None
    assert definition["source_workflow_definition_id"] is None
    assert definition["locked_at"] is None
    assert definition["locked_by"] is None

    versions = store.list_workflow_definition_versions(workflow_id)
    assert [version["workflow_definition_id"] for version in versions] == [workflow_id]


def test_workflow_lifecycle_rejects_invalid_transition(store: GovernanceStore) -> None:
    workflow_id = _workflow_id("sdlc-invalid")
    store.upsert_workflow_definition(_workflow_payload(workflow_id))

    with pytest.raises(ValueError, match="Invalid workflow lifecycle transition"):
        store.transition_workflow_lifecycle(workflow_id, "ACTIVE", actor="tester@example.com")


def test_certified_workflow_is_locked_against_in_place_edits(
    store: GovernanceStore,
) -> None:
    workflow_id = _workflow_id("sdlc-lock")
    definition = store.upsert_workflow_definition(_workflow_payload(workflow_id))

    store.transition_workflow_lifecycle(workflow_id, "IN_REVIEW", actor="tester@example.com")
    certified = store.transition_workflow_lifecycle(
        workflow_id, "CERTIFIED", actor="tester@example.com"
    )

    assert certified["lifecycle_status"] == "CERTIFIED"
    assert certified["locked_at"] is not None
    assert certified["locked_by"] == "tester@example.com"

    with pytest.raises(ValueError, match="Locked workflow definitions cannot be edited in place"):
        store.upsert_workflow_definition({**definition, "description": "Edited after cert."})


def test_create_workflow_definition_version_copies_lineage_and_returns_history(
    store: GovernanceStore,
) -> None:
    source_id = _workflow_id("sdlc-source")
    next_id = _workflow_id("sdlc-v2")
    source = store.upsert_workflow_definition(_workflow_payload(source_id))
    store.transition_workflow_lifecycle(source_id, "IN_REVIEW", actor="tester@example.com")
    store.transition_workflow_lifecycle(source_id, "CERTIFIED", actor="tester@example.com")

    next_version = store.create_workflow_definition_version(
        source_workflow_definition_id=source_id,
        new_workflow_definition_id=next_id,
        version="v2",
        change_summary="Add production runtime packaging.",
        created_by="tester@example.com",
    )

    assert next_version["workflow_definition_id"] == next_id
    assert next_version["workflow_root_id"] == source["workflow_root_id"]
    assert next_version["source_workflow_definition_id"] == source_id
    assert next_version["previous_workflow_definition_id"] == source_id
    assert next_version["version"] == "v2"
    assert next_version["version_number"] == 2
    assert next_version["lifecycle_status"] == "DRAFT"
    assert next_version["locked_at"] is None

    versions = store.list_workflow_definition_versions(source["workflow_root_id"])
    assert [version["workflow_definition_id"] for version in versions] == [source_id, next_id]
    assert versions[-1]["change_summary"] == "Add production runtime packaging."
