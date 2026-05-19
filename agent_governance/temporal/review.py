from __future__ import annotations

import asyncio
import os
from typing import Any, Protocol


class ReviewSignalClient(Protocol):
    def signal_workflow(
        self,
        *,
        workflow_id: str,
        run_id: str | None,
        signal: str,
        args: list[Any],
    ) -> Any:
        raise NotImplementedError


class TemporalReviewSignalClient:
    def __init__(self, address: str | None = None) -> None:
        self.address = address or os.getenv("TEMPORAL_ADDRESS", "localhost:7233")

    def signal_workflow(
        self,
        *,
        workflow_id: str,
        run_id: str | None,
        signal: str,
        args: list[Any],
    ) -> None:
        asyncio.run(
            self._signal_workflow(
                workflow_id=workflow_id,
                run_id=run_id,
                signal=signal,
                args=args,
            )
        )

    async def _signal_workflow(
        self,
        *,
        workflow_id: str,
        run_id: str | None,
        signal: str,
        args: list[Any],
    ) -> None:
        try:
            from temporalio.client import Client
        except ModuleNotFoundError as exc:  # pragma: no cover - exercised with extra
            raise RuntimeError(
                "Install the temporal extra to signal Temporal workflows: "
                "`uv sync --extra temporal`."
            ) from exc

        client = await Client.connect(self.address)
        handle = client.get_workflow_handle(workflow_id, run_id=run_id)
        await handle.signal(signal, *args)


def signal_review_resolution(
    *,
    review: dict[str, Any],
    status: str,
    reviewer_email: str,
    reviewer_note: str | None,
    client: ReviewSignalClient | None = None,
) -> bool:
    metadata = review.get("metadata") or {}
    workflow_id = metadata.get("temporal_workflow_id")
    if not workflow_id:
        return False
    signal_client = client or TemporalReviewSignalClient()
    if status == "APPROVED":
        signal_client.signal_workflow(
            workflow_id=workflow_id,
            run_id=metadata.get("temporal_run_id"),
            signal="approve_review",
            args=[review["review_id"], reviewer_email],
        )
        return True
    if status == "DENIED":
        signal_client.signal_workflow(
            workflow_id=workflow_id,
            run_id=metadata.get("temporal_run_id"),
            signal="deny_review",
            args=[review["review_id"], reviewer_email, reviewer_note or ""],
        )
        return True
    return False
