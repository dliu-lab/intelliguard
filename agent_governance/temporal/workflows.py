from __future__ import annotations

from datetime import timedelta
from typing import Any

from pydantic import BaseModel, Field

try:  # pragma: no cover - optional dependency path
    from temporalio import workflow
except ModuleNotFoundError:  # pragma: no cover - base install path
    workflow = None


def _identity_decorator(value):
    return value


class TemporalWorkflowInput(BaseModel):
    run_id: str
    deployment_id: str
    user_query: str
    input_payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = None


workflow_defn = workflow.defn if workflow else _identity_decorator
workflow_run = workflow.run if workflow else _identity_decorator
workflow_signal = workflow.signal if workflow else _identity_decorator


@workflow_defn
class DurableAgentWorkflow:
    def __init__(self) -> None:
        self.review_decision: dict[str, Any] | None = None

    @workflow_run
    async def run(self, payload: TemporalWorkflowInput) -> dict[str, Any]:
        if workflow is None:  # pragma: no cover - exercised with extra
            raise RuntimeError(
                "Install the temporal extra to execute Temporal workflows: "
                "`uv sync --extra temporal`."
            )

        manifest = await workflow.execute_activity(
            "load_deployment_manifest",
            args=[payload.deployment_id],
            start_to_close_timeout=timedelta(seconds=30),
        )
        node_result = await workflow.execute_activity(
            "execute_agent_node",
            args=[payload.model_dump(mode="json"), manifest],
            start_to_close_timeout=timedelta(seconds=300),
        )
        if node_result.get("decision") == "REVIEW":
            await workflow.wait_condition(lambda: self.review_decision is not None)
            if self.review_decision and self.review_decision.get("status") == "DENIED":
                node_result["status"] = "BLOCKED"
        await workflow.execute_activity(
            "complete_runtime_run",
            args=[payload.run_id, node_result],
            start_to_close_timeout=timedelta(seconds=30),
        )
        return node_result

    @workflow_signal
    async def approve_review(self, review_id: str, reviewer_email: str) -> None:
        self.review_decision = {
            "review_id": review_id,
            "status": "APPROVED",
            "reviewer_email": reviewer_email,
        }

    @workflow_signal
    async def deny_review(self, review_id: str, reviewer_email: str, reason: str) -> None:
        self.review_decision = {
            "review_id": review_id,
            "status": "DENIED",
            "reviewer_email": reviewer_email,
            "reason": reason,
        }
