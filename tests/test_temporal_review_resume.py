from __future__ import annotations

from intelliguard.temporal.review import signal_review_resolution


class FakeTemporalClient:
    def __init__(self) -> None:
        self.signals: list[dict] = []

    def signal_workflow(self, *, workflow_id: str, run_id: str | None, signal: str, args: list):
        self.signals.append(
            {
                "workflow_id": workflow_id,
                "run_id": run_id,
                "signal": signal,
                "args": args,
            }
        )


def test_review_approval_sends_temporal_signal_when_metadata_present() -> None:
    client = FakeTemporalClient()
    review = {
        "review_id": "rev-1",
        "metadata": {"temporal_workflow_id": "wf-temporal", "temporal_run_id": "run-temporal"},
    }

    sent = signal_review_resolution(
        review=review,
        status="APPROVED",
        reviewer_email="ops@example.com",
        reviewer_note=None,
        client=client,
    )

    assert sent is True
    assert client.signals == [
        {
            "workflow_id": "wf-temporal",
            "run_id": "run-temporal",
            "signal": "approve_review",
            "args": ["rev-1", "ops@example.com"],
        }
    ]


def test_review_denial_sends_temporal_deny_signal() -> None:
    client = FakeTemporalClient()
    review = {
        "review_id": "rev-1",
        "metadata": {"temporal_workflow_id": "wf-temporal"},
    }

    signal_review_resolution(
        review=review,
        status="DENIED",
        reviewer_email="ops@example.com",
        reviewer_note="risk too high",
        client=client,
    )

    assert client.signals[0]["signal"] == "deny_review"
    assert client.signals[0]["args"] == ["rev-1", "ops@example.com", "risk too high"]


def test_review_without_temporal_metadata_is_noop() -> None:
    client = FakeTemporalClient()

    sent = signal_review_resolution(
        review={"review_id": "rev-1", "metadata": {}},
        status="APPROVED",
        reviewer_email="ops@example.com",
        reviewer_note=None,
        client=client,
    )

    assert sent is False
    assert client.signals == []
