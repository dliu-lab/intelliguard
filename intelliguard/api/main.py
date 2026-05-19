from __future__ import annotations

import json
import os
import time
from typing import Any, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from intelliguard.api import access_policy
from intelliguard.api import dependencies as api_dependencies
from intelliguard.api import schemas as api_schemas
from intelliguard.api import services as api_services
from intelliguard.domain.customer_support.agent import run_customer_support_agent
from intelliguard.persistence.db import init_db
from intelliguard.knowledge.retrieval import KnowledgeRetrievalService, RetrievedDoc as RetrievedDoc
from intelliguard.knowledge.indexing import (
    KnowledgeIngestionService,
    OllamaEmbeddingProvider,
)
from intelliguard.knowledge.storage import KnowledgeFileStorage, is_image_file
from intelliguard.persistence.models import utc_now
from intelliguard.workflows.customer_support import run_customer_support_workflow
from intelliguard.governance.policy import load_policy, policy_to_dict
from intelliguard.governance.runner import GovernedToolRunner
from intelliguard.settings import DEFAULT_KB_UPLOAD_DIR, load_settings
from intelliguard.persistence.store import GovernanceStore
from intelliguard.telemetry import (
    current_trace_id,
    instrument_fastapi,
    telemetry_status,
    trace_kb_operation,
)
from intelliguard.domain.customer_support.tools import build_customer_tool_registry
from intelliguard.workflows.graph import WorkflowGraphError


settings = load_settings()
registry = build_customer_tool_registry()
store = GovernanceStore(settings.database_url)


def reject_vector_image_uploads(retrieval_mode: str, files: list[UploadFile]) -> None:
    if retrieval_mode != "vector":
        return
    if any(is_image_file(upload.filename or "", upload.content_type or "") for upload in files):
        raise HTTPException(
            status_code=400,
            detail="Image files can only be attached to File KBs. Vector KBs support text, Markdown, PDF, DOCX, JSON, HTML, YAML, and source code until OCR indexing is available.",
        )


def build_runner(agent_id: str) -> GovernedToolRunner:
    return api_services.build_runner(
        agent_id=agent_id,
        database_url=settings.database_url,
        policy_path=settings.policy_path,
        tools=registry,
    )


app = FastAPI(
    title="IntelliGuard API",
    version="0.1.0",
    description="Governance API with agent, tool, workflow, and evaluator registration surfaces.",
)
instrument_fastapi(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


bearer_token = api_dependencies.bearer_token
require_super_admin = api_dependencies.require_super_admin
visible_environment = api_dependencies.visible_environment


def current_user(token: str = Depends(bearer_token)) -> dict[str, Any]:
    return api_dependencies.current_user_for_token(token, store)


def require_environment_access(
    user: dict[str, Any], environment: str | None, permission: str = "read"
) -> None:
    api_dependencies.require_environment_access(user, environment, store, permission)


def require_agent_identity_for_access(
    agent_id: str, user: dict[str, Any], permission: str = "read"
) -> dict[str, Any]:
    return api_dependencies.require_agent_identity_for_access(agent_id, user, store, permission)


def _ensure_tool_attachable_to_agent(agent: dict[str, Any], tool: dict[str, Any]) -> None:
    access_policy.ensure_tool_attachable_to_agent(agent, tool)


def _ensure_kb_attachable_to_agent(agent: dict[str, Any], kb: dict[str, Any]) -> None:
    access_policy.ensure_kb_attachable_to_agent(agent, kb, store)


@app.on_event("startup")
def startup() -> None:
    if settings.auto_init_db:
        init_db(settings.database_url)
    if settings.seed_demo_data:
        store.seed_demo_data()
    api_services.sync_configured_tools_into_runtime(store, registry)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/telemetry/status")
def get_telemetry_status() -> dict[str, Any]:
    return telemetry_status(default_service_name="intelliguard-api").to_dict()


@app.get("/v1/auth/bootstrap-status")
def bootstrap_status() -> dict[str, Any]:
    requires_initial_admin = not store.has_password_users()
    return {
        "requires_initial_admin": requires_initial_admin,
        "signup_roles": [
            "Governance Lead",
            "Governance Reviewer",
            "Support Operations Manager",
            "Agent Developer",
        ]
        if requires_initial_admin
        else ["Governance Reviewer", "Support Operations Manager", "Agent Developer"],
    }


@app.post("/v1/auth/register")
def register(request: api_schemas.RegisterRequest) -> dict[str, Any]:
    try:
        user = store.register_user(
            email=request.email,
            password=request.password,
            display_name=request.display_name,
            role=request.role,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    user, token = store.authenticate_user(email=request.email, password=request.password)
    return {"user": user, "token": token}


@app.post("/v1/auth/login")
def login(request: api_schemas.LoginRequest) -> dict[str, Any]:
    try:
        user, token = store.authenticate_user(email=request.email, password=request.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    if request.role and request.role != user["role"]:
        store.revoke_user_session(token)
        raise HTTPException(status_code=401, detail="Selected role does not match this account")
    return {"user": user, "token": token}


@app.post("/v1/auth/logout")
def logout(token: str = Depends(bearer_token)) -> dict[str, bool]:
    store.revoke_user_session(token)
    return {"ok": True}


@app.get("/v1/users")
def users(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    require_super_admin(user)
    return store.list_users()


@app.post("/v1/users")
def create_user(
    request: api_schemas.UserCreateRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    require_super_admin(user)
    try:
        return store.create_user(
            email=request.email,
            password=request.password,
            display_name=request.display_name,
            role=request.role,
            is_super_admin=request.is_super_admin,
            environment_access=[item.model_dump() for item in request.environment_access],
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/v1/tools")
def tools(
    environment: str | None = None,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    return store.list_tool_records(environment=visible_environment(environment, user))


@app.get("/v1/policies")
def policies(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {
        "policy_path": settings.policy_path,
        "environment_scope": "global",
        "policy": policy_to_dict(load_policy(settings.policy_path)),
    }


@app.get("/v1/agents")
def agents(
    environment: str | None = None, user: dict[str, Any] = Depends(current_user)
) -> list[dict[str, Any]]:
    return store.list_agents(environment=visible_environment(environment, user))


@app.get("/v1/environments")
def environments(user: dict[str, Any] = Depends(current_user)) -> list[str]:
    if user["is_super_admin"]:
        return store.list_environments()
    return user["allowed_environments"]


@app.get("/v1/me")
def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return user


@app.get("/v1/agents/{agent_id}")
def agent_identity(agent_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    identity = store.find_agent_identity(agent_id)
    if not identity:
        raise HTTPException(status_code=404, detail="Agent not found")
    require_environment_access(user, identity.get("environment"), "read")
    return identity


@app.post("/v1/agents")
def create_agent(
    request: api_schemas.AgentCreateRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    require_environment_access(user, request.environment, "agent:create")
    return store.upsert_agent_identity(request.model_dump())


@app.delete("/v1/agents/{agent_id}")
def delete_agent(agent_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, bool]:
    require_super_admin(user)
    deleted = store.delete_agent_identity(agent_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"ok": True}


@app.post("/v1/agents/{agent_id}/evaluate")
def evaluate_agent(agent_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    from time import monotonic

    from intelliguard.evaluation.agent_evaluators import (
        compute_agent_config_hash,
        run_agent_evaluators,
    )
    from intelliguard.evaluation.certification import (
        CertificationError,
        decide_certification,
        validate_transition,
    )

    agent = store.find_agent_identity(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    require_environment_access(user, agent.get("environment"), "agent:create")

    assignments = api_services.agent_assignments_for_evaluation(agent, store)
    config_hash = compute_agent_config_hash(agent, assignments)
    cert = store.get_agent_certification(agent_id) or store.create_agent_certification(
        agent_id, config_hash
    )
    if cert["status"] != "EVALUATING":
        try:
            validate_transition(cert["status"], "EVALUATING")
        except CertificationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    store.update_agent_certification(
        agent_id,
        {"status": "EVALUATING", "config_hash": config_hash, "invalidation_reason": None},
    )
    run = store.create_evaluation_run(
        {
            "target_type": "agent",
            "target_id": agent_id,
            "config_hash": config_hash,
            "triggered_by": user["email"],
        }
    )

    started_at = monotonic()
    criterion_results = run_agent_evaluators(agent, assignments)
    duration_ms = int((monotonic() - started_at) * 1000)
    result_records = [
        result.to_record(evaluator_id="agent_baseline") for result in criterion_results
    ]
    store.add_evaluation_criterion_results(run["run_id"], result_records)

    decision = decide_certification(result_records)
    criteria_passed = sum(1 for result in criterion_results if result.status == "PASS")
    store.complete_evaluation_run(
        run["run_id"],
        overall_result=decision.status,
        criteria_total=len(criterion_results),
        criteria_passed=criteria_passed,
        duration_ms=duration_ms,
    )
    store.update_agent_certification(
        agent_id,
        {
            "status": decision.status,
            "config_hash": config_hash,
            "invalidation_reason": None,
            "last_evaluation_run_id": run["run_id"],
            "certified_by": user["email"] if decision.status == "CERTIFIED" else None,
            "certified_at": utc_now() if decision.status == "CERTIFIED" else None,
            "failure_reason": decision.failure_reason,
        },
    )

    return {
        "run_id": run["run_id"],
        "agent_id": agent_id,
        "overall_result": decision.status,
        "criteria_total": len(criterion_results),
        "criteria_passed": criteria_passed,
        "duration_ms": duration_ms,
        "criterion_results": result_records,
    }


@app.get("/v1/agents/{agent_id}/certification")
def get_agent_certification_status(
    agent_id: str, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    agent = store.find_agent_identity(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    require_environment_access(user, agent.get("environment"), "read")
    cert = store.get_agent_certification(agent_id)
    if not cert:
        raise HTTPException(status_code=404, detail="No certification record for this agent")
    return cert


@app.get("/v1/agents/{agent_id}/evaluation-runs")
def list_agent_evaluation_runs(
    agent_id: str, user: dict[str, Any] = Depends(current_user)
) -> list[dict[str, Any]]:
    agent = store.find_agent_identity(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    require_environment_access(user, agent.get("environment"), "read")
    return store.list_evaluation_runs_for_agent(agent_id)


@app.post("/v1/tools")
def create_tool(
    request: api_schemas.ToolCreateRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    require_environment_access(user, request.environment, "tool:create")
    try:
        tool = store.create_tool_record(api_services.tool_payload(request))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if request.tool_name not in registry.names():
        registry.register_configured_tool(tool)
    return tool


@app.put("/v1/tools/{tool_id}")
def update_tool(
    tool_id: str,
    request: api_schemas.ToolCreateRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    existing = store.get_tool_record(tool_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Tool not found")
    require_environment_access(user, existing.get("environment"), "tool:create")
    require_environment_access(user, request.environment, "tool:create")
    try:
        tool = store.upsert_tool_record({"tool_id": tool_id, **api_services.tool_payload(request)})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if request.tool_name not in registry.names():
        registry.register_configured_tool(tool)
    return tool


@app.get("/v1/service-connectors")
def list_service_connectors(
    environment: str | None = None,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    return store.list_service_connectors(environment=visible_environment(environment, user))


@app.post("/v1/service-connectors")
def create_service_connector(
    request: api_schemas.ServiceConnectorRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_environment_access(user, request.environment, "tool:create")
    try:
        return store.upsert_service_connector(request.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/service-connectors/{connector_id}")
def get_service_connector(
    connector_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    connector = store.get_service_connector(connector_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Service connector not found")
    require_environment_access(user, connector.get("environment"), "read")
    return connector


@app.post("/v1/service-connectors/{connector_id}/test")
def test_service_connector(
    connector_id: str,
    request: api_schemas.ServiceConnectorTestRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    from intelliguard.adapters.http_service import ConnectorPolicyError, HttpServiceConnector

    connector = store.get_service_connector(connector_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Service connector not found")
    require_environment_access(user, connector.get("environment"), "tool:create")
    if connector.get("connector_type") != "http":
        raise HTTPException(status_code=400, detail="Only HTTP connector tests are supported")
    try:
        result = HttpServiceConnector(connector).execute(request.operation, request.payload)
    except ConnectorPolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "ok": result.ok,
        "status_code": result.status_code,
        "data": result.data,
        "error": result.error,
        "metadata": result.metadata,
    }


@app.get("/v1/scenario-suites")
def list_scenario_suites(
    environment: str | None = None,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    return store.list_scenario_suites(environment=visible_environment(environment, user))


@app.post("/v1/scenario-suites")
def create_scenario_suite(
    request: api_schemas.ScenarioSuiteRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_environment_access(user, request.environment, "workflow:deploy")
    payload = request.model_dump()
    payload["pass_threshold"] = request.pass_threshold
    return store.upsert_scenario_suite(payload)


@app.post("/v1/scenario-suites/{suite_id}/runs")
def run_scenario_suite(
    suite_id: str,
    request: api_schemas.ScenarioRunRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    from intelliguard.runtime.native_runner import NativeRuntimeRunner
    from intelliguard.runtime.scenario_evaluator import ScenarioSuiteEvaluator

    suite = store.get_scenario_suite(suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Scenario suite not found")
    deployment = store.get_workflow_deployment_revision(request.deployment_id)
    if not deployment:
        raise HTTPException(status_code=404, detail="Workflow deployment not found")
    require_environment_access(user, deployment["environment"], "workflow:deploy")
    if deployment["workflow_definition_id"] != suite["workflow_definition_id"]:
        raise HTTPException(
            status_code=400,
            detail="Scenario suite does not target this workflow deployment.",
        )
    runner = NativeRuntimeRunner(
        database_url=settings.database_url,
        policy_path=settings.policy_path,
        tools=registry,
    )
    try:
        return ScenarioSuiteEvaluator(store=store, runner=runner).run_suite(
            suite=suite,
            deployment=deployment,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/scenario-runs/{scenario_run_id}")
def get_scenario_run(
    scenario_run_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    run = store.get_scenario_run(scenario_run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Scenario run not found")
    require_environment_access(user, run["environment"], "read")
    return run


@app.get("/v1/tools/{tool_id}")
def get_tool(tool_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    tool = store.get_tool_record(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    require_environment_access(user, tool.get("environment"), "read")
    return tool


@app.post("/v1/tools/{tool_id}/evaluate")
def evaluate_tool(tool_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    from time import monotonic

    from intelliguard.evaluation.certification import (
        CertificationError,
        decide_certification,
        validate_transition,
    )
    from intelliguard.evaluation.tool_evaluators import run_tool_evaluators

    tool = store.get_tool_record(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    require_environment_access(user, tool.get("environment"), "tool:create")

    cert = store.get_tool_certification(tool_id)
    current_status = cert["status"] if cert else "DRAFT"
    if current_status != "EVALUATING":
        try:
            validate_transition(current_status, "EVALUATING")
        except CertificationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    store.update_tool_certification(tool_id, {"status": "EVALUATING"})

    run = store.create_evaluation_run(
        {
            "target_type": "tool",
            "target_id": tool_id,
            "config_hash": tool["config_hash"],
            "artifact_digest": tool.get("artifact_digest"),
            "triggered_by": user["email"],
        }
    )
    started_at = monotonic()
    criterion_results = run_tool_evaluators(tool)
    duration_ms = int((monotonic() - started_at) * 1000)
    result_records = [result.to_record() for result in criterion_results]
    store.add_evaluation_criterion_results(run["run_id"], result_records)

    decision = decide_certification(result_records)
    criteria_passed = sum(1 for result in criterion_results if result.status == "PASS")
    store.complete_evaluation_run(
        run["run_id"],
        overall_result=decision.status,
        criteria_total=len(criterion_results),
        criteria_passed=criteria_passed,
        duration_ms=duration_ms,
    )
    store.update_tool_certification(
        tool_id,
        {
            "status": decision.status,
            "config_hash": tool["config_hash"],
            "artifact_digest": tool.get("artifact_digest"),
            "last_evaluation_run_id": run["run_id"],
            "certified_by": user["email"] if decision.status == "CERTIFIED" else None,
            "certified_at": utc_now() if decision.status == "CERTIFIED" else None,
            "failure_reason": decision.failure_reason,
        },
    )

    return {
        "run_id": run["run_id"],
        "tool_id": tool_id,
        "overall_result": decision.status,
        "criteria_total": len(criterion_results),
        "criteria_passed": criteria_passed,
        "duration_ms": duration_ms,
        "criterion_results": result_records,
    }


@app.get("/v1/tools/{tool_id}/certification")
def get_tool_certification(
    tool_id: str, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    tool = store.get_tool_record(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    require_environment_access(user, tool.get("environment"), "read")
    cert = store.get_tool_certification(tool_id)
    if not cert:
        raise HTTPException(status_code=404, detail="Certification record not found")
    return cert


@app.get("/v1/tools/{tool_id}/evaluation-runs")
def list_tool_evaluation_runs(
    tool_id: str, user: dict[str, Any] = Depends(current_user)
) -> list[dict[str, Any]]:
    tool = store.get_tool_record(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    require_environment_access(user, tool.get("environment"), "read")
    return store.list_evaluation_runs_for_tool(tool_id)


@app.get("/v1/evaluation-runs/{run_id}/criteria")
def list_evaluation_criteria_results(
    run_id: str, user: dict[str, Any] = Depends(current_user)
) -> list[dict[str, Any]]:
    return store.list_evaluation_criterion_results(run_id)


@app.get("/v1/evaluation-runs")
def list_evaluation_runs(
    target_type: str | None = None,
    environment: str | None = None,
    limit: int = 100,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    if target_type and target_type not in {"tool", "agent", "workflow"}:
        raise HTTPException(status_code=400, detail="target_type must be tool, agent, or workflow")
    return store.list_evaluation_runs(
        target_type=target_type,
        environment=visible_environment(environment, user),
        limit=limit,
    )


@app.get("/v1/monitoring/metrics")
def monitoring_metrics(
    environment: str | None = None,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    from intelliguard.telemetry.monitoring import build_monitoring_metrics

    return build_monitoring_metrics(store, visible_environment(environment, user))


@app.get("/v1/workflow-definitions")
def workflow_definitions(
    environment: str | None = None,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    return store.list_workflow_definitions(environment=visible_environment(environment, user))


@app.post("/v1/workflow-definitions")
def create_workflow_definition(
    request: api_schemas.WorkflowDefinitionRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    from intelliguard.evaluation.enforcement import (
        CertificationEnforcementError,
        check_agent_certification,
    )

    require_environment_access(user, request.environment, "workflow:create")
    if not request.steps and not request.nodes:
        raise HTTPException(status_code=400, detail="Workflow definition needs at least one node")
    workflow_agent_ids = {
        request.lead_agent_id,
        *[
            str(step.get("agent_id"))
            for step in request.steps
            if isinstance(step, dict) and step.get("agent_id")
        ],
        *[
            str(node.get("agent_id"))
            for node in request.nodes
            if isinstance(node, dict) and node.get("agent_id")
        ],
    }
    for workflow_agent_id in sorted(workflow_agent_ids):
        try:
            check_agent_certification(store, workflow_agent_id, request.environment)
        except CertificationEnforcementError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
    try:
        return store.upsert_workflow_definition(request.model_dump())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except WorkflowGraphError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/v1/workflow-definitions/{workflow_definition_id}/versions")
def list_workflow_definition_versions(
    workflow_definition_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    workflow = store.get_workflow_definition(workflow_definition_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    require_environment_access(user, workflow.get("environment"), "read")
    return store.list_workflow_definition_versions(
        workflow.get("workflow_root_id") or workflow_definition_id
    )


@app.post("/v1/workflow-definitions/{workflow_definition_id}/versions")
def create_workflow_definition_version(
    workflow_definition_id: str,
    request: api_schemas.WorkflowDefinitionVersionRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    workflow = store.get_workflow_definition(workflow_definition_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    require_environment_access(user, workflow.get("environment"), "workflow:create")
    try:
        return store.create_workflow_definition_version(
            source_workflow_definition_id=workflow_definition_id,
            new_workflow_definition_id=request.new_workflow_definition_id,
            version=request.version,
            change_summary=request.change_summary,
            created_by=user["email"],
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/v1/workflow-definitions/{workflow_definition_id}/lifecycle")
def transition_workflow_lifecycle(
    workflow_definition_id: str,
    request: api_schemas.WorkflowLifecycleTransitionRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    workflow = store.get_workflow_definition(workflow_definition_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    require_environment_access(user, workflow.get("environment"), "workflow:create")
    try:
        return store.transition_workflow_lifecycle(
            workflow_definition_id,
            request.target_status,
            actor=user["email"],
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/v1/workflow-definitions/{workflow_definition_id}/deployments")
def create_workflow_deployment(
    workflow_definition_id: str,
    request: api_schemas.WorkflowDeploymentRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    from intelliguard.runtime.manifest_compiler import (
        ManifestCompileError,
        ManifestCompileOptions,
        compile_workflow_manifest,
    )

    workflow = store.get_workflow_definition(workflow_definition_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    require_environment_access(user, workflow.get("environment"), "workflow:deploy")
    certification = store.get_workflow_certification(workflow_definition_id)
    if not certification:
        raise HTTPException(status_code=400, detail="Workflow certification is required")

    deployment_id = f"deploy_{uuid4().hex[:16]}"
    snapshots = api_services.workflow_manifest_snapshots(workflow, store)
    try:
        manifest = compile_workflow_manifest(
            workflow=workflow,
            certification=certification,
            deployment_id=deployment_id,
            snapshots=snapshots,
            options=ManifestCompileOptions(
                runtime_type=request.runtime_type,
                timeout_seconds=request.timeout_seconds,
                max_parallel_nodes=request.max_parallel_nodes,
                max_tool_calls=request.max_tool_calls,
                max_llm_calls=request.max_llm_calls,
                max_cost_usd=request.max_cost_usd,
            ),
        )
        revision = store.create_workflow_deployment_revision(
            {
                "deployment_id": deployment_id,
                "workflow_definition_id": workflow_definition_id,
                "environment": workflow["environment"],
                "version": workflow.get("version") or "v1",
                "status": "PACKAGED",
                "manifest": manifest.model_dump(mode="json"),
                "manifest_hash": manifest.manifest_hash(),
                "graph_version_hash": manifest.graph_version_hash,
                "agent_config_hashes": snapshots.get("agents", {}),
                "tool_config_hashes": snapshots.get("tools", {}),
                "evaluator_config_hashes": snapshots.get("evaluators", {}),
                "policy_hashes": snapshots.get("policies", {}),
                "kb_version_hashes": snapshots.get("knowledge", {}),
                "runtime_type": manifest.runtime_type,
                "runtime_limits": manifest.runtime_limits.model_dump(mode="json"),
                "created_by": user["email"],
            }
        )
    except (ManifestCompileError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {
        "deployment_id": revision["deployment_id"],
        "workflow_definition_id": revision["workflow_definition_id"],
        "status": revision["status"],
        "runtime_type": revision["runtime_type"],
        "manifest_hash": revision["manifest_hash"],
        "graph_version_hash": revision["graph_version_hash"],
    }


@app.post("/v1/workflow-deployments/{deployment_id}/activate")
def activate_workflow_deployment(
    deployment_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    from intelliguard.runtime.scenario_evaluator import (
        assert_production_activation_allowed,
    )

    deployment = store.get_workflow_deployment_revision(deployment_id)
    if not deployment:
        raise HTTPException(status_code=404, detail="Workflow deployment not found")
    require_environment_access(user, deployment["environment"], "workflow:deploy")
    try:
        assert_production_activation_allowed(store=store, deployment=deployment)
        return store.activate_workflow_deployment(deployment_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/v1/workflow-deployments/{deployment_id}/generate-artifacts")
def generate_workflow_deployment_artifacts(
    deployment_id: str,
    request: api_schemas.WorkflowDeploymentJobRequest | None = None,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    from intelliguard.adk.manifest import RuntimeManifest
    from intelliguard.runtime.codegen import (
        generate_runtime_artifacts,
        persist_runtime_artifacts,
    )

    deployment = store.get_workflow_deployment_revision(deployment_id)
    if not deployment:
        raise HTTPException(status_code=404, detail="Workflow deployment not found")
    require_environment_access(user, deployment["environment"], "workflow:deploy")
    request = request or api_schemas.WorkflowDeploymentJobRequest()
    manifest = RuntimeManifest.model_validate(deployment["manifest"])
    worker_pool = manifest.metadata.get("worker_pool") or request.worker_pool
    artifacts = generate_runtime_artifacts(manifest, worker_pool=worker_pool)
    return persist_runtime_artifacts(
        store=store,
        deployment_id=deployment_id,
        workflow_definition_id=deployment["workflow_definition_id"],
        artifacts=artifacts,
    )


@app.get("/v1/workflow-deployments/{deployment_id}/artifacts")
def list_workflow_deployment_artifacts(
    deployment_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    deployment = store.get_workflow_deployment_revision(deployment_id)
    if not deployment:
        raise HTTPException(status_code=404, detail="Workflow deployment not found")
    require_environment_access(user, deployment["environment"], "read")
    return store.list_workflow_generated_artifacts(deployment_id)


@app.post("/v1/workflow-deployments/{deployment_id}/deploy")
def deploy_workflow_deployment(
    deployment_id: str,
    request: api_schemas.WorkflowDeploymentJobRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    from intelliguard.runtime.deployment_orchestrator import (
        DeploymentJobRequest,
        DeploymentOrchestrator,
        KubernetesDeploymentBackend,
        LocalComposeDeploymentBackend,
    )

    deployment = store.get_workflow_deployment_revision(deployment_id)
    if not deployment:
        raise HTTPException(status_code=404, detail="Workflow deployment not found")
    require_environment_access(user, deployment["environment"], "workflow:deploy")
    artifacts = store.list_workflow_generated_artifacts(deployment_id)
    if not artifacts:
        raise HTTPException(status_code=400, detail="Generate runtime artifacts before deploy")
    orchestrator = DeploymentOrchestrator(
        store=store,
        backends={
            "local_compose": LocalComposeDeploymentBackend(
                os.getenv("WORKFLOW_RUNNER_HEALTH_URL", "http://localhost:8000/health")
            ),
            "kubernetes": KubernetesDeploymentBackend(
                namespace=os.getenv("K8S_NAMESPACE", "intelliguard")
            ),
        },
    )
    try:
        return orchestrator.deploy(
            DeploymentJobRequest(
                deployment_id=deployment_id,
                environment=deployment["environment"],
                backend=request.backend,
                requested_by=user["email"],
                worker_pool=request.worker_pool,
                artifact_ids=[artifact["artifact_id"] for artifact in artifacts],
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/v1/deployment-jobs/{job_id}")
def get_deployment_job(
    job_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    job = store.get_deployment_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Deployment job not found")
    require_environment_access(user, job["environment"], "read")
    return job


@app.get("/v1/workflow-deployments/{deployment_id}/jobs")
def list_workflow_deployment_jobs(
    deployment_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    deployment = store.get_workflow_deployment_revision(deployment_id)
    if not deployment:
        raise HTTPException(status_code=404, detail="Workflow deployment not found")
    require_environment_access(user, deployment["environment"], "read")
    return store.list_deployment_jobs(deployment_id)


@app.post("/v1/workflow-definitions/{workflow_definition_id}/evaluate")
def evaluate_workflow_definition(
    workflow_definition_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    from time import monotonic

    from intelliguard.evaluation.certification import (
        CertificationError,
        decide_certification,
        validate_transition,
    )
    from intelliguard.evaluation.workflow_evaluators import (
        compute_workflow_config_hash,
        run_workflow_evaluators,
    )

    workflow = store.get_workflow_definition(workflow_definition_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    require_environment_access(user, workflow.get("environment"), "workflow:create")

    config_hash = compute_workflow_config_hash(workflow)
    cert = store.get_workflow_certification(
        workflow_definition_id
    ) or store.create_workflow_certification(workflow_definition_id, config_hash)
    if cert["status"] != "EVALUATING":
        try:
            validate_transition(cert["status"], "EVALUATING")
        except CertificationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    store.update_workflow_certification(
        workflow_definition_id,
        {"status": "EVALUATING", "config_hash": config_hash, "invalidation_reason": None},
    )
    run = store.create_evaluation_run(
        {
            "target_type": "workflow",
            "target_id": workflow_definition_id,
            "config_hash": config_hash,
            "triggered_by": user["email"],
        }
    )

    started_at = monotonic()
    criterion_results = run_workflow_evaluators(
        workflow, api_services.workflow_assignments_for_evaluation(workflow, store)
    )
    duration_ms = int((monotonic() - started_at) * 1000)
    result_records = [
        result.to_record(evaluator_id="workflow_graph_baseline") for result in criterion_results
    ]
    store.add_evaluation_criterion_results(run["run_id"], result_records)

    decision = decide_certification(result_records)
    criteria_passed = sum(1 for result in criterion_results if result.status == "PASS")
    store.complete_evaluation_run(
        run["run_id"],
        overall_result=decision.status,
        criteria_total=len(criterion_results),
        criteria_passed=criteria_passed,
        duration_ms=duration_ms,
    )
    store.update_workflow_certification(
        workflow_definition_id,
        {
            "status": decision.status,
            "config_hash": config_hash,
            "invalidation_reason": None,
            "last_evaluation_run_id": run["run_id"],
            "certified_by": user["email"] if decision.status == "CERTIFIED" else None,
            "certified_at": utc_now() if decision.status == "CERTIFIED" else None,
            "failure_reason": decision.failure_reason,
        },
    )

    return {
        "run_id": run["run_id"],
        "workflow_definition_id": workflow_definition_id,
        "overall_result": decision.status,
        "criteria_total": len(criterion_results),
        "criteria_passed": criteria_passed,
        "duration_ms": duration_ms,
        "criterion_results": result_records,
    }


@app.get("/v1/workflow-definitions/{workflow_definition_id}/certification")
def get_workflow_certification_status(
    workflow_definition_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    workflow = store.get_workflow_definition(workflow_definition_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    require_environment_access(user, workflow.get("environment"), "read")
    cert = store.get_workflow_certification(workflow_definition_id)
    if not cert:
        raise HTTPException(status_code=404, detail="No certification record for this workflow")
    return cert


@app.get("/v1/workflow-definitions/{workflow_definition_id}/evaluation-runs")
def list_workflow_evaluation_runs(
    workflow_definition_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    workflow = store.get_workflow_definition(workflow_definition_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    require_environment_access(user, workflow.get("environment"), "read")
    return store.list_evaluation_runs_for_workflow(workflow_definition_id)


@app.post("/v1/agents/{agent_id}/tool-grants")
def grant_agent_tool(
    agent_id: str,
    request: api_schemas.AgentToolGrantRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    from intelliguard.evaluation.enforcement import (
        CertificationEnforcementError,
        check_tool_certification,
    )

    tool = store.get_tool_record_by_name(request.tool_name)
    if not tool:
        raise HTTPException(status_code=400, detail="Unknown tool")
    agent = require_agent_identity_for_access(agent_id, user, "tool:grant")
    agent_environment = str(agent["environment"])
    _ensure_tool_attachable_to_agent(agent, tool)
    try:
        check_tool_certification(store, tool["tool_id"], agent_environment)
    except CertificationEnforcementError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if request.tool_name not in registry.names():
        registry.register_configured_tool(tool)
    try:
        return store.grant_agent_tool(agent_id, request.tool_name)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/v1/agents/{agent_id}/tool-grants/{tool_name}")
def revoke_agent_tool(
    agent_id: str, tool_name: str, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    require_agent_identity_for_access(agent_id, user, "tool:grant")
    try:
        return store.revoke_agent_tool(agent_id, tool_name)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/v1/evaluate-tool-call")
def evaluate_tool_call(
    request: api_schemas.ToolCallRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    require_agent_identity_for_access(request.agent_id, user, "agent:run")
    runner = build_runner(request.agent_id)
    result = runner.evaluate_tool_call(
        session_id=request.session_id,
        user_query=request.user_query,
        tool_name=request.tool_name,
        tool_args=request.tool_args,
    )
    return {
        "session_id": request.session_id,
        "decision": result.decision,
        "risk_score": result.risk_score,
        "risk_types": result.risk_types,
        "reason": result.reason,
        "audit_event_id": result.audit_event_id,
        "review_id": result.review_id,
    }


@app.post("/v1/governed-tool-call")
def governed_tool_call(
    request: api_schemas.ToolCallRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    require_agent_identity_for_access(request.agent_id, user, "agent:run")
    runner = build_runner(request.agent_id)
    result = runner.call_tool(
        session_id=request.session_id,
        user_query=request.user_query,
        tool_name=request.tool_name,
        tool_args=request.tool_args,
    )
    return {
        "session_id": request.session_id,
        "decision": result.decision,
        "risk_score": result.risk_score,
        "risk_types": result.risk_types,
        "reason": result.reason,
        "result": result.result,
        "response_text": result.response_text,
        "audit_event_id": result.audit_event_id,
        "review_id": result.review_id,
    }


@app.post("/v1/agent-runs")
def agent_run(
    request: api_schemas.AgentRunRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    require_agent_identity_for_access(request.agent_id, user, "agent:run")
    runner = build_runner(request.agent_id)
    return run_customer_support_agent(
        runner=runner, query=request.query, session_id=request.session_id
    )


@app.post("/v1/multi-agent-runs")
def multi_agent_run(
    request: api_schemas.MultiAgentRunRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    from intelliguard.evaluation.enforcement import (
        CertificationEnforcementError,
        check_workflow_certification,
    )
    from intelliguard.runtime.dispatcher import (
        DuplicateActiveRunError,
        RuntimeRunDispatcher,
        StoreBackedRunQueue,
    )

    workflow_definition = None
    if request.deployment_id:
        deployment = store.get_workflow_deployment_revision(request.deployment_id)
        if not deployment:
            raise HTTPException(status_code=404, detail="Workflow deployment not found")
        if deployment["status"] not in {"PACKAGED", "ACTIVE"}:
            raise HTTPException(status_code=400, detail="Workflow deployment is not runnable")
        require_environment_access(user, deployment["environment"], "workflow:run")
        try:
            run = RuntimeRunDispatcher(
                store=store,
                queue=StoreBackedRunQueue(store=store),
            ).submit(
                deployment_id=deployment["deployment_id"],
                user_query=request.query,
                idempotency_key=request.idempotency_key,
            )
            return {
                "run_id": run["run_id"],
                "deployment_id": deployment["deployment_id"],
                "workflow_definition_id": deployment["workflow_definition_id"],
                "workflow_id": run.get("workflow_id"),
                "decision": run.get("decision"),
                "status": run["status"],
                "queued": run["status"] == "QUEUED",
            }
        except DuplicateActiveRunError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not request.workflow_definition_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "workflow_definition_id or deployment_id is required. Create and select a "
                "workflow definition before running."
            ),
        )
    workflow_definition = store.get_workflow_definition(request.workflow_definition_id)
    if not workflow_definition:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    require_environment_access(user, workflow_definition["environment"], "workflow:run")
    try:
        check_workflow_certification(
            store,
            workflow_definition["workflow_definition_id"],
            workflow_definition["environment"],
        )
    except CertificationEnforcementError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    try:
        result = run_customer_support_workflow(
            database_url=settings.database_url,
            policy_path=settings.policy_path,
            tools=registry,
            query=request.query,
            workflow_definition=workflow_definition,
        )
        trace_id = current_trace_id()
        if trace_id:
            result["trace_id"] = trace_id
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/workflows")
def workflows(
    limit: int = 50, environment: str | None = None, user: dict[str, Any] = Depends(current_user)
) -> list[dict[str, Any]]:
    return store.list_agent_workflows(
        limit=limit, environment=visible_environment(environment, user)
    )


@app.get("/v1/workflows/{workflow_id}")
def workflow_detail(
    workflow_id: str, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    detail = store.agent_workflow_detail(workflow_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Workflow not found")
    require_environment_access(user, detail.get("lead_agent", {}).get("environment"), "read")
    return detail


@app.get("/v1/runtime-runs/{run_id}")
def runtime_run_detail(run_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    run = store.get_workflow_runtime_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Runtime run not found")
    require_environment_access(user, run["environment"], "workflow:run")
    return run


@app.get("/v1/runtime-runs")
def list_runtime_runs(
    limit: int = 100,
    environment: str | None = None,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    return store.list_workflow_runtime_runs(
        environment=visible_environment(environment, user),
        limit=limit,
    )


@app.get("/v1/runtime-runs/{run_id}/events")
def runtime_run_events(
    run_id: str,
    after_outbox_id: str | None = None,
    stream: bool = False,
    user: dict[str, Any] = Depends(current_user),
) -> Any:
    from intelliguard.runtime.event_bus import RuntimeEventBus

    run = store.get_workflow_runtime_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Runtime run not found")
    require_environment_access(user, run["environment"], "workflow:run")
    bus = RuntimeEventBus(store=store)
    if not stream:
        return {"events": bus.list_since(run_id=run_id, after_outbox_id=after_outbox_id)}

    def event_stream() -> Any:
        cursor = after_outbox_id
        for _ in range(120):
            events = bus.list_since(run_id=run_id, after_outbox_id=cursor)
            for event in events:
                cursor = event["outbox_id"]
                yield f"id: {cursor}\nevent: {event['event_type']}\ndata: {json.dumps(event)}\n\n"
            current = store.get_workflow_runtime_run(run_id)
            if current and current["status"] in {"COMPLETED", "FAILED", "BLOCKED", "REVIEW"}:
                break
            time.sleep(1)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/v1/runtime-runs/{run_id}/audit-completeness")
def runtime_run_audit_completeness(
    run_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    from intelliguard.runtime.audit_completeness import check_runtime_audit_completeness

    run = store.get_workflow_runtime_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Runtime run not found")
    require_environment_access(user, run["environment"], "read")
    result = check_runtime_audit_completeness(store, run_id)
    return {"run_id": run_id, "passed": result.passed, "findings": result.findings}


@app.get("/v1/audit-events")
def audit_events(
    limit: int = 100,
    environment: str | None = None,
    workflow_only: bool = False,
    user: dict[str, Any] = Depends(current_user),
) -> list[api_schemas.AuditEventResponse]:
    return store.list_audit_events(
        limit=limit,
        environment=visible_environment(environment, user),
        workflow_only=workflow_only,
    )


@app.get("/v1/review-queue")
def review_queue(
    status: Literal["PENDING", "APPROVED", "DENIED", "ALL"] = "PENDING",
    limit: int = 100,
    environment: str = "all",
    user: dict[str, Any] = Depends(current_user),
) -> list[api_schemas.ReviewQueueItemResponse]:
    return store.list_review_queue(
        limit=limit,
        environment=visible_environment(environment, user),
        status=status,
    )


@app.post("/v1/review-queue/{review_id}/resolve")
def resolve_review(
    review_id: str,
    request: api_schemas.ResolveReviewRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    environment = store.review_environment(review_id)
    if environment is None:
        raise HTTPException(status_code=404, detail="Review item not found")
    require_environment_access(user, environment, "review:resolve")
    if request.status == "DENIED" and not (request.reviewer_note or "").strip():
        raise HTTPException(
            status_code=400, detail="Reviewer note is required when denying a review"
        )
    review = store.get_review_item(review_id)
    updated = store.resolve_review_item(review_id, request.status, request.reviewer_note)
    if not updated:
        raise HTTPException(status_code=404, detail="Review item not found")
    temporal_signal_sent = False
    runtime_resume: dict[str, Any] = {"applied": False}
    if review:
        from intelliguard.runtime.hooks import RuntimeReviewResumeService
        from intelliguard.temporal.review import signal_review_resolution

        resume_result = RuntimeReviewResumeService(store=store).resolve_review(
            review=review,
            status=request.status,
            reviewer_email=user["email"],
            reviewer_note=request.reviewer_note,
        )
        runtime_resume = {
            "applied": resume_result.applied,
            "action": resume_result.action,
            "run_id": resume_result.run_id,
            "hook_id": resume_result.hook_id,
        }
        try:
            temporal_signal_sent = signal_review_resolution(
                review=review,
                status=request.status,
                reviewer_email=user["email"],
                reviewer_note=request.reviewer_note,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "review_id": review_id,
        "status": request.status,
        "temporal_signal_sent": temporal_signal_sent,
        "runtime_resume": runtime_resume,
    }


@app.get("/v1/sessions")
def sessions(
    limit: int = 50, environment: str | None = None, user: dict[str, Any] = Depends(current_user)
) -> list[dict[str, Any]]:
    return store.list_sessions(limit=limit, environment=visible_environment(environment, user))


@app.get("/v1/sessions/{session_id}/workflow")
def workflow(session_id: str, user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    environment = store.session_environment(session_id)
    if environment is None:
        raise HTTPException(status_code=404, detail="Session not found")
    require_environment_access(user, environment, "read")
    return store.workflow_for_session(session_id)


@app.get("/v1/guardrail-policies")
def list_guardrail_policies(
    environment: str | None = None,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    return store.list_guardrail_policies(environment=visible_environment(environment, user))


@app.post("/v1/guardrail-policies")
def create_guardrail_policy(
    request: api_schemas.GuardrailPolicyRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_environment_access(user, request.environment, "agent:create")
    return store.upsert_guardrail_policy(request.model_dump())


@app.get("/v1/guardrail-policies/{policy_id}")
def get_guardrail_policy(
    policy_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    policy = store.get_guardrail_policy(policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    require_environment_access(user, policy.get("environment"), "read")
    return policy


@app.put("/v1/guardrail-policies/{policy_id}")
def update_guardrail_policy(
    policy_id: str,
    request: api_schemas.GuardrailPolicyRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_environment_access(user, request.environment, "agent:create")
    payload = request.model_dump()
    payload["policy_id"] = policy_id
    return store.upsert_guardrail_policy(payload)


@app.get("/v1/agents/{agent_id}/guardrails")
def list_agent_guardrails(
    agent_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    require_agent_identity_for_access(agent_id, user, "read")
    return store.list_agent_guardrail_assignments(agent_id)


@app.post("/v1/agents/{agent_id}/guardrails")
def assign_agent_guardrail(
    agent_id: str,
    request: api_schemas.AgentGuardrailAssignmentRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    agent = require_agent_identity_for_access(agent_id, user, "agent:create")
    agent_environment = str(agent["environment"])
    policy = store.get_guardrail_policy(request.policy_id)
    if not policy:
        raise HTTPException(status_code=400, detail="Policy not found")
    if policy.get("environment") != agent_environment:
        raise HTTPException(
            status_code=400,
            detail="Guardrail policy environment must match the agent environment",
        )
    return store.upsert_agent_guardrail_assignment(
        agent_id=agent_id,
        environment=agent_environment,
        policy_id=request.policy_id,
        mode=request.mode,
        threshold_overrides=request.threshold_overrides,
    )


@app.put("/v1/agents/{agent_id}/guardrails/{assignment_id}")
def update_agent_guardrail(
    agent_id: str,
    assignment_id: str,
    request: api_schemas.AgentGuardrailAssignmentUpdateRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_agent_identity_for_access(agent_id, user, "agent:create")
    assignments = store.list_agent_guardrail_assignments(agent_id)
    assignment = next((a for a in assignments if a["assignment_id"] == assignment_id), None)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return store.upsert_agent_guardrail_assignment(
        agent_id=agent_id,
        environment=assignment["environment"],
        policy_id=assignment["policy_id"],
        mode=request.mode,
        threshold_overrides=request.threshold_overrides,
    )


@app.delete("/v1/agents/{agent_id}/guardrails/{assignment_id}")
def delete_agent_guardrail(
    agent_id: str,
    assignment_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, bool]:
    require_agent_identity_for_access(agent_id, user, "agent:create")
    deleted = store.delete_agent_guardrail_assignment(assignment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return {"ok": True}


@app.get("/v1/evaluator-templates")
def list_evaluator_templates(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return store.list_evaluator_templates()


@app.get("/v1/evaluation-rules")
def list_evaluation_rules(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    from intelliguard.evaluation.rules import evaluation_rule_catalog

    _ = user
    return evaluation_rule_catalog(store.list_evaluator_templates())


@app.post("/v1/evaluator-templates")
def create_evaluator_template(
    request: api_schemas.EvaluatorTemplateRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    if not user.get("is_super_admin"):
        raise HTTPException(
            status_code=403, detail="Only super admins can create evaluator templates"
        )
    return store.upsert_evaluator_template(request.model_dump())


@app.get("/v1/agents/{agent_id}/evaluators")
def list_agent_evaluators(
    agent_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    require_agent_identity_for_access(agent_id, user, "read")
    return store.list_agent_evaluator_assignments(agent_id)


@app.post("/v1/agents/{agent_id}/evaluators")
def assign_agent_evaluator(
    agent_id: str,
    request: api_schemas.AgentEvaluatorAssignmentRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    agent = require_agent_identity_for_access(agent_id, user, "agent:create")
    if not store.get_evaluator_template(request.evaluator_id):
        raise HTTPException(status_code=400, detail="Evaluator template not found")
    return store.upsert_agent_evaluator_assignment(
        agent_id=agent_id,
        environment=str(agent["environment"]),
        evaluator_id=request.evaluator_id,
        trigger=request.trigger,
        config=request.config,
    )


@app.delete("/v1/agents/{agent_id}/evaluators/{assignment_id}")
def delete_agent_evaluator(
    agent_id: str,
    assignment_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, bool]:
    require_agent_identity_for_access(agent_id, user, "agent:create")
    deleted = store.delete_agent_evaluator_assignment(assignment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return {"ok": True}


@app.get("/v1/evaluation-results")
def evaluation_results(
    limit: int = 100,
    environment: str | None = None,
    agent_id: str | None = None,
    session_id: str | None = None,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    return store.list_evaluation_results(
        environment=visible_environment(environment, user),
        agent_id=agent_id,
        session_id=session_id,
        limit=limit,
    )


@app.get("/v1/sessions/{session_id}/evaluation-results")
def session_evaluation_results(
    session_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    environment = store.session_environment(session_id)
    if environment is None:
        raise HTTPException(status_code=404, detail="Session not found")
    require_environment_access(user, environment, "read")
    return store.list_session_evaluation_results(session_id)


@app.post("/v1/sessions/{session_id}/evaluate")
def trigger_session_evaluation(
    session_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    from intelliguard.governance.evaluators import EvaluatorEngine

    environment = store.session_environment(session_id)
    if environment is None:
        raise HTTPException(status_code=404, detail="Session not found")
    require_environment_access(user, environment, "agent:run")
    sessions = store.list_sessions(limit=1000)
    session = next((s for s in sessions if s["session_id"] == session_id), None)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    engine = EvaluatorEngine(store)
    results = engine.run_for_session(session_id, session["agent_id"], environment)
    return [
        {
            "evaluator_id": r.evaluator_id,
            "score": r.score,
            "passed": r.passed,
            "findings": r.findings,
        }
        for r in results
    ]


# ── Knowledge Base endpoints ──────────────────────────────────────────────────


@app.get("/v1/knowledge-bases")
def list_knowledge_bases(
    environment: str = "all",
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    return store.list_knowledge_bases(environment=visible_environment(environment, user))


@app.post("/v1/knowledge-bases")
def create_knowledge_base(
    body: api_schemas.KnowledgeBaseRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_environment_access(user, body.environment, "agent:create")
    return store.upsert_knowledge_base(body.model_dump())


@app.post("/v1/knowledge-bases/create-with-files")
async def create_knowledge_base_with_files(
    metadata: str = Form(...),
    files: list[UploadFile] = File(default=[]),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    try:
        body = api_schemas.KnowledgeBaseCreateWithFilesMetadata.model_validate_json(metadata)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    require_environment_access(user, body.environment, "agent:create")
    if store.get_knowledge_base(body.kb_id):
        raise HTTPException(status_code=409, detail="Knowledge base already exists")
    if not files:
        raise HTTPException(status_code=400, detail="Attach at least one file before creating a KB")
    if len(files) > 10:
        raise HTTPException(status_code=400, detail="A KB can include at most 10 files")
    reject_vector_image_uploads(body.retrieval_mode, files)

    scope_ref = (
        body.linked_agent_id
        if body.kb_scope == "agent"
        else body.scope_ref or body.domain or "shared"
    )
    vector_backend = body.vector_backend if body.retrieval_mode == "vector" else ""
    try:
        kb = store.upsert_knowledge_base(
            {
                "kb_id": body.kb_id,
                "display_name": body.display_name,
                "description": body.description,
                "source_type": "file",
                "source_config": {
                    "kb_scope": body.kb_scope,
                    "linked_agent_id": body.linked_agent_id,
                    "scope_ref": scope_ref,
                    "retrieval_mode": body.retrieval_mode,
                    "vector_backend": vector_backend,
                    "embedding_model": body.embedding_model,
                    "chunking_strategy": body.chunking_strategy,
                    "chunk_size": body.chunk_size,
                    "chunk_overlap": body.chunk_overlap,
                },
                "environment": body.environment,
                "owner": body.owner,
                "domain": body.domain,
                "sensitivity": body.sensitivity,
                "embedding_model": body.embedding_model,
                "create_initial_version": False,
            }
        )
        documents = []
        for upload in files:
            with trace_kb_operation(
                operation="kb.file.store",
                kb_id=body.kb_id,
                retrieval_mode=body.retrieval_mode,
                attributes={
                    "agentic.file_name": upload.filename or "upload.txt",
                    "agentic.content_type": upload.content_type or "",
                },
            ):
                data = await upload.read()
                stored = KnowledgeFileStorage(DEFAULT_KB_UPLOAD_DIR).save_upload(
                    kb_id=body.kb_id,
                    file_name=upload.filename or "upload.txt",
                    content_type=upload.content_type or "",
                    data=data,
                )
                source = store.upsert_knowledge_source(
                    body.kb_id,
                    {
                        "source_type": "file",
                        "display_name": stored.file_name,
                        "uri": stored.storage_uri,
                        "content_type": stored.content_type,
                        "source_config": {"checksum": stored.checksum},
                        "status": "pending",
                    },
                )
                documents.append(
                    store.create_knowledge_document(
                        body.kb_id,
                        source["source_id"],
                        {
                            "file_name": stored.file_name,
                            "content_type": stored.content_type,
                            "storage_uri": stored.storage_uri,
                            "size_bytes": stored.size_bytes,
                            "checksum": stored.checksum,
                        },
                    )
                )
        version = store.create_knowledge_base_version(
            body.kb_id,
            {
                "version": body.version,
                "status": "draft",
                "notes": body.notes,
                "retrieval_mode": body.retrieval_mode,
                "kb_scope": body.kb_scope,
                "scope_ref": scope_ref,
                "vector_backend": vector_backend,
                "embedding_model": body.embedding_model,
                "chunking_strategy": body.chunking_strategy,
                "chunk_size": body.chunk_size,
                "chunk_overlap": body.chunk_overlap,
                "profile": kb,
                "file_manifest": None,
            },
        )
        index = None
        if body.retrieval_mode == "vector" and body.index_after_create and documents:
            with trace_kb_operation(
                operation="kb.index",
                kb_id=body.kb_id,
                retrieval_mode=body.retrieval_mode,
                attributes={"agentic.document_count": len(documents)},
            ):
                index_config = {
                    "embedding_model": body.embedding_model,
                    "chunking_strategy": body.chunking_strategy,
                    "chunk_size": body.chunk_size,
                    "chunk_overlap": body.chunk_overlap,
                }
                index = KnowledgeIngestionService(
                    store,
                    api_services.knowledge_indexer_for_config(index_config),
                ).process_pending_documents(body.kb_id)
        return {
            "knowledge_base": store.get_knowledge_base(body.kb_id) or kb,
            "documents": documents,
            "version": version,
            "index": index,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/knowledge-bases/{kb_id}")
def get_knowledge_base_detail(
    kb_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "read")
    detail = store.get_knowledge_base_detail(kb_id)
    return detail or {}


@app.get("/v1/knowledge-bases/{kb_id}/versions")
def list_knowledge_base_versions(
    kb_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "read")
    try:
        return store.list_knowledge_base_versions(kb_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/v1/knowledge-bases/{kb_id}/versions")
def create_knowledge_base_version(
    kb_id: str,
    body: api_schemas.KnowledgeBaseVersionRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "agent:create")
    try:
        return store.create_knowledge_base_version(kb_id, body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/v1/knowledge-bases/{kb_id}/versions/{version_id}/publish")
def publish_knowledge_base_version(
    kb_id: str,
    version_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "agent:create")
    try:
        return store.publish_knowledge_base_version(kb_id, version_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/v1/knowledge-bases/{kb_id}/evaluate")
def evaluate_knowledge_base(
    kb_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "read")
    try:
        return store.evaluate_knowledge_base(kb_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/v1/knowledge-bases/{kb_id}")
def delete_knowledge_base(
    kb_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, bool]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "agent:create")
    try:
        deleted = store.delete_knowledge_base(kb_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return {"deleted": True}


@app.get("/v1/knowledge-bases/{kb_id}/sources")
def list_knowledge_sources(
    kb_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "read")
    return store.list_knowledge_sources(kb_id)


@app.post("/v1/knowledge-bases/{kb_id}/sources")
def create_knowledge_source(
    kb_id: str,
    body: api_schemas.KnowledgeSourceRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "agent:create")
    try:
        return store.upsert_knowledge_source(kb_id, body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/v1/knowledge-bases/{kb_id}/files")
async def upload_knowledge_file(
    kb_id: str,
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "agent:create")
    if len(store.list_knowledge_documents(kb_id)) >= 10:
        raise HTTPException(status_code=400, detail="This KB already has 10 files")
    source_config = kb.get("source_config") if isinstance(kb.get("source_config"), dict) else {}
    retrieval_mode = source_config.get("retrieval_mode") or "file"
    reject_vector_image_uploads(retrieval_mode, [file])
    data = await file.read()
    try:
        with trace_kb_operation(
            operation="kb.file.upload",
            kb_id=kb_id,
            retrieval_mode=retrieval_mode,
            attributes={
                "agentic.file_name": file.filename or "upload.txt",
                "agentic.content_type": file.content_type or "",
            },
        ):
            stored = KnowledgeFileStorage(DEFAULT_KB_UPLOAD_DIR).save_upload(
                kb_id=kb_id,
                file_name=file.filename or "upload.txt",
                content_type=file.content_type or "",
                data=data,
            )
            source = store.upsert_knowledge_source(
                kb_id,
                {
                    "source_type": "file",
                    "display_name": stored.file_name,
                    "uri": stored.storage_uri,
                    "content_type": stored.content_type,
                    "source_config": {"checksum": stored.checksum},
                    "status": "pending",
                },
            )
            return store.create_knowledge_document(
                kb_id,
                source["source_id"],
                {
                    "file_name": stored.file_name,
                    "content_type": stored.content_type,
                    "storage_uri": stored.storage_uri,
                    "size_bytes": stored.size_bytes,
                    "checksum": stored.checksum,
                },
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/knowledge-bases/{kb_id}/documents")
def list_knowledge_documents(
    kb_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "read")
    return store.list_knowledge_documents(kb_id)


@app.post("/v1/knowledge-bases/{kb_id}/sync")
def create_knowledge_sync_status(
    kb_id: str,
    body: api_schemas.KnowledgeSyncRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "agent:create")
    try:
        source_config = kb.get("source_config") if isinstance(kb.get("source_config"), dict) else {}
        index_config = {
            **source_config,
            "embedding_model": body.embedding_model
            or source_config.get("embedding_model")
            or "nomic-embed-text",
            "chunk_size": body.chunk_size or source_config.get("chunk_size"),
            "chunk_overlap": body.chunk_overlap or source_config.get("chunk_overlap"),
        }
        with trace_kb_operation(
            operation="kb.sync",
            kb_id=kb_id,
            retrieval_mode=str(source_config.get("retrieval_mode") or "vector"),
            attributes={"agentic.force_reindex": body.force_reindex},
        ):
            return KnowledgeIngestionService(
                store,
                api_services.knowledge_indexer_for_config(index_config),
            ).process_pending_documents(kb_id, force_reindex=body.force_reindex)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/agents/{agent_id}/knowledge-bases")
def list_agent_kb_assignments(
    agent_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    require_agent_identity_for_access(agent_id, user, "read")
    return store.list_agent_kb_assignments(agent_id)


@app.post("/v1/agents/{agent_id}/knowledge-bases")
def assign_kb_to_agent(
    agent_id: str,
    body: api_schemas.AgentKBAssignmentRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    agent = require_agent_identity_for_access(agent_id, user, "agent:create")
    kb = store.get_knowledge_base(body.kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    _ensure_kb_attachable_to_agent(agent, kb)
    policy_updates = body.model_dump(
        include={
            "retrieval_mode",
            "top_k",
            "score_threshold",
            "citation_required",
            "freshness_days",
            "metadata_filters",
        },
        exclude_unset=True,
    )
    return store.upsert_agent_kb_assignment(
        agent_id=agent_id,
        kb_id=body.kb_id,
        access_mode=body.access_mode,
        **policy_updates,
    )


@app.delete("/v1/agents/{agent_id}/knowledge-bases/{assignment_id}")
def delete_agent_kb_assignment(
    agent_id: str,
    assignment_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_agent_identity_for_access(agent_id, user, "agent:create")
    deleted = store.delete_agent_kb_assignment(assignment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return {"deleted": True}


@app.post("/v1/knowledge-bases/{kb_id}/query")
def query_knowledge_base(
    kb_id: str,
    body: api_schemas.KBQueryRequest,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "read")
    source_config = kb.get("source_config") if isinstance(kb.get("source_config"), dict) else {}
    embedding_model = (
        source_config.get("embedding_model") or kb.get("embedding_model") or "nomic-embed-text"
    )
    docs = KnowledgeRetrievalService(
        store,
        embedding_provider=OllamaEmbeddingProvider(model_name=str(embedding_model)),
    ).query(
        kb_id,
        body.query,
        kb["environment"],
        top_k=body.top_k,
        score_threshold=body.score_threshold,
    )
    return [{"content": d.content, "score": d.score, "metadata": d.metadata} for d in docs]
