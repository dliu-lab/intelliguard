from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any

from intelliguard.runtime.dispatcher import RuntimeWorkItem
from intelliguard.temporal.workflows import DurableAgentWorkflow, TemporalWorkflowInput


@dataclass(frozen=True)
class TemporalStartResult:
    workflow_id: str
    run_id: str
    task_queue: str


def temporal_workflow_id_for_run(run_id: str) -> str:
    return f"intelliguard-run-{run_id}"


def temporal_input_for_item(
    item: RuntimeWorkItem,
    *,
    workflow_id: str,
) -> TemporalWorkflowInput:
    return TemporalWorkflowInput(
        run_id=item.run_id,
        deployment_id=item.deployment_id,
        user_query=item.user_query,
        input_payload={
            **(item.input_payload or {}),
            "temporal_workflow_id": workflow_id,
        },
        idempotency_key=item.idempotency_key,
    )


class TemporalWorkflowStarter:
    def __init__(
        self,
        *,
        address: str | None = None,
        task_queue: str | None = None,
    ) -> None:
        self.address = address or os.getenv("TEMPORAL_ADDRESS", "localhost:7233")
        self.task_queue = task_queue or os.getenv("TEMPORAL_TASK_QUEUE", "intelliguard-runtime")

    def start(self, item: RuntimeWorkItem, deployment: dict[str, Any]) -> TemporalStartResult:
        return asyncio.run(self._start(item=item, deployment=deployment))

    async def _start(
        self,
        *,
        item: RuntimeWorkItem,
        deployment: dict[str, Any],
    ) -> TemporalStartResult:
        try:
            from temporalio.client import Client
        except ModuleNotFoundError as exc:  # pragma: no cover - exercised with extra
            raise RuntimeError(
                "Install the temporal extra to start Temporal workflows: "
                "`uv sync --extra temporal`."
            ) from exc

        workflow_id = temporal_workflow_id_for_run(item.run_id)
        payload = temporal_input_for_item(item, workflow_id=workflow_id)
        client = await Client.connect(self.address)
        handle = await client.start_workflow(
            DurableAgentWorkflow.run,
            payload,
            id=workflow_id,
            task_queue=self.task_queue,
            memo={
                "deployment_id": deployment.get("deployment_id"),
                "workflow_definition_id": deployment.get("workflow_definition_id"),
                "environment": deployment.get("environment"),
            },
        )
        temporal_run_id = str(getattr(handle, "first_execution_run_id", "") or "")
        return TemporalStartResult(
            workflow_id=workflow_id,
            run_id=temporal_run_id,
            task_queue=self.task_queue,
        )
