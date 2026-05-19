from __future__ import annotations

import asyncio
import os

from agent_governance.settings import load_settings
from agent_governance.temporal import activities
from agent_governance.temporal.workflows import DurableAgentWorkflow


async def run_worker() -> None:
    try:
        from temporalio.client import Client
        from temporalio.worker import Worker
    except ModuleNotFoundError as exc:  # pragma: no cover - exercised with extra
        raise RuntimeError(
            "Install the temporal extra to run Temporal workers: `uv sync --extra temporal`."
        ) from exc

    settings = load_settings()
    activities.configure_activity_dependencies(settings.database_url)
    client = await Client.connect(os.getenv("TEMPORAL_ADDRESS", "localhost:7233"))
    worker = Worker(
        client,
        task_queue=os.getenv("TEMPORAL_TASK_QUEUE", "intelliguard-runtime"),
        workflows=[DurableAgentWorkflow],
        activities=[
            activities.load_deployment_manifest,
            activities.execute_agent_node,
            activities.invoke_governed_tool,
            activities.run_session_evaluators,
            activities.run_workflow_evaluators,
            activities.record_workflow_event,
            activities.complete_runtime_run,
        ],
    )
    await worker.run()


def main() -> None:
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
