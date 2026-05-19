from __future__ import annotations

from typing import Any

from agent_governance.models import utc_now


class RuntimeEventBus:
    def __init__(self, *, store: Any) -> None:
        self.store = store

    def append(
        self,
        *,
        run_id: str,
        event_type: str,
        payload: dict[str, Any],
        workflow_id: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        return self.store.add_runtime_outbox_event(
            {
                "run_id": run_id,
                "workflow_id": workflow_id,
                "session_id": session_id,
                "event_type": event_type,
                "payload": payload,
                "status": "PENDING",
            }
        )

    def list_since(
        self, *, run_id: str, after_outbox_id: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        return self.store.list_runtime_outbox_events(
            run_id=run_id,
            after_outbox_id=after_outbox_id,
            limit=limit,
        )

    def mark_published(self, outbox_id: str) -> dict[str, Any]:
        return self.store.update_runtime_outbox_event(
            outbox_id,
            {"status": "PUBLISHED", "published_at": utc_now()},
        )

    def mark_failed_attempt(self, outbox_id: str, *, error: str) -> dict[str, Any]:
        return self.store.increment_runtime_outbox_attempt(
            outbox_id,
            status="PUBLISH_FAILED",
            error=error,
        )
