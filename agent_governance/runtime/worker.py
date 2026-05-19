from __future__ import annotations

import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

from agent_governance.adk.manifest import RuntimeManifest
from agent_governance.db import init_db
from agent_governance.runtime.budgets import assert_db_connection_budget
from agent_governance.runtime.contracts import RuntimeExecutionRequest, RuntimeRunner
from agent_governance.runtime.dispatcher import RunQueue, RuntimeWorkItem, StoreBackedRunQueue
from agent_governance.runtime.event_bus import RuntimeEventBus
from agent_governance.runtime.hooks import RuntimeHookContext, RuntimeHookManager
from agent_governance.runtime.native_runner import NativeRuntimeRunner
from agent_governance.settings import load_settings
from agent_governance.store import GovernanceStore
from agent_governance.tools import build_customer_tool_registry


class RuntimeWorker:
    def __init__(
        self,
        *,
        store: Any,
        queue: RunQueue,
        runner_factory: Callable[[str], RuntimeRunner],
        temporal_starter_factory: Callable[[], Any] | None = None,
    ) -> None:
        self.store = store
        self.queue = queue
        self.runner_factory = runner_factory
        self.temporal_starter_factory = temporal_starter_factory
        self.event_bus = RuntimeEventBus(store=store)

    def run_once(self) -> bool:
        item = self.queue.dequeue()
        if not item:
            return False
        run = self.store.get_workflow_runtime_run(item.run_id)
        if not run:
            return False
        deployment = self.store.get_workflow_deployment_revision(item.deployment_id)
        if not deployment:
            self.store.update_workflow_runtime_run(
                item.run_id,
                {"status": "FAILED", "error": "Workflow deployment revision not found"},
            )
            self.event_bus.append(
                run_id=item.run_id,
                event_type="run.failed",
                payload={"error": "Workflow deployment revision not found"},
            )
            return True
        self.store.update_workflow_runtime_run(item.run_id, {"status": "RUNNING"})
        self.event_bus.append(
            run_id=item.run_id,
            event_type="run.started",
            payload={"deployment_id": item.deployment_id, "status": "RUNNING"},
        )
        manifest = RuntimeManifest.model_validate(deployment["manifest"])
        user_query = item.user_query or str(item.input_payload.get("query") or "")
        hook_decision = RuntimeHookManager(store=self.store).evaluate(
            manifest=manifest,
            context=RuntimeHookContext(
                run_id=item.run_id,
                deployment_id=item.deployment_id,
                workflow_definition_id=manifest.workflow_definition_id,
                environment=manifest.environment,
                hook_point="before_workflow",
                user_query=user_query,
                approved_hook_ids=list(item.input_payload.get("approved_hook_ids") or []),
            ),
        )
        if hook_decision.action in {"pause_for_review", "block"}:
            return True
        if manifest.runtime_type == "temporal":
            self._start_temporal_run(item=item, deployment=deployment, run=run)
            return True
        runner = self.runner_factory(manifest.runtime_type)
        try:
            result = runner.execute(
                RuntimeExecutionRequest(
                    run_id=item.run_id,
                    manifest=manifest,
                    user_query=user_query,
                    input_payload=item.input_payload,
                    idempotency_key=item.idempotency_key,
                )
            )
        except Exception as exc:
            self.store.update_workflow_runtime_run(
                item.run_id,
                {"status": "FAILED", "error": str(exc)},
            )
            self.event_bus.append(
                run_id=item.run_id,
                event_type="run.failed",
                payload={"error": str(exc), "status": "FAILED"},
            )
            return True
        self.store.update_workflow_runtime_run(
            item.run_id,
            {
                "status": result.status,
                "decision": result.decision,
                "workflow_id": result.workflow_id,
                "output_payload": result.output_payload,
            },
        )
        self.event_bus.append(
            run_id=item.run_id,
            workflow_id=result.workflow_id,
            event_type="run.completed",
            payload={
                "status": result.status,
                "decision": result.decision,
                "summary": result.summary,
            },
        )
        return True

    def _start_temporal_run(
        self,
        *,
        item: RuntimeWorkItem,
        deployment: dict[str, Any],
        run: dict[str, Any],
    ) -> None:
        from agent_governance.temporal.starter import TemporalWorkflowStarter

        starter = (
            self.temporal_starter_factory()
            if self.temporal_starter_factory
            else TemporalWorkflowStarter()
        )
        try:
            result = starter.start(item, deployment)
        except Exception as exc:
            self.store.update_workflow_runtime_run(
                item.run_id,
                {"status": "FAILED", "error": str(exc)},
            )
            self.event_bus.append(
                run_id=item.run_id,
                event_type="run.failed",
                payload={"error": str(exc), "status": "FAILED"},
            )
            return
        output_payload = dict(run.get("output_payload") or {})
        output_payload["temporal"] = {
            "workflow_id": result.workflow_id,
            "run_id": result.run_id,
            "task_queue": result.task_queue,
        }
        self.store.update_workflow_runtime_run(
            item.run_id,
            {
                "status": "RUNNING",
                "workflow_id": result.workflow_id,
                "output_payload": output_payload,
            },
        )
        self.event_bus.append(
            run_id=item.run_id,
            workflow_id=result.workflow_id,
            event_type="run.temporal_started",
            payload=output_payload["temporal"],
        )


def default_runner_factory(runtime_type: str) -> RuntimeRunner:
    if runtime_type != "native":
        raise ValueError(f"Runtime type {runtime_type!r} is not executable by this worker")
    settings = load_settings()
    return NativeRuntimeRunner(
        database_url=settings.database_url,
        policy_path=settings.policy_path,
        tools=build_customer_tool_registry(),
    )


def main() -> None:
    assert_db_connection_budget(
        pool_size=int(os.getenv("DB_POOL_SIZE", "5")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "10")),
        max_budget=int(os.getenv("MAX_DB_CONNECTION_BUDGET", "50")),
    )
    settings = load_settings()
    if settings.auto_init_db:
        init_db(settings.database_url)
    store = GovernanceStore(settings.database_url)
    queue = StoreBackedRunQueue(store=store)
    worker = RuntimeWorker(store=store, queue=queue, runner_factory=default_runner_factory)
    _start_health_server()
    poll_seconds = float(os.getenv("WORKFLOW_RUNNER_POLL_SECONDS", "2"))
    while True:
        worker.run_once()
        time.sleep(poll_seconds)


def _start_health_server() -> None:
    port = int(os.getenv("WORKFLOW_RUNNER_HEALTH_PORT", "8010"))
    if port <= 0:
        return

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path not in {"/health", "/ready"}:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')

        def log_message(self, _format: str, *_args: Any) -> None:
            return

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()


if __name__ == "__main__":
    main()
