from __future__ import annotations

import os
from typing import Any
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent_governance.customer_agent import run_customer_support_agent
from agent_governance.db import init_db
from agent_governance.multi_agent import run_customer_support_workflow
from agent_governance.policy import load_policy, policy_to_dict
from agent_governance.runner import GovernedToolRunner
from agent_governance.settings import load_settings
from agent_governance.store import GovernanceStore
from agent_governance.tools import build_customer_tool_registry


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
    description="Governance API with agent marketplace, tool marketplace, SDK, and microservice integrations.",
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
    agent_type: str = "custom_agent"
    owner: str = "Unassigned"
    environment: str = "demo"
    purpose: str
    permissions: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ToolCreateRequest(BaseModel):
    tool_name: str
    display_name: str | None = None
    category: str = "custom"
    description: str = ""
    access_model: str = "grant_required"
    environment: str = "demo"
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowDefinitionRequest(BaseModel):
    workflow_definition_id: str
    name: str
    description: str = ""
    owner: str = "Unassigned"
    environment: str = "demo"
    lead_agent_id: str
    trigger_type: str = "manual"
    steps: list[dict[str, Any]] = Field(default_factory=list)
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
        raise HTTPException(status_code=403, detail="No environment access has been assigned to this user")
    if environment in (None, "all"):
        return allowed
    if environment not in allowed:
        raise HTTPException(status_code=403, detail=f"Role {user['role']} cannot access {environment}")
    return environment


def require_environment_access(user: dict[str, Any], environment: str | None, permission: str = "read") -> None:
    if user["is_super_admin"]:
        return
    if not environment or not store.user_has_permission(user, environment, permission):
        raise HTTPException(
            status_code=403,
            detail=f"Role {user['role']} cannot perform {permission} in {environment or 'this environment'}",
        )


@app.on_event("startup")
def startup() -> None:
    if settings.auto_init_db:
        init_db(settings.database_url)
        store.seed_demo_data()


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
def create_user(request: UserCreateRequest, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
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
def tools(user: dict[str, Any] = Depends(current_user)) -> list[str]:
    return registry.names()


@app.get("/v1/tool-marketplace")
def tool_marketplace(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return registry.marketplace()


@app.get("/v1/policies")
def policies(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {
        "policy_path": settings.policy_path,
        "environment_scope": "global",
        "policy": policy_to_dict(load_policy(settings.policy_path)),
    }


@app.get("/v1/agents")
def agents(environment: str | None = None, user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return store.list_agents(environment=visible_environment(environment, user))


@app.get("/v1/environments")
def environments(user: dict[str, Any] = Depends(current_user)) -> list[str]:
    if user["is_super_admin"]:
        return store.list_environments()
    return user["allowed_environments"]


@app.get("/v1/me")
def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return user


@app.get("/v1/agent-marketplace")
def agent_marketplace(environment: str | None = None, user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return [
        {
            **agent,
            "marketplace_status": "available",
            "access_model": "identity_and_tool_grants",
        }
        for agent in store.list_agents(environment=visible_environment(environment, user))
    ]


@app.get("/v1/agents/{agent_id}")
def agent_identity(agent_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    identity = store.get_agent_identity(agent_id)
    require_environment_access(user, identity.get("environment"), "read")
    return identity


@app.post("/v1/agents")
def create_agent(request: AgentCreateRequest, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    require_environment_access(user, request.environment, "agent:create")
    return store.upsert_agent_identity(request.model_dump())


@app.post("/v1/tool-marketplace")
def create_tool(request: ToolCreateRequest, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    require_environment_access(user, request.environment, "tool:create")
    if request.tool_name in registry.names():
        raise HTTPException(status_code=400, detail="Tool already exists")
    return registry.register_configured_tool(request.model_dump())


@app.get("/v1/workflow-marketplace")
def workflow_marketplace(
    environment: str | None = None,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    return store.list_workflow_definitions(environment=visible_environment(environment, user))


@app.post("/v1/workflow-marketplace")
def create_workflow_definition(
    request: WorkflowDefinitionRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_environment_access(user, request.environment, "workflow:create")
    if not request.steps:
        raise HTTPException(status_code=400, detail="Workflow definition needs at least one step")
    return store.upsert_workflow_definition(request.model_dump())


@app.post("/v1/agents/{agent_id}/tool-grants")
def grant_agent_tool(agent_id: str, request: AgentToolGrantRequest, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if request.tool_name not in registry.names():
        raise HTTPException(status_code=400, detail="Unknown tool")
    require_environment_access(user, store.agent_environment(agent_id), "tool:grant")
    return store.grant_agent_tool(agent_id, request.tool_name)


@app.delete("/v1/agents/{agent_id}/tool-grants/{tool_name}")
def revoke_agent_tool(agent_id: str, tool_name: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if tool_name not in registry.names():
        raise HTTPException(status_code=400, detail="Unknown tool")
    require_environment_access(user, store.agent_environment(agent_id), "tool:grant")
    return store.revoke_agent_tool(agent_id, tool_name)


@app.post("/v1/evaluate-tool-call")
def evaluate_tool_call(request: ToolCallRequest, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    require_environment_access(user, store.agent_environment(request.agent_id), "agent:run")
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
def governed_tool_call(request: ToolCallRequest, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    require_environment_access(user, store.agent_environment(request.agent_id), "agent:run")
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
def agent_run(request: AgentRunRequest, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    require_environment_access(user, store.agent_environment(request.agent_id), "agent:run")
    runner = build_runner(request.agent_id)
    return run_customer_support_agent(runner=runner, query=request.query, session_id=request.session_id)


@app.post("/v1/multi-agent-runs")
def multi_agent_run(request: MultiAgentRunRequest, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    workflow_definition = None
    if request.workflow_definition_id:
        workflow_definition = store.get_workflow_definition(request.workflow_definition_id)
        if not workflow_definition:
            raise HTTPException(status_code=404, detail="Workflow definition not found")
        require_environment_access(user, workflow_definition["environment"], "workflow:run")
    else:
        require_environment_access(user, store.agent_environment("customer-support-lead-agent"), "workflow:run")
    return run_customer_support_workflow(
        database_url=settings.database_url,
        policy_path=settings.policy_path,
        tools=registry,
        query=request.query,
        workflow_definition=workflow_definition,
    )


@app.get("/v1/workflows")
def workflows(limit: int = 50, environment: str | None = None, user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return store.list_agent_workflows(limit=limit, environment=visible_environment(environment, user))


@app.get("/v1/workflows/{workflow_id}")
def workflow_detail(workflow_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
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
) -> list[dict[str, Any]]:
    return store.list_audit_events(
        limit=limit,
        environment=visible_environment(environment, user),
        workflow_only=workflow_only,
    )


@app.get("/v1/review-queue")
def review_queue(limit: int = 100, environment: str | None = None, user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return store.list_review_queue(limit=limit, environment=visible_environment(environment, user))


@app.post("/v1/review-queue/{review_id}/resolve")
def resolve_review(review_id: str, request: ResolveReviewRequest, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    environment = store.review_environment(review_id)
    if environment is None:
        raise HTTPException(status_code=404, detail="Review item not found")
    require_environment_access(user, environment, "review:resolve")
    updated = store.resolve_review_item(review_id, request.status, request.reviewer_note)
    if not updated:
        raise HTTPException(status_code=404, detail="Review item not found")
    return {"review_id": review_id, "status": request.status}


@app.get("/v1/sessions")
def sessions(limit: int = 50, environment: str | None = None, user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return store.list_sessions(limit=limit, environment=visible_environment(environment, user))


@app.get("/v1/sessions/{session_id}/workflow")
def workflow(session_id: str, user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    environment = store.session_environment(session_id)
    if environment is None:
        raise HTTPException(status_code=404, detail="Session not found")
    require_environment_access(user, environment, "read")
    return store.workflow_for_session(session_id)
