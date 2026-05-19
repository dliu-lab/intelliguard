from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4


ACTIVE_RUN_STATUSES = {"PENDING", "QUEUED", "RUNNING"}
TERMINAL_RUN_STATUSES = {"COMPLETED", "FAILED", "BLOCKED", "REVIEW", "CANCELLED"}


class DuplicateActiveRunError(ValueError):
    pass


class QueueSaturatedError(ValueError):
    pass


@dataclass(frozen=True)
class RuntimeWorkItem:
    run_id: str
    deployment_id: str
    user_query: str
    input_payload: dict[str, Any] = field(default_factory=dict)
    idempotency_key: str | None = None


class RunQueue(Protocol):
    def enqueue(self, item: RuntimeWorkItem) -> None:
        raise NotImplementedError

    def dequeue(self) -> RuntimeWorkItem | None:
        raise NotImplementedError

    def depth(self) -> int | None:
        return None


class InMemoryRunQueue:
    def __init__(self) -> None:
        self._items: deque[RuntimeWorkItem] = deque()

    def enqueue(self, item: RuntimeWorkItem) -> None:
        self._items.append(item)

    def dequeue(self) -> RuntimeWorkItem | None:
        if not self._items:
            return None
        return self._items.popleft()

    def depth(self) -> int:
        return len(self._items)


class StoreBackedRunQueue:
    def __init__(self, *, store: Any) -> None:
        self.store = store

    def enqueue(self, item: RuntimeWorkItem) -> None:
        # The durable queue is the workflow_runtime_runs table itself. The dispatcher
        # has already persisted the QUEUED run, so enqueue is intentionally a no-op.
        return None

    def dequeue(self) -> RuntimeWorkItem | None:
        run = self.store.claim_next_queued_runtime_run()
        if not run:
            return None
        input_payload = run.get("input_payload") or {}
        return RuntimeWorkItem(
            run_id=run["run_id"],
            deployment_id=run["deployment_id"],
            user_query=str(input_payload.get("query") or ""),
            input_payload=input_payload,
            idempotency_key=run.get("idempotency_key"),
        )

    def depth(self) -> int | None:
        return None


class RuntimeRunDispatcher:
    def __init__(
        self,
        *,
        store: Any,
        queue: RunQueue,
        max_queue_depth: int | None = None,
    ) -> None:
        self.store = store
        self.queue = queue
        self.max_queue_depth = max_queue_depth

    def submit(
        self,
        *,
        deployment_id: str,
        user_query: str,
        idempotency_key: str | None = None,
        input_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        deployment = self.store.get_workflow_deployment_revision(deployment_id)
        if not deployment:
            raise ValueError("Workflow deployment revision not found")
        queue_depth = self.queue.depth()
        if (
            self.max_queue_depth is not None
            and queue_depth is not None
            and queue_depth >= self.max_queue_depth
        ):
            raise QueueSaturatedError("Runtime queue is saturated")
        if idempotency_key:
            existing = self.store.get_runtime_run_by_idempotency_key(deployment_id, idempotency_key)
            if existing and existing.get("status") in ACTIVE_RUN_STATUSES:
                raise DuplicateActiveRunError(
                    "A runtime run is already active for this deployment idempotency key"
                )
            if existing and existing.get("status") in TERMINAL_RUN_STATUSES:
                return existing
        payload = {
            "run_id": f"run_{uuid4().hex[:16]}",
            "deployment_id": deployment["deployment_id"],
            "workflow_definition_id": deployment["workflow_definition_id"],
            "environment": deployment["environment"],
            "status": "QUEUED",
            "idempotency_key": idempotency_key,
            "input_payload": {"query": user_query, **(input_payload or {})},
            "runtime_type": deployment["runtime_type"],
        }
        run = self.store.create_workflow_runtime_run(payload)
        self.queue.enqueue(
            RuntimeWorkItem(
                run_id=run["run_id"],
                deployment_id=deployment["deployment_id"],
                user_query=user_query,
                input_payload=payload["input_payload"],
                idempotency_key=idempotency_key,
            )
        )
        return run
