from __future__ import annotations

from uuid import uuid4

from intelliguard.persistence.store import GovernanceStore


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:8]}"


def _workflow_payload(workflow_definition_id: str) -> dict:
    return {
        "workflow_definition_id": workflow_definition_id,
        "name": "Deployment Workflow",
        "description": "Deployment revision regression test.",
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


def _deployment_payload(
    deployment_id: str,
    workflow_definition_id: str,
    manifest_hash: str = "manifest_hash_v1",
) -> dict:
    return {
        "deployment_id": deployment_id,
        "workflow_definition_id": workflow_definition_id,
        "environment": "demo",
        "version": "v1",
        "status": "PACKAGED",
        "manifest": {
            "workflow_definition_id": workflow_definition_id,
            "runtime_type": "native",
            "nodes": [{"node_id": "lead", "agent_id": "banking-lead-agent"}],
        },
        "manifest_hash": manifest_hash,
        "graph_version_hash": "graph_hash_v1",
        "agent_config_hashes": {"banking-lead-agent": "agent_hash_v1"},
        "tool_config_hashes": {"get_customer_profile": "tool_hash_v1"},
        "evaluator_config_hashes": {"workflow_graph_baseline": "eval_hash_v1"},
        "policy_hashes": {"default": "policy_hash_v1"},
        "kb_version_hashes": {"banking": "kb_hash_v1"},
        "runtime_type": "native",
        "runtime_limits": {"timeout_seconds": 60, "max_steps": 20},
        "created_by": "tester@example.com",
    }


def test_deployment_revision_activation_and_retirement_keep_manifest_immutable(
    store: GovernanceStore,
) -> None:
    workflow_id = _id("deploy-workflow")
    deployment_id = _id("deploy-revision")
    store.upsert_workflow_definition(_workflow_payload(workflow_id))

    created = store.create_workflow_deployment_revision(
        _deployment_payload(deployment_id, workflow_id)
    )
    active = store.activate_workflow_deployment(deployment_id)

    assert active["deployment_id"] == deployment_id
    assert active["status"] == "ACTIVE"
    assert active["activated_at"] is not None
    assert active["manifest_hash"] == created["manifest_hash"]
    assert active["manifest"] == created["manifest"]

    fetched = store.get_workflow_deployment_revision(deployment_id)
    assert fetched["manifest_hash"] == "manifest_hash_v1"

    active_lookup = store.get_active_workflow_deployment(workflow_id, "demo")
    assert active_lookup["deployment_id"] == deployment_id

    retired = store.retire_workflow_deployment(deployment_id)
    assert retired["status"] == "RETIRED"
    assert retired["retired_at"] is not None
    assert retired["manifest_hash"] == "manifest_hash_v1"
    assert store.get_active_workflow_deployment(workflow_id, "demo") is None


def test_activating_new_revision_retires_previous_active_revision(
    store: GovernanceStore,
) -> None:
    workflow_id = _id("deploy-roll-forward")
    first_id = _id("deploy-r1")
    second_id = _id("deploy-r2")
    store.upsert_workflow_definition(_workflow_payload(workflow_id))
    store.create_workflow_deployment_revision(_deployment_payload(first_id, workflow_id))
    store.create_workflow_deployment_revision(
        _deployment_payload(second_id, workflow_id, manifest_hash="manifest_hash_v2")
    )

    store.activate_workflow_deployment(first_id)
    second = store.activate_workflow_deployment(second_id)

    assert second["status"] == "ACTIVE"
    assert store.get_workflow_deployment_revision(first_id)["status"] == "RETIRED"
    assert store.get_active_workflow_deployment(workflow_id, "demo")["deployment_id"] == second_id


def test_runtime_run_update_and_outbox_event_are_persisted(store: GovernanceStore) -> None:
    workflow_id = _id("runtime-workflow")
    deployment_id = _id("runtime-deploy")
    run_id = _id("runtime-run")
    store.upsert_workflow_definition(_workflow_payload(workflow_id))
    store.create_workflow_deployment_revision(_deployment_payload(deployment_id, workflow_id))

    created = store.create_workflow_runtime_run(
        {
            "run_id": run_id,
            "deployment_id": deployment_id,
            "workflow_definition_id": workflow_id,
            "environment": "demo",
            "status": "PENDING",
            "idempotency_key": "case-123",
            "input_payload": {"customer_id": "C123"},
            "runtime_type": "native",
        }
    )
    updated = store.update_workflow_runtime_run(
        run_id,
        {
            "status": "COMPLETED",
            "decision": "APPROVED",
            "output_payload": {"summary": "done"},
        },
    )
    event = store.add_runtime_outbox_event(
        {
            "run_id": run_id,
            "workflow_id": updated["workflow_id"],
            "event_type": "runtime.completed",
            "payload": {"decision": "APPROVED"},
        }
    )

    assert created["status"] == "PENDING"
    assert updated["status"] == "COMPLETED"
    assert updated["output_payload"] == {"summary": "done"}
    assert event["status"] == "PENDING"
    assert event["payload"] == {"decision": "APPROVED"}
