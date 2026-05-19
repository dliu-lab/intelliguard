from __future__ import annotations

import pytest

from intelliguard.adk.manifest import RuntimeManifest
from intelliguard.runtime.contracts import RuntimeExecutionResult
from intelliguard.runtime.dispatcher import (
    DuplicateActiveRunError,
    InMemoryRunQueue,
    QueueSaturatedError,
    RuntimeRunDispatcher,
    StoreBackedRunQueue,
)
from intelliguard.runtime.worker import RuntimeWorker
from intelliguard.temporal.starter import TemporalStartResult


def _manifest(runtime_type: str = "native") -> dict:
    return RuntimeManifest.model_validate(
        {
            "manifest_version": "1.0",
            "workflow_definition_id": "workflow-1",
            "deployment_id": "deploy-1",
            "environment": "demo",
            "runtime_type": runtime_type,
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
        }
    ).model_dump(mode="json")


class FakeStore:
    def __init__(self) -> None:
        self.deployment = {
            "deployment_id": "deploy-1",
            "workflow_definition_id": "workflow-1",
            "environment": "demo",
            "runtime_type": "native",
            "manifest": _manifest(),
        }
        self.runs: dict[str, dict] = {}
        self.by_idempotency: dict[tuple[str, str], str] = {}
        self.review_items: list[dict] = []
        self.outbox_events: list[dict] = []
        self.counter = 0

    def get_workflow_deployment_revision(self, deployment_id: str) -> dict | None:
        return self.deployment if deployment_id == "deploy-1" else None

    def get_runtime_run_by_idempotency_key(
        self, deployment_id: str, idempotency_key: str
    ) -> dict | None:
        run_id = self.by_idempotency.get((deployment_id, idempotency_key))
        return self.runs.get(run_id) if run_id else None

    def create_workflow_runtime_run(self, payload: dict) -> dict:
        self.counter += 1
        run_id = payload.get("run_id") or f"run-{self.counter}"
        run = {
            "run_id": run_id,
            "workflow_id": None,
            "decision": None,
            "output_payload": {},
            **payload,
        }
        self.runs[run_id] = run
        if payload.get("idempotency_key"):
            self.by_idempotency[(payload["deployment_id"], payload["idempotency_key"])] = run_id
        return run

    def get_workflow_runtime_run(self, run_id: str) -> dict | None:
        return self.runs.get(run_id)

    def update_workflow_runtime_run(self, run_id: str, payload: dict) -> dict:
        self.runs[run_id].update(payload)
        return self.runs[run_id]

    def add_runtime_outbox_event(self, payload: dict) -> dict:
        event = {"outbox_id": f"outbox-{len(self.outbox_events) + 1}", **payload}
        self.outbox_events.append(event)
        return event

    def add_review_item(self, **payload) -> str:
        review_id = f"rev-{len(self.review_items) + 1}"
        self.review_items.append({"review_id": review_id, **payload})
        return review_id

    def claim_next_queued_runtime_run(self) -> dict | None:
        for run in self.runs.values():
            if run["status"] == "QUEUED":
                run["status"] = "RUNNING"
                return run
        return None


class FakeRunner:
    runtime_type = "native"

    def supports(self, runtime_type: str) -> bool:
        return runtime_type == self.runtime_type

    def execute(self, request):
        return RuntimeExecutionResult(
            run_id=request.run_id,
            workflow_id="workflow-run-1",
            decision="ALLOW",
            status="COMPLETED",
            summary=request.user_query,
            output_payload={"ok": True},
        )


class FakeTemporalStarter:
    def __init__(self) -> None:
        self.calls: list[tuple[object, dict]] = []

    def start(self, item, deployment: dict) -> TemporalStartResult:
        self.calls.append((item, deployment))
        return TemporalStartResult(
            workflow_id=f"intelliguard-run-{item.run_id}",
            run_id="temporal-run-1",
            task_queue="intelliguard-runtime",
        )


class FailingTemporalStarter:
    def start(self, item, deployment: dict) -> TemporalStartResult:
        raise RuntimeError("Temporal service unavailable")


def test_dispatcher_creates_runtime_run_and_enqueues_without_executing() -> None:
    store = FakeStore()
    queue = InMemoryRunQueue()
    dispatcher = RuntimeRunDispatcher(store=store, queue=queue)

    run = dispatcher.submit(
        deployment_id="deploy-1",
        user_query="Handle case",
        idempotency_key="case-1",
    )

    assert run["status"] == "QUEUED"
    assert queue.dequeue().run_id == run["run_id"]


def test_dispatcher_rejects_duplicate_active_idempotency_key() -> None:
    store = FakeStore()
    dispatcher = RuntimeRunDispatcher(store=store, queue=InMemoryRunQueue())
    dispatcher.submit(
        deployment_id="deploy-1",
        user_query="Handle case",
        idempotency_key="case-1",
    )

    with pytest.raises(DuplicateActiveRunError):
        dispatcher.submit(
            deployment_id="deploy-1",
            user_query="Handle case again",
            idempotency_key="case-1",
        )


def test_dispatcher_returns_completed_idempotent_run_without_requeue() -> None:
    store = FakeStore()
    queue = InMemoryRunQueue()
    dispatcher = RuntimeRunDispatcher(store=store, queue=queue)
    first = dispatcher.submit(
        deployment_id="deploy-1",
        user_query="Handle case",
        idempotency_key="case-1",
    )
    store.update_workflow_runtime_run(first["run_id"], {"status": "COMPLETED"})
    queue.dequeue()

    second = dispatcher.submit(
        deployment_id="deploy-1",
        user_query="Handle case retry",
        idempotency_key="case-1",
    )

    assert second["run_id"] == first["run_id"]
    assert queue.dequeue() is None


def test_worker_updates_run_status_to_completed() -> None:
    store = FakeStore()
    queue = InMemoryRunQueue()
    dispatcher = RuntimeRunDispatcher(store=store, queue=queue)
    run = dispatcher.submit(deployment_id="deploy-1", user_query="Handle case")
    worker = RuntimeWorker(store=store, queue=queue, runner_factory=lambda _runtime: FakeRunner())

    assert worker.run_once() is True

    updated = store.get_workflow_runtime_run(run["run_id"])
    assert updated["status"] == "COMPLETED"
    assert updated["workflow_id"] == "workflow-run-1"
    assert updated["decision"] == "ALLOW"
    assert updated["output_payload"] == {"ok": True}


def test_worker_starts_temporal_workflow_without_executing_native_runner() -> None:
    store = FakeStore()
    store.deployment["runtime_type"] = "temporal"
    store.deployment["manifest"] = _manifest(runtime_type="temporal")
    queue = InMemoryRunQueue()
    dispatcher = RuntimeRunDispatcher(store=store, queue=queue)
    run = dispatcher.submit(deployment_id="deploy-1", user_query="Handle case")
    temporal_starter = FakeTemporalStarter()

    def native_runner_factory(_runtime_type: str) -> FakeRunner:
        raise AssertionError("Temporal runs should be started through Temporal")

    worker = RuntimeWorker(
        store=store,
        queue=queue,
        runner_factory=native_runner_factory,
        temporal_starter_factory=lambda: temporal_starter,
    )

    assert worker.run_once() is True

    updated = store.get_workflow_runtime_run(run["run_id"])
    assert updated["status"] == "RUNNING"
    assert updated["output_payload"]["temporal"] == {
        "workflow_id": f"intelliguard-run-{run['run_id']}",
        "run_id": "temporal-run-1",
        "task_queue": "intelliguard-runtime",
    }
    assert temporal_starter.calls[0][0].run_id == run["run_id"]
    assert any(event["event_type"] == "run.temporal_started" for event in store.outbox_events)


def test_worker_marks_temporal_run_failed_when_start_fails() -> None:
    store = FakeStore()
    store.deployment["runtime_type"] = "temporal"
    store.deployment["manifest"] = _manifest(runtime_type="temporal")
    queue = InMemoryRunQueue()
    dispatcher = RuntimeRunDispatcher(store=store, queue=queue)
    run = dispatcher.submit(deployment_id="deploy-1", user_query="Handle case")
    worker = RuntimeWorker(
        store=store,
        queue=queue,
        runner_factory=lambda _runtime_type: FakeRunner(),
        temporal_starter_factory=lambda: FailingTemporalStarter(),
    )

    assert worker.run_once() is True

    updated = store.get_workflow_runtime_run(run["run_id"])
    assert updated["status"] == "FAILED"
    assert updated["error"] == "Temporal service unavailable"
    assert any(event["event_type"] == "run.failed" for event in store.outbox_events)


def test_worker_pauses_for_before_workflow_hook_without_executing_runner() -> None:
    store = FakeStore()
    store.deployment["manifest"]["hooks"] = [
        {
            "hook_id": "legal-review",
            "display_name": "Legal review",
            "hook_point": "before_workflow",
            "action": "pause_for_review",
            "conditions": {"environment": "demo"},
            "required_roles": ["legal"],
        }
    ]
    queue = InMemoryRunQueue()
    dispatcher = RuntimeRunDispatcher(store=store, queue=queue)
    run = dispatcher.submit(deployment_id="deploy-1", user_query="Handle case")

    class CountingRunner(FakeRunner):
        calls = 0

        def execute(self, request):
            self.calls += 1
            return super().execute(request)

    runner = CountingRunner()
    worker = RuntimeWorker(store=store, queue=queue, runner_factory=lambda _runtime: runner)

    assert worker.run_once() is True

    updated = store.get_workflow_runtime_run(run["run_id"])
    assert updated["status"] == "REVIEW"
    assert updated["decision"] == "REVIEW"
    assert runner.calls == 0
    assert store.review_items[0]["metadata"]["runtime_hook"]["hook_id"] == "legal-review"
    assert any(event["event_type"] == "hook.paused" for event in store.outbox_events)


def test_store_backed_queue_claims_persisted_queued_run() -> None:
    store = FakeStore()
    dispatcher = RuntimeRunDispatcher(store=store, queue=InMemoryRunQueue())
    run = dispatcher.submit(deployment_id="deploy-1", user_query="Handle case")
    queue = StoreBackedRunQueue(store=store)
    worker = RuntimeWorker(store=store, queue=queue, runner_factory=lambda _runtime: FakeRunner())

    assert worker.run_once() is True

    updated = store.get_workflow_runtime_run(run["run_id"])
    assert updated["status"] == "COMPLETED"


def test_store_backed_queue_reports_unknown_depth_for_api_submission() -> None:
    store = FakeStore()
    queue = StoreBackedRunQueue(store=store)
    dispatcher = RuntimeRunDispatcher(store=store, queue=queue, max_queue_depth=1)

    run = dispatcher.submit(deployment_id="deploy-1", user_query="Handle case")

    assert queue.depth() is None
    assert run["status"] == "QUEUED"


def test_in_memory_queue_enforces_max_depth() -> None:
    store = FakeStore()
    dispatcher = RuntimeRunDispatcher(
        store=store,
        queue=InMemoryRunQueue(),
        max_queue_depth=1,
    )
    dispatcher.submit(deployment_id="deploy-1", user_query="Handle case")

    with pytest.raises(QueueSaturatedError):
        dispatcher.submit(deployment_id="deploy-1", user_query="Handle another case")
