from __future__ import annotations

from agent_governance.runtime.event_bus import RuntimeEventBus


class FakeStore:
    def __init__(self) -> None:
        self.events: list[dict] = []

    def add_runtime_outbox_event(self, payload: dict) -> dict:
        event = {
            "outbox_id": payload.get("outbox_id") or f"outbox-{len(self.events) + 1}",
            "status": payload.get("status") or "PENDING",
            "publish_attempts": payload.get("publish_attempts") or 0,
            **payload,
        }
        self.events.append(event)
        return event

    def list_runtime_outbox_events(
        self,
        *,
        run_id: str,
        after_outbox_id: str | None = None,
        limit: int = 100,
    ):
        rows = [event for event in self.events if event["run_id"] == run_id]
        if after_outbox_id:
            ids = [event["outbox_id"] for event in rows]
            if after_outbox_id in ids:
                rows = rows[ids.index(after_outbox_id) + 1 :]
        return rows[:limit]

    def update_runtime_outbox_event(self, outbox_id: str, payload: dict) -> dict:
        for event in self.events:
            if event["outbox_id"] == outbox_id:
                event.update(payload)
                return event
        raise ValueError("missing event")

    def increment_runtime_outbox_attempt(self, outbox_id: str, *, status: str, error: str) -> dict:
        for event in self.events:
            if event["outbox_id"] == outbox_id:
                event["publish_attempts"] += 1
                event["status"] = status
                event["payload"] = {**event.get("payload", {}), "publish_error": error}
                return event
        raise ValueError("missing event")


def test_event_bus_appends_and_replays_from_cursor() -> None:
    store = FakeStore()
    bus = RuntimeEventBus(store=store)
    first = bus.append(run_id="run-1", event_type="run.started", payload={"status": "RUNNING"})
    second = bus.append(run_id="run-1", event_type="run.completed", payload={"status": "COMPLETED"})

    replay = bus.list_since(run_id="run-1", after_outbox_id=first["outbox_id"])

    assert replay == [second]


def test_event_bus_tracks_publish_success_and_failure_attempts() -> None:
    store = FakeStore()
    bus = RuntimeEventBus(store=store)
    event = bus.append(run_id="run-1", event_type="run.started", payload={})

    failed = dict(bus.mark_failed_attempt(event["outbox_id"], error="network"))

    assert failed["status"] == "PUBLISH_FAILED"
    assert failed["publish_attempts"] == 1
    assert failed["payload"]["publish_error"] == "network"

    published = bus.mark_published(event["outbox_id"])

    assert published["status"] == "PUBLISHED"
