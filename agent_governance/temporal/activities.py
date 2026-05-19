from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from agent_governance.adk.manifest import RuntimeManifest
from agent_governance.runtime.contracts import RuntimeExecutionRequest
from agent_governance.runtime.native_runner import NativeRuntimeRunner
from agent_governance.settings import load_settings
from agent_governance.store import GovernanceStore
from agent_governance.tools import build_customer_tool_registry

try:  # pragma: no cover - optional dependency path
    from temporalio import activity
except ModuleNotFoundError:  # pragma: no cover - base install path
    activity = None


ACTIVITY_NAMES = (
    "load_deployment_manifest",
    "execute_agent_node",
    "invoke_governed_tool",
    "run_session_evaluators",
    "run_workflow_evaluators",
    "record_workflow_event",
    "complete_runtime_run",
)


@dataclass(frozen=True)
class TemporalActivityDependencies:
    database_url: str
    store: GovernanceStore


_dependencies: TemporalActivityDependencies | None = None


def _activity_defn(fn):
    if activity is None:
        return fn
    return activity.defn(name=fn.__name__)(fn)


def configure_activity_dependencies(database_url: str) -> TemporalActivityDependencies:
    global _dependencies
    if _dependencies is None or _dependencies.database_url != database_url:
        _dependencies = TemporalActivityDependencies(
            database_url=database_url,
            store=GovernanceStore(database_url),
        )
    return _dependencies


def activity_dependencies() -> TemporalActivityDependencies:
    if _dependencies is None:
        raise RuntimeError("Temporal activity dependencies are not configured.")
    return _dependencies


@_activity_defn
async def load_deployment_manifest(deployment_id: str) -> dict[str, Any]:
    deployment = activity_dependencies().store.get_workflow_deployment_revision(deployment_id)
    if not deployment:
        raise ValueError("Workflow deployment revision not found")
    return deployment["manifest"]


@_activity_defn
async def execute_agent_node(
    request_payload: dict[str, Any],
    manifest_payload: dict[str, Any],
) -> dict[str, Any]:
    deps = activity_dependencies()
    settings = load_settings()
    manifest = RuntimeManifest.model_validate(manifest_payload)
    runner = NativeRuntimeRunner(
        database_url=deps.database_url,
        policy_path=settings.policy_path,
        tools=build_customer_tool_registry(),
    )
    result = runner.execute(
        RuntimeExecutionRequest(
            run_id=request_payload["run_id"],
            manifest=manifest,
            user_query=request_payload["user_query"],
            input_payload=request_payload.get("input_payload") or {},
            idempotency_key=request_payload.get("idempotency_key"),
        )
    )
    return asdict(result)


@_activity_defn
async def invoke_governed_tool(payload: dict[str, Any]) -> dict[str, Any]:
    from agent_governance.runtime.tool_gateway import ToolGateway, ToolGatewayRequest
    from agent_governance.runner import GovernedToolRunner

    deps = activity_dependencies()
    settings = load_settings()
    tools = build_customer_tool_registry()
    gateway = ToolGateway(
        lambda agent_id: GovernedToolRunner(
            agent_id=agent_id,
            database_url=deps.database_url,
            policy_path=settings.policy_path,
            tools=tools,
        )
    )
    request = ToolGatewayRequest(
        agent_id=payload["agent_id"],
        session_id=payload["session_id"],
        user_query=payload["user_query"],
        tool_name=payload["tool_name"],
        tool_args=payload.get("tool_args") or {},
        idempotency_key=payload.get("idempotency_key"),
    )
    result = gateway.invoke(request)
    return {
        "decision": result.decision,
        "risk_score": result.risk_score,
        "risk_types": result.risk_types,
        "result": result.result,
        "review_id": result.review_id,
        "audit_event_id": result.audit_event_id,
    }


@_activity_defn
async def run_session_evaluators(payload: dict[str, Any]) -> dict[str, Any]:
    return {"status": "SKIPPED", "scope": "session", "input": payload}


@_activity_defn
async def run_workflow_evaluators(payload: dict[str, Any]) -> dict[str, Any]:
    return {"status": "SKIPPED", "scope": "workflow", "input": payload}


@_activity_defn
async def record_workflow_event(payload: dict[str, Any]) -> dict[str, Any]:
    deps = activity_dependencies()
    event = deps.store.add_runtime_outbox_event(payload)
    return event


@_activity_defn
async def complete_runtime_run(run_id: str, result_payload: dict[str, Any]) -> dict[str, Any]:
    deps = activity_dependencies()
    return deps.store.update_workflow_runtime_run(
        run_id,
        {
            "status": result_payload.get("status") or "COMPLETED",
            "decision": result_payload.get("decision"),
            "workflow_id": result_payload.get("workflow_id"),
            "output_payload": result_payload.get("output_payload") or result_payload,
        },
    )
