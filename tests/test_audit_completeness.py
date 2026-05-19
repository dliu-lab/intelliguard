from __future__ import annotations

from intelliguard.runtime.audit_completeness import check_runtime_audit_completeness


class FakeStore:
    def __init__(self) -> None:
        self.run = {
            "run_id": "run-1",
            "deployment_id": "deploy-1",
            "workflow_id": "wf-1",
            "decision": "ALLOW",
            "output_payload": {
                "lead_session_id": "sess-1",
                "tool_calls": [{"tool_name": "lookup", "decision": "ALLOW"}],
                "evaluator_results": [{"evaluator_id": "eval-1", "passed": True}],
            },
        }
        self.deployment = {
            "deployment_id": "deploy-1",
            "manifest_hash": "manifest-hash",
            "policy_hashes": {"policy-1": "policy-hash"},
            "evaluator_config_hashes": {"eval-1": "eval-hash"},
        }
        self.events = [{"outbox_id": "outbox-1", "event_type": "run.completed"}]

    def get_workflow_runtime_run(self, run_id: str) -> dict | None:
        return self.run if run_id == "run-1" else None

    def get_workflow_deployment_revision(self, deployment_id: str) -> dict | None:
        return self.deployment if deployment_id == "deploy-1" else None

    def list_runtime_outbox_events(self, *, run_id: str, after_outbox_id=None, limit=100):
        return self.events if run_id == "run-1" else []


def test_audit_completeness_passes_for_complete_run() -> None:
    result = check_runtime_audit_completeness(FakeStore(), "run-1")

    assert result.passed is True
    assert result.findings == []


def test_audit_completeness_reports_missing_required_evidence() -> None:
    store = FakeStore()
    store.run["workflow_id"] = None
    store.run["output_payload"] = {"tool_calls": [{"tool_name": "lookup"}]}
    store.events = []

    result = check_runtime_audit_completeness(store, "run-1")

    assert result.passed is False
    assert "workflow_id is missing" in result.findings
    assert "lead_session_id is missing" in result.findings
    assert "runtime events are missing" in result.findings
    assert "tool call lookup is missing a decision" in result.findings
