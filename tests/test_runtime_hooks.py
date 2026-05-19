from __future__ import annotations

from agent_governance.adk.manifest import RuntimeManifest
from agent_governance.runtime.hooks import (
    RuntimeHookContext,
    RuntimeHookManager,
    RuntimeReviewResumeService,
)


def _manifest() -> RuntimeManifest:
    return RuntimeManifest.model_validate(
        {
            "manifest_version": "1.0",
            "workflow_definition_id": "workflow-1",
            "deployment_id": "deploy-1",
            "environment": "production",
            "runtime_type": "native",
            "graph_version_hash": "graph-hash",
            "nodes": [{"node_id": "lead", "agent_id": "agent-1", "node_type": "lead_agent"}],
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
            "hooks": [
                {
                    "hook_id": "legal-review",
                    "display_name": "Legal review",
                    "hook_point": "before_workflow",
                    "action": "pause_for_review",
                    "conditions": {"environment": "production"},
                    "required_roles": ["legal"],
                    "review_message": "Legal approval is required before this workflow runs.",
                }
            ],
        }
    )


class FakeHookStore:
    def __init__(self) -> None:
        self.runs = {
            "run-1": {
                "run_id": "run-1",
                "deployment_id": "deploy-1",
                "workflow_definition_id": "workflow-1",
                "environment": "production",
                "status": "RUNNING",
                "input_payload": {"query": "Review a regulated case"},
                "output_payload": {},
            }
        }
        self.review_items: list[dict] = []
        self.outbox_events: list[dict] = []

    def add_review_item(self, **payload):
        review_id = f"rev-{len(self.review_items) + 1}"
        self.review_items.append({"review_id": review_id, **payload})
        return review_id

    def update_workflow_runtime_run(self, run_id: str, payload: dict) -> dict:
        self.runs[run_id].update(payload)
        return self.runs[run_id]

    def add_runtime_outbox_event(self, payload: dict) -> dict:
        event = {"outbox_id": f"outbox-{len(self.outbox_events) + 1}", **payload}
        self.outbox_events.append(event)
        return event

    def get_workflow_runtime_run(self, run_id: str) -> dict | None:
        return self.runs.get(run_id)


def _context(*, approved_hook_ids: list[str] | None = None) -> RuntimeHookContext:
    return RuntimeHookContext(
        run_id="run-1",
        deployment_id="deploy-1",
        workflow_definition_id="workflow-1",
        environment="production",
        hook_point="before_workflow",
        user_query="Review a regulated case",
        approved_hook_ids=approved_hook_ids or [],
    )


def test_pause_hook_creates_review_item_and_marks_run_for_review() -> None:
    store = FakeHookStore()
    manager = RuntimeHookManager(store=store)

    decision = manager.evaluate(manifest=_manifest(), context=_context())

    assert decision.action == "pause_for_review"
    assert decision.review_id == "rev-1"
    assert store.runs["run-1"]["status"] == "REVIEW"
    assert store.runs["run-1"]["decision"] == "REVIEW"
    assert store.review_items[0]["metadata"]["runtime_hook"]["hook_id"] == "legal-review"
    assert store.outbox_events[0]["event_type"] == "hook.paused"


def test_approved_hook_is_not_repeated_on_resume() -> None:
    store = FakeHookStore()
    manager = RuntimeHookManager(store=store)

    decision = manager.evaluate(
        manifest=_manifest(),
        context=_context(approved_hook_ids=["legal-review"]),
    )

    assert decision.action == "continue"
    assert store.review_items == []
    assert store.outbox_events == []


def test_runtime_review_approval_requeues_run_with_approved_hook() -> None:
    store = FakeHookStore()
    review = {
        "review_id": "rev-1",
        "metadata": {
            "runtime_hook": {
                "run_id": "run-1",
                "hook_id": "legal-review",
                "resume_strategy": "queue_replay",
            }
        },
    }

    result = RuntimeReviewResumeService(store=store).resolve_review(
        review=review,
        status="APPROVED",
        reviewer_email="reviewer@example.com",
        reviewer_note=None,
    )

    assert result.applied is True
    assert store.runs["run-1"]["status"] == "QUEUED"
    assert store.runs["run-1"]["input_payload"]["approved_hook_ids"] == ["legal-review"]
    assert store.outbox_events[0]["event_type"] == "hook.approved"


def test_runtime_review_denial_blocks_run() -> None:
    store = FakeHookStore()
    review = {
        "review_id": "rev-1",
        "metadata": {
            "runtime_hook": {
                "run_id": "run-1",
                "hook_id": "legal-review",
                "resume_strategy": "queue_replay",
            }
        },
    }

    result = RuntimeReviewResumeService(store=store).resolve_review(
        review=review,
        status="DENIED",
        reviewer_email="reviewer@example.com",
        reviewer_note="Not approved",
    )

    assert result.applied is True
    assert store.runs["run-1"]["status"] == "BLOCKED"
    assert store.runs["run-1"]["decision"] == "DENY"
    assert store.outbox_events[0]["event_type"] == "hook.denied"
