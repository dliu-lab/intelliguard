from __future__ import annotations

import os
from typing import Any, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent_governance.customer_agent import run_customer_support_agent
from agent_governance.db import init_db
from agent_governance.models import utc_now
from agent_governance.multi_agent import run_customer_support_workflow
from agent_governance.policy import load_policy, policy_to_dict
from agent_governance.runner import GovernedToolRunner
from agent_governance.settings import load_settings
from agent_governance.store import GovernanceStore
from agent_governance.tools import build_customer_tool_registry
from agent_governance.workflow_graph import WorkflowGraphError


settings = load_settings()
registry = build_customer_tool_registry()
store = GovernanceStore(settings.database_url)


def build_runner(agent_id: str) -> GovernedToolRunner:
    return GovernedToolRunner(
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ToolCallRequest(BaseModel):
    agent_id: str = "customer-support-agent"
    session_id: str = Field(default_factory=lambda: f"sess_{uuid4().hex[:12]}")
    user_query: str
    tool_name: str
    tool_args: dict[str, Any] = Field(default_factory=dict)


class AgentRunRequest(BaseModel):
    query: str
    agent_id: str = "customer-support-agent"
    session_id: str | None = None


class MultiAgentRunRequest(BaseModel):
    query: str
    workflow_definition_id: str | None = None


class ResolveReviewRequest(BaseModel):
    status: str = Field(pattern="^(APPROVED|DENIED)$")
    reviewer_note: str | None = None


class AgentToolGrantRequest(BaseModel):
    tool_name: str


class AgentCreateRequest(BaseModel):
    agent_id: str
    display_name: str
    agent_type: str = "task_agent"
    owner: str = "Unassigned"
    environment: str = "demo"
    purpose: str
    permissions: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ToolCreateRequest(BaseModel):
    tool_name: str
    display_name: str | None = None
    domain: str | None = None
    category: str = "custom"
    description: str = ""
    side_effect_level: str = "read_only"
    access_model: str | None = None
    environment: str = "demo"
    owner: str = "Unassigned"
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    permissions: dict[str, Any] = Field(default_factory=dict)
    allowed_actions: list[str] = Field(default_factory=list)
    artifact_digest: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowDefinitionRequest(BaseModel):
    workflow_definition_id: str
    name: str
    description: str = ""
    owner: str = "Unassigned"
    environment: str = "demo"
    domain: str = "general"
    lead_agent_id: str
    trigger_type: str = "manual"
    steps: list[dict[str, Any]] = Field(default_factory=list)
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    policy_bindings: dict[str, Any] = Field(default_factory=dict)
    review_rules: dict[str, Any] = Field(default_factory=dict)
    graph_version_hash: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class LoginRequest(BaseModel):
    email: str
    password: str
    role: str | None = None


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    display_name: str
    role: str = "Agent Developer"


class UserEnvironmentGrant(BaseModel):
    environment: str
    permissions: list[str] = Field(default_factory=lambda: ["read"])


class UserCreateRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    display_name: str
    role: str = "Agent Developer"
    is_super_admin: bool = False
    environment_access: list[UserEnvironmentGrant] = Field(default_factory=list)


class GuardrailPolicyRequest(BaseModel):
    policy_id: str
    display_name: str
    description: str = ""
    environment: str = "demo"
    config: dict[str, Any] = Field(default_factory=dict)


class AgentGuardrailAssignmentRequest(BaseModel):
    policy_id: str
    mode: str = Field(pattern="^(enforce|review_only|disabled)$")
    threshold_overrides: dict[str, Any] = Field(default_factory=dict)


class AgentGuardrailAssignmentUpdateRequest(BaseModel):
    mode: str = Field(pattern="^(enforce|review_only|disabled)$")
    threshold_overrides: dict[str, Any] = Field(default_factory=dict)


class EvaluatorTemplateRequest(BaseModel):
    evaluator_id: str
    display_name: str
    evaluator_type: str
    scope: str = Field(pattern="^(agent|workflow)$")
    description: str = ""
    default_config: dict[str, Any] = Field(default_factory=dict)
    llm_enabled: bool = False


class AgentEvaluatorAssignmentRequest(BaseModel):
    evaluator_id: str
    trigger: str = Field(pattern="^(after_run|after_workflow|manual)$")
    config: dict[str, Any] = Field(default_factory=dict)


class KnowledgeBaseRequest(BaseModel):
    kb_id: str
    display_name: str
    description: str = ""
    source_type: str = Field(pattern="^(vector_store|url|file)$")
    source_config: dict[str, Any] = Field(default_factory=dict)
    environment: str = "demo"


class AgentKBAssignmentRequest(BaseModel):
    kb_id: str
    access_mode: str = Field(pattern="^(read|read_write)$", default="read")
    retrieval_mode: str = Field(pattern="^(semantic|keyword|hybrid)$", default="hybrid")
    top_k: int = Field(default=5, ge=1, le=50)
    score_threshold: float | None = Field(default=None, ge=0, le=1)
    citation_required: bool = True
    freshness_days: int | None = Field(default=None, ge=1, le=3650)
    metadata_filters: dict[str, Any] = Field(default_factory=dict)


class KBQueryRequest(BaseModel):
    query: str
    top_k: int = Field(default=5, ge=1, le=50)


class AuditEventResponse(BaseModel):
    event_id: str
    session_id: str
    workflow_id: str | None
    agent_id: str
    environment: str | None
    risk_type: str
    decision: str
    reason: str
    tool_name: str | None
    risk_score: int
    policy_id: str | None
    stage: str | None
    policy_snapshot_hash: str | None
    metadata: dict[str, Any]
    created_at: str


class ReviewQueueItemResponse(BaseModel):
    review_id: str
    session_id: str
    workflow_id: str | None
    agent_id: str
    environment: str | None
    tool_name: str
    tool_args: dict[str, Any]
    user_query: str
    risk_score: int
    risk_types: list[str]
    reason: str
    status: str
    reviewer_note: str | None
    resolved_at: str | None
    created_at: str


def bearer_token(authorization: str | None = Header(default=None, alias="Authorization")) -> str:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    return token


def current_user(token: str = Depends(bearer_token)) -> dict[str, Any]:
    user = store.user_context_for_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


def require_super_admin(user: dict[str, Any]) -> None:
    if not user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Super admin access required")


def visible_environment(environment: str | None, user: dict[str, Any]) -> str | list[str] | None:
    if user["is_super_admin"]:
        return None if environment in (None, "all") else environment
    allowed = user["allowed_environments"]
    if not allowed:
        raise HTTPException(
            status_code=403, detail="No environment access has been assigned to this user"
        )
    if environment in (None, "all"):
        return allowed
    if environment not in allowed:
        raise HTTPException(
            status_code=403, detail=f"Role {user['role']} cannot access {environment}"
        )
    return environment


def require_environment_access(
    user: dict[str, Any], environment: str | None, permission: str = "read"
) -> None:
    if user["is_super_admin"]:
        return
    if not environment or not store.user_has_permission(user, environment, permission):
        raise HTTPException(
            status_code=403,
            detail=f"Role {user['role']} cannot perform {permission} in {environment or 'this environment'}",
        )


def require_agent_identity_for_access(
    agent_id: str, user: dict[str, Any], permission: str = "read"
) -> dict[str, Any]:
    identity = store.find_agent_identity(agent_id)
    if not identity:
        raise HTTPException(status_code=404, detail="Agent not found")
    require_environment_access(user, identity.get("environment"), permission)
    return identity


def _tool_payload(request: ToolCreateRequest) -> dict[str, Any]:
    payload = request.model_dump()
    access_model = payload.pop("access_model", None)
    domain = payload.pop("domain", None)
    metadata = dict(payload.get("metadata") or {})
    if domain and "domain" not in metadata:
        metadata["domain"] = domain
    payload["metadata"] = metadata
    permissions = dict(payload.get("permissions") or {})
    if access_model and "access_model" not in permissions:
        permissions["access_model"] = access_model
    if permissions and "requires_grant" not in permissions:
        permissions["requires_grant"] = permissions.get("access_model") != "public"
    payload["permissions"] = permissions or {"requires_grant": True}
    return payload


def _sync_configured_tools_into_runtime() -> None:
    for tool in store.list_tool_records():
        tool_name = str(tool.get("tool_name") or "")
        if tool_name and tool_name not in registry.names():
            registry.register_configured_tool(tool)


def _agent_assignments_for_evaluation(agent: dict[str, Any]) -> dict[str, Any]:
    agent_id = str(agent["agent_id"])
    agent_tools = (agent.get("permissions") or {}).get("tools") or []
    tool_records = [
        tool
        for tool_name in agent_tools
        if (tool := store.get_tool_record_by_name(str(tool_name))) is not None
    ]
    return {
        "evaluators": store.list_agent_evaluator_assignments(agent_id),
        "guardrails": store.list_agent_guardrail_assignments(agent_id),
        "knowledge": store.list_agent_kb_assignments(agent_id),
        "tools": tool_records,
    }


def _workflow_assignments_for_evaluation(workflow: dict[str, Any]) -> dict[str, Any]:
    agent_ids = {
        str(workflow.get("lead_agent_id") or ""),
        *[
            str(node.get("agent_id") or "")
            for node in workflow.get("nodes", [])
            if isinstance(node, dict) and node.get("agent_id")
        ],
        *[
            str(step.get("agent_id") or "")
            for step in workflow.get("steps", [])
            if isinstance(step, dict) and step.get("agent_id")
        ],
    }
    agents = [
        agent
        for agent_id in sorted(agent_ids)
        if agent_id and (agent := store.find_agent_identity(agent_id)) is not None
    ]
    return {
        "agents": agents,
        "agent_certifications": {
            agent["agent_id"]: store.get_agent_certification(str(agent["agent_id"]))
            for agent in agents
        },
    }


@app.on_event("startup")
def startup() -> None:
    if settings.auto_init_db:
        init_db(settings.database_url)
    if settings.seed_demo_data:
        store.seed_demo_data()
    _sync_configured_tools_into_runtime()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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
def register(request: RegisterRequest) -> dict[str, Any]:
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
def login(request: LoginRequest) -> dict[str, Any]:
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
    request: UserCreateRequest, user: dict[str, Any] = Depends(current_user)
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
    request: AgentCreateRequest, user: dict[str, Any] = Depends(current_user)
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

    from agent_governance.evaluation.agent_evaluators import (
        compute_agent_config_hash,
        run_agent_evaluators,
    )
    from agent_governance.evaluation.certification import (
        CertificationError,
        decide_certification,
        validate_transition,
    )

    agent = store.find_agent_identity(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    require_environment_access(user, agent.get("environment"), "agent:create")

    assignments = _agent_assignments_for_evaluation(agent)
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
    request: ToolCreateRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    require_environment_access(user, request.environment, "tool:create")
    try:
        tool = store.create_tool_record(_tool_payload(request))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if request.tool_name not in registry.names():
        registry.register_configured_tool(tool)
    return tool


@app.put("/v1/tools/{tool_id}")
def update_tool(
    tool_id: str,
    request: ToolCreateRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    existing = store.get_tool_record(tool_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Tool not found")
    require_environment_access(user, existing.get("environment"), "tool:create")
    require_environment_access(user, request.environment, "tool:create")
    try:
        tool = store.upsert_tool_record({"tool_id": tool_id, **_tool_payload(request)})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if request.tool_name not in registry.names():
        registry.register_configured_tool(tool)
    return tool


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

    from agent_governance.evaluation.certification import (
        CertificationError,
        decide_certification,
        validate_transition,
    )
    from agent_governance.evaluation.tool_evaluators import run_tool_evaluators

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
    from agent_governance.monitoring import build_monitoring_metrics

    return build_monitoring_metrics(store, visible_environment(environment, user))


@app.get("/v1/workflow-definitions")
def workflow_definitions(
    environment: str | None = None,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    return store.list_workflow_definitions(environment=visible_environment(environment, user))


@app.post("/v1/workflow-definitions")
def create_workflow_definition(
    request: WorkflowDefinitionRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    from agent_governance.evaluation.enforcement import (
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
    except WorkflowGraphError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/v1/workflow-definitions/{workflow_definition_id}/evaluate")
def evaluate_workflow_definition(
    workflow_definition_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    from time import monotonic

    from agent_governance.evaluation.certification import (
        CertificationError,
        decide_certification,
        validate_transition,
    )
    from agent_governance.evaluation.workflow_evaluators import (
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
        workflow, _workflow_assignments_for_evaluation(workflow)
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
    agent_id: str, request: AgentToolGrantRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    from agent_governance.evaluation.enforcement import (
        CertificationEnforcementError,
        check_tool_certification,
    )

    tool = store.get_tool_record_by_name(request.tool_name)
    if not tool:
        raise HTTPException(status_code=400, detail="Unknown tool")
    agent = require_agent_identity_for_access(agent_id, user, "tool:grant")
    agent_environment = str(agent["environment"])
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
    request: ToolCallRequest, user: dict[str, Any] = Depends(current_user)
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
    request: ToolCallRequest, user: dict[str, Any] = Depends(current_user)
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
    request: AgentRunRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    require_agent_identity_for_access(request.agent_id, user, "agent:run")
    runner = build_runner(request.agent_id)
    return run_customer_support_agent(
        runner=runner, query=request.query, session_id=request.session_id
    )


@app.post("/v1/multi-agent-runs")
def multi_agent_run(
    request: MultiAgentRunRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    from agent_governance.evaluation.enforcement import (
        CertificationEnforcementError,
        check_workflow_certification,
    )

    workflow_definition = None
    if not request.workflow_definition_id:
        raise HTTPException(
            status_code=400,
            detail="workflow_definition_id is required. Create and select a workflow definition before running.",
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
        return run_customer_support_workflow(
            database_url=settings.database_url,
            policy_path=settings.policy_path,
            tools=registry,
            query=request.query,
            workflow_definition=workflow_definition,
        )
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


@app.get("/v1/audit-events")
def audit_events(
    limit: int = 100,
    environment: str | None = None,
    workflow_only: bool = False,
    user: dict[str, Any] = Depends(current_user),
) -> list[AuditEventResponse]:
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
) -> list[ReviewQueueItemResponse]:
    return store.list_review_queue(
        limit=limit,
        environment=visible_environment(environment, user),
        status=status,
    )


@app.post("/v1/review-queue/{review_id}/resolve")
def resolve_review(
    review_id: str, request: ResolveReviewRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    environment = store.review_environment(review_id)
    if environment is None:
        raise HTTPException(status_code=404, detail="Review item not found")
    require_environment_access(user, environment, "review:resolve")
    if request.status == "DENIED" and not (request.reviewer_note or "").strip():
        raise HTTPException(
            status_code=400, detail="Reviewer note is required when denying a review"
        )
    updated = store.resolve_review_item(review_id, request.status, request.reviewer_note)
    if not updated:
        raise HTTPException(status_code=404, detail="Review item not found")
    return {"review_id": review_id, "status": request.status}


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
    request: GuardrailPolicyRequest,
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
    request: GuardrailPolicyRequest,
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
    request: AgentGuardrailAssignmentRequest,
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
    request: AgentGuardrailAssignmentUpdateRequest,
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


@app.post("/v1/evaluator-templates")
def create_evaluator_template(
    request: EvaluatorTemplateRequest,
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
    request: AgentEvaluatorAssignmentRequest,
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
    from agent_governance.evaluators import EvaluatorEngine

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
    body: KnowledgeBaseRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_environment_access(user, body.environment, "agent:create")
    return store.upsert_knowledge_base(body.model_dump())


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
    body: AgentKBAssignmentRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_agent_identity_for_access(agent_id, user, "agent:create")
    kb = store.get_knowledge_base(body.kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
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
    body: KBQueryRequest,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "read")
    try:
        from agent_governance.knowledge import KBRetrieval
        from agent_governance.advisor import AdvisorRAG  # type: ignore[import]

        retrieval = KBRetrieval(AdvisorRAG(store))
        docs = retrieval.query(kb_id, body.query, kb["environment"], top_k=body.top_k)
        return [{"content": d.content, "score": d.score, "metadata": d.metadata} for d in docs]
    except ImportError:
        return []
