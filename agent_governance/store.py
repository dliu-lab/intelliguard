from __future__ import annotations

from contextlib import contextmanager
from datetime import timedelta
from typing import Any, Iterator

from sqlalchemy import desc, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from agent_governance.auth import hash_password, hash_token, new_session_token, verify_password
from agent_governance.db import build_session_factory, seed_demo_data
from agent_governance.models import (
    AgentIdentity,
    AgentSession,
    AgentWorkflow,
    AuditEvent,
    PolicyDecision,
    ReviewQueueItem,
    ToolCall,
    User,
    UserSession,
    UserEnvironmentAccess,
    WorkflowDefinition,
    WorkflowSessionLink,
    WorkflowEvent,
    new_id,
    utc_now,
)


DEFAULT_AGENT_PERMISSIONS = {
    "tools": ["get_customer_profile", "get_customer_transactions"],
    "actions": ["read_customer_profile", "read_transactions"],
    "scopes": {"customer_access": "customer_id", "pii_exposure": "blocked_by_default"},
}

SIGNUP_ROLE_ACCESS = {
    "Governance Reviewer": {
        "is_super_admin": False,
        "access": {
            "demo": ["read", "review:resolve"],
            "staging": ["read", "review:resolve"],
        },
    },
    "Support Operations Manager": {
        "is_super_admin": False,
        "access": {
            "demo": ["read", "agent:run", "workflow:run", "tool:grant", "review:resolve"],
            "staging": ["read", "agent:create", "agent:run", "workflow:create", "workflow:run", "tool:create", "tool:grant", "review:resolve"],
        },
    },
    "Agent Developer": {
        "is_super_admin": False,
        "access": {
            "local": ["read", "agent:create", "agent:run", "workflow:create", "workflow:run", "tool:create", "tool:grant"],
            "staging": ["read", "agent:create", "agent:run", "workflow:create", "workflow:run", "tool:create", "tool:grant"],
        },
    },
}


class GovernanceStore:
    def __init__(self, database_url: str):
        self.session_factory: sessionmaker[Session] = build_session_factory(database_url)

    @contextmanager
    def session(self) -> Iterator[Session]:
        db = self.session_factory()
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def seed_demo_data(self) -> None:
        with self.session() as db:
            seed_demo_data(db)

    def has_password_users(self) -> bool:
        with self.session() as db:
            return bool(db.scalar(select(func.count()).select_from(User).where(User.password_hash.is_not(None))) or 0)

    def register_user(self, *, email: str, password: str, display_name: str, role: str) -> dict[str, Any]:
        email = email.strip().lower()
        with self.session() as db:
            existing_auth_users = db.scalar(
                select(func.count()).select_from(User).where(User.password_hash.is_not(None))
            )
            is_initial_admin = not existing_auth_users
            if is_initial_admin and role != "Governance Lead":
                raise ValueError("The first account must be the Governance Lead admin")
            if not is_initial_admin and role == "Governance Lead":
                raise ValueError("Governance Lead admin can only be created during initial setup")
            if not is_initial_admin and role not in SIGNUP_ROLE_ACCESS:
                raise ValueError("Unknown role")

            user = db.get(User, email)
            if user and user.password_hash:
                raise ValueError("User already exists")

            is_super_admin = is_initial_admin and role == "Governance Lead"
            if not user:
                user = User(
                    user_id=email,
                    email=email,
                    display_name=display_name,
                    role=role,
                    is_super_admin=is_super_admin,
                    password_hash=hash_password(password),
                )
                db.add(user)
            else:
                user.display_name = display_name
                user.role = role
                user.is_super_admin = is_super_admin
                user.password_hash = hash_password(password)
                user.updated_at = utc_now()

            if is_super_admin:
                for environment in self._base_environments(db):
                    self._upsert_environment_access(db, email, environment, ["*"])
            else:
                for environment, permissions in SIGNUP_ROLE_ACCESS[role]["access"].items():
                    self._upsert_environment_access(db, email, environment, permissions)

            db.flush()
            return self._user_context_from_row(db, user)

    def authenticate_user(self, *, email: str, password: str) -> tuple[dict[str, Any], str]:
        email = email.strip().lower()
        with self.session() as db:
            user = db.get(User, email)
            if not user or not verify_password(password, user.password_hash):
                raise ValueError("Invalid email or password")

            token = new_session_token()
            session = UserSession(
                session_id=new_id("usr_sess"),
                user_id=user.user_id,
                token_hash=hash_token(token),
                expires_at=utc_now() + timedelta(hours=12),
            )
            db.add(session)
            user.updated_at = utc_now()
            db.flush()
            return self._user_context_from_row(db, user), token

    def user_context_for_token(self, token: str) -> dict[str, Any] | None:
        with self.session() as db:
            session = db.scalar(
                select(UserSession).where(
                    UserSession.token_hash == hash_token(token),
                    UserSession.revoked_at.is_(None),
                    UserSession.expires_at > utc_now(),
                )
            )
            if not session:
                return None
            user = db.get(User, session.user_id)
            if not user or not user.password_hash:
                return None
            return self._user_context_from_row(db, user)

    def revoke_user_session(self, token: str) -> bool:
        with self.session() as db:
            session = db.scalar(
                select(UserSession).where(
                    UserSession.token_hash == hash_token(token),
                    UserSession.revoked_at.is_(None),
                )
            )
            if not session:
                return False
            session.revoked_at = utc_now()
            return True

    def create_user(
        self,
        *,
        email: str,
        password: str,
        display_name: str,
        role: str,
        is_super_admin: bool,
        environment_access: list[dict[str, Any]],
    ) -> dict[str, Any]:
        email = email.strip().lower()
        with self.session() as db:
            if is_super_admin or role == "Governance Lead":
                existing_admins = db.scalar(
                    select(func.count())
                    .select_from(User)
                    .where(User.password_hash.is_not(None), User.is_super_admin.is_(True))
                )
                if existing_admins:
                    raise ValueError("Governance Lead admin has already been created")
                role = "Governance Lead"
                is_super_admin = True

            user = db.get(User, email)
            if user and user.password_hash:
                raise ValueError("User already exists")
            if user:
                user.display_name = display_name
                user.role = role
                user.is_super_admin = is_super_admin
                user.password_hash = hash_password(password)
                user.updated_at = utc_now()
            else:
                user = User(
                    user_id=email,
                    email=email,
                    display_name=display_name,
                    role=role,
                    is_super_admin=is_super_admin,
                    password_hash=hash_password(password),
                )
                db.add(user)

            for item in environment_access:
                self._upsert_environment_access(
                    db,
                    email,
                    item["environment"],
                    item.get("permissions") or ["read"],
                )

            db.flush()
            return self._user_context_from_row(db, user)

    def list_users(self) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(select(User).order_by(User.email)).all()
            return [self._user_context_from_row(db, row) for row in rows if row.password_hash]

    def ensure_agent_identity(self, agent_id: str) -> dict[str, Any]:
        with self.session() as db:
            identity = db.get(AgentIdentity, agent_id)
            if not identity:
                identity = AgentIdentity(
                    agent_id=agent_id,
                    display_name=agent_id.replace("-", " ").title(),
                    agent_type="custom_agent",
                    owner="Unassigned",
                    environment="local",
                    purpose="Auto-registered agent. Review and grant permissions before production use.",
                    permissions=DEFAULT_AGENT_PERMISSIONS,
                    metadata_json={"identity_provider": "auto-registered"},
                )
                db.add(identity)
                db.flush()
            return self._agent_identity_to_dict(identity)

    def list_agents(self, environment: str | list[str] | None = None) -> list[dict[str, Any]]:
        with self.session() as db:
            stmt = select(AgentIdentity).order_by(AgentIdentity.agent_id)
            if isinstance(environment, list):
                stmt = stmt.where(AgentIdentity.environment.in_(environment))
            elif environment and environment != "all":
                stmt = stmt.where(AgentIdentity.environment == environment)
            rows = db.scalars(stmt).all()
            return [self._agent_identity_to_dict(row) for row in rows]

    def list_environments(self) -> list[str]:
        with self.session() as db:
            agent_envs = db.scalars(select(AgentIdentity.environment).distinct()).all()
            access_envs = db.scalars(select(UserEnvironmentAccess.environment).distinct()).all()
            workflow_envs = db.scalars(select(WorkflowDefinition.environment).distinct()).all()
            rows = sorted(set(agent_envs) | set(access_envs) | set(workflow_envs))
            return [row for row in rows if row]

    def agent_environment(self, agent_id: str) -> str:
        with self.session() as db:
            identity = db.get(AgentIdentity, agent_id)
            return identity.environment if identity else "local"

    def get_agent_identity(self, agent_id: str) -> dict[str, Any]:
        return self.ensure_agent_identity(agent_id)

    def upsert_agent_identity(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            identity = db.get(AgentIdentity, payload["agent_id"])
            if not identity:
                identity = AgentIdentity(
                    agent_id=payload["agent_id"],
                    display_name=payload["display_name"],
                    agent_type=payload["agent_type"],
                    owner=payload["owner"],
                    environment=payload["environment"],
                    purpose=payload["purpose"],
                    permissions=payload.get("permissions") or {},
                    metadata_json=payload.get("metadata") or {},
                )
                db.add(identity)
            else:
                identity.display_name = payload["display_name"]
                identity.agent_type = payload["agent_type"]
                identity.owner = payload["owner"]
                identity.environment = payload["environment"]
                identity.purpose = payload["purpose"]
                identity.permissions = payload.get("permissions") or {}
                identity.metadata_json = payload.get("metadata") or {}
                identity.updated_at = utc_now()
            db.flush()
            return self._agent_identity_to_dict(identity)

    def list_workflow_definitions(self, environment: str | list[str] | None = None) -> list[dict[str, Any]]:
        with self.session() as db:
            stmt = select(WorkflowDefinition).order_by(WorkflowDefinition.name)
            if isinstance(environment, list):
                stmt = stmt.where(WorkflowDefinition.environment.in_(environment))
            elif environment and environment != "all":
                stmt = stmt.where(WorkflowDefinition.environment == environment)
            rows = db.scalars(stmt).all()
            return [self._workflow_definition_to_dict(row) for row in rows]

    def get_workflow_definition(self, workflow_definition_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            definition = db.get(WorkflowDefinition, workflow_definition_id)
            return self._workflow_definition_to_dict(definition) if definition else None

    def workflow_definition_environment(self, workflow_definition_id: str) -> str | None:
        with self.session() as db:
            definition = db.get(WorkflowDefinition, workflow_definition_id)
            return definition.environment if definition else None

    def upsert_workflow_definition(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            definition = db.get(WorkflowDefinition, payload["workflow_definition_id"])
            if not definition:
                definition = WorkflowDefinition(
                    workflow_definition_id=payload["workflow_definition_id"],
                    name=payload["name"],
                    description=payload["description"],
                    owner=payload["owner"],
                    environment=payload["environment"],
                    lead_agent_id=payload["lead_agent_id"],
                    trigger_type=payload.get("trigger_type") or "manual",
                    steps=payload.get("steps") or [],
                    metadata_json=payload.get("metadata") or {},
                )
                db.add(definition)
            else:
                definition.name = payload["name"]
                definition.description = payload["description"]
                definition.owner = payload["owner"]
                definition.environment = payload["environment"]
                definition.lead_agent_id = payload["lead_agent_id"]
                definition.trigger_type = payload.get("trigger_type") or "manual"
                definition.steps = payload.get("steps") or []
                definition.metadata_json = payload.get("metadata") or {}
                definition.updated_at = utc_now()
            db.flush()
            return self._workflow_definition_to_dict(definition)

    def grant_agent_tool(self, agent_id: str, tool_name: str) -> dict[str, Any]:
        with self.session() as db:
            identity = db.get(AgentIdentity, agent_id)
            if not identity:
                identity = AgentIdentity(
                    agent_id=agent_id,
                    display_name=agent_id.replace("-", " ").title(),
                    agent_type="custom_agent",
                    owner="Unassigned",
                    environment="local",
                    purpose="Auto-registered agent.",
                    permissions=DEFAULT_AGENT_PERMISSIONS,
                    metadata_json={"identity_provider": "auto-registered"},
                )
                db.add(identity)

            permissions = dict(identity.permissions or {})
            tools = sorted(set(permissions.get("tools", [])) | {tool_name})
            permissions["tools"] = tools
            identity.permissions = permissions
            identity.updated_at = utc_now()
            db.flush()
            return self._agent_identity_to_dict(identity)

    def revoke_agent_tool(self, agent_id: str, tool_name: str) -> dict[str, Any]:
        with self.session() as db:
            identity = db.get(AgentIdentity, agent_id)
            if not identity:
                identity = AgentIdentity(
                    agent_id=agent_id,
                    display_name=agent_id.replace("-", " ").title(),
                    agent_type="custom_agent",
                    owner="Unassigned",
                    environment="local",
                    purpose="Auto-registered agent.",
                    permissions=DEFAULT_AGENT_PERMISSIONS,
                    metadata_json={"identity_provider": "auto-registered"},
                )
                db.add(identity)

            permissions = dict(identity.permissions or {})
            permissions["tools"] = [tool for tool in permissions.get("tools", []) if tool != tool_name]
            identity.permissions = permissions
            identity.updated_at = utc_now()
            db.flush()
            return self._agent_identity_to_dict(identity)

    def ensure_agent_session(self, session_id: str, agent_id: str, user_query: str) -> None:
        self.ensure_agent_identity(agent_id)
        with self.session() as db:
            existing = db.get(AgentSession, session_id)
            if existing:
                existing.updated_at = utc_now()
                return
            db.add(AgentSession(session_id=session_id, agent_id=agent_id, user_query=user_query))

    def update_session_status(self, session_id: str, status: str) -> None:
        with self.session() as db:
            db.execute(
                update(AgentSession)
                .where(AgentSession.session_id == session_id)
                .values(status=status, updated_at=utc_now())
            )

    def create_agent_workflow(
        self,
        *,
        name: str,
        user_goal: str,
        lead_agent_id: str,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        workflow_id = new_id("flow")
        self.ensure_agent_identity(lead_agent_id)
        with self.session() as db:
            db.add(
                AgentWorkflow(
                    workflow_id=workflow_id,
                    name=name,
                    user_goal=user_goal,
                    lead_agent_id=lead_agent_id,
                    status="RUNNING",
                    metadata_json=metadata or {},
                )
            )
        return workflow_id

    def link_session_to_workflow(
        self,
        *,
        workflow_id: str,
        session_id: str,
        agent_id: str,
        role: str,
        parent_session_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        self.ensure_agent_identity(agent_id)
        with self.session() as db:
            existing = db.scalar(
                select(WorkflowSessionLink).where(
                    WorkflowSessionLink.workflow_id == workflow_id,
                    WorkflowSessionLink.session_id == session_id,
                )
            )
            if existing:
                return existing.link_id

            sequence = (
                db.scalar(
                    select(func.coalesce(func.max(WorkflowSessionLink.sequence), 0)).where(
                        WorkflowSessionLink.workflow_id == workflow_id
                    )
                )
                or 0
            ) + 1
            link = WorkflowSessionLink(
                link_id=new_id("wsl"),
                workflow_id=workflow_id,
                session_id=session_id,
                agent_id=agent_id,
                role=role,
                parent_session_id=parent_session_id,
                sequence=sequence,
                metadata_json=metadata or {},
            )
            db.add(link)
            db.flush()
            return link.link_id

    def update_agent_workflow(
        self,
        *,
        workflow_id: str,
        status: str,
        decision: str | None = None,
        summary: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        with self.session() as db:
            workflow = db.get(AgentWorkflow, workflow_id)
            if not workflow:
                return
            workflow.status = status
            workflow.decision = decision
            workflow.summary = summary
            if metadata is not None:
                workflow.metadata_json = metadata
            workflow.updated_at = utc_now()

    def add_workflow_event(
        self,
        *,
        session_id: str,
        agent_id: str,
        event_type: str,
        label: str,
        status: str,
        payload: dict[str, Any] | None = None,
    ) -> WorkflowEvent:
        with self.session() as db:
            sequence = (
                db.scalar(
                    select(func.coalesce(func.max(WorkflowEvent.sequence), 0)).where(
                        WorkflowEvent.session_id == session_id
                    )
                )
                or 0
            ) + 1
            event = WorkflowEvent(
                event_id=new_id("wf"),
                session_id=session_id,
                agent_id=agent_id,
                sequence=sequence,
                event_type=event_type,
                label=label,
                status=status,
                payload=payload or {},
            )
            db.add(event)
            db.flush()
            return event

    def add_tool_call(
        self,
        *,
        session_id: str,
        agent_id: str,
        tool_name: str,
        tool_args: dict[str, Any],
        decision: str | None = None,
        result_summary: dict[str, Any] | None = None,
    ) -> str:
        tool_call_id = new_id("tc")
        with self.session() as db:
            db.add(
                ToolCall(
                    tool_call_id=tool_call_id,
                    session_id=session_id,
                    agent_id=agent_id,
                    tool_name=tool_name,
                    tool_args=tool_args,
                    decision=decision,
                    result_summary=result_summary or {},
                )
            )
        return tool_call_id

    def add_policy_decision(
        self,
        *,
        session_id: str,
        agent_id: str,
        tool_name: str | None,
        decision: str,
        risk_score: int,
        risk_types: list[str],
        reason: str,
        triggered_rules: list[str],
    ) -> str:
        decision_id = new_id("dec")
        with self.session() as db:
            db.add(
                PolicyDecision(
                    decision_id=decision_id,
                    session_id=session_id,
                    agent_id=agent_id,
                    tool_name=tool_name,
                    decision=decision,
                    risk_score=risk_score,
                    risk_types=risk_types,
                    reason=reason,
                    triggered_rules=triggered_rules,
                )
            )
        return decision_id

    def add_audit_event(
        self,
        *,
        session_id: str,
        agent_id: str,
        risk_type: str,
        decision: str,
        reason: str,
        tool_name: str | None,
        risk_score: int,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        event_id = new_id("evt")
        with self.session() as db:
            db.add(
                AuditEvent(
                    event_id=event_id,
                    session_id=session_id,
                    agent_id=agent_id,
                    risk_type=risk_type,
                    decision=decision,
                    reason=reason,
                    tool_name=tool_name,
                    risk_score=risk_score,
                    metadata_json=metadata or {},
                )
            )
        return event_id

    def add_review_item(
        self,
        *,
        session_id: str,
        agent_id: str,
        tool_name: str,
        tool_args: dict[str, Any],
        user_query: str,
        risk_score: int,
        risk_types: list[str],
        reason: str,
    ) -> str:
        review_id = new_id("rev")
        with self.session() as db:
            db.add(
                ReviewQueueItem(
                    review_id=review_id,
                    session_id=session_id,
                    agent_id=agent_id,
                    tool_name=tool_name,
                    tool_args=tool_args,
                    user_query=user_query,
                    risk_score=risk_score,
                    risk_types=risk_types,
                    reason=reason,
                )
            )
        return review_id

    def count_failed_tool_calls(self, session_id: str) -> int:
        with self.session() as db:
            return int(
                db.scalar(
                    select(func.count()).select_from(ToolCall).where(
                        ToolCall.session_id == session_id,
                        ToolCall.decision.in_(["BLOCK", "REVIEW"]),
                    )
                )
                or 0
            )

    def list_audit_events(
        self,
        limit: int = 100,
        environment: str | list[str] | None = None,
        workflow_only: bool = False,
    ) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(select(AuditEvent).order_by(desc(AuditEvent.created_at)).limit(limit)).all()
            events = []
            for row in rows:
                identity = db.get(AgentIdentity, row.agent_id)
                if not self._environment_matches(identity.environment if identity else None, environment):
                    continue
                workflow_link = db.scalar(
                    select(WorkflowSessionLink).where(WorkflowSessionLink.session_id == row.session_id).limit(1)
                )
                if workflow_only and not workflow_link:
                    continue
                events.append(
                    {
                    "event_id": row.event_id,
                    "session_id": row.session_id,
                    "workflow_id": workflow_link.workflow_id if workflow_link else None,
                    "agent_id": row.agent_id,
                    "agent_environment": identity.environment if identity else None,
                    "risk_type": row.risk_type,
                    "decision": row.decision,
                    "reason": row.reason,
                    "tool_name": row.tool_name,
                    "risk_score": row.risk_score,
                    "metadata": row.metadata_json,
                    "created_at": row.created_at.isoformat(),
                    }
                )
            return events

    def list_review_queue(self, limit: int = 100, environment: str | list[str] | None = None) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(ReviewQueueItem)
                .where(ReviewQueueItem.status == "PENDING")
                .order_by(desc(ReviewQueueItem.created_at))
                .limit(limit)
            ).all()
            reviews = []
            for row in rows:
                identity = db.get(AgentIdentity, row.agent_id)
                if not self._environment_matches(identity.environment if identity else None, environment):
                    continue
                reviews.append(
                    {
                    "review_id": row.review_id,
                    "session_id": row.session_id,
                    "agent_id": row.agent_id,
                    "agent_environment": identity.environment if identity else None,
                    "tool_name": row.tool_name,
                    "tool_args": row.tool_args,
                    "user_query": row.user_query,
                    "risk_score": row.risk_score,
                    "risk_types": row.risk_types,
                    "reason": row.reason,
                    "status": row.status,
                    "created_at": row.created_at.isoformat(),
                    }
                )
            return reviews

    def resolve_review_item(self, review_id: str, status: str, reviewer_note: str | None) -> bool:
        with self.session() as db:
            item = db.get(ReviewQueueItem, review_id)
            if not item:
                return False
            item.status = status
            item.reviewer_note = reviewer_note
            item.resolved_at = utc_now()
            return True

    def review_environment(self, review_id: str) -> str | None:
        with self.session() as db:
            item = db.get(ReviewQueueItem, review_id)
            if not item:
                return None
            identity = db.get(AgentIdentity, item.agent_id)
            return identity.environment if identity else None

    def list_sessions(self, limit: int = 50, environment: str | list[str] | None = None) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(select(AgentSession).order_by(desc(AgentSession.created_at)).limit(limit)).all()
            sessions = []
            for row in rows:
                identity = db.get(AgentIdentity, row.agent_id)
                if not self._environment_matches(identity.environment if identity else None, environment):
                    continue
                sessions.append(
                    {
                        "session_id": row.session_id,
                        "agent_id": row.agent_id,
                        "agent_identity": self._agent_identity_to_dict(identity) if identity else None,
                        "user_query": row.user_query,
                        "status": row.status,
                        "created_at": row.created_at.isoformat(),
                        "updated_at": row.updated_at.isoformat(),
                    }
                )
            return sessions

    def list_agent_workflows(self, limit: int = 50, environment: str | list[str] | None = None) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(AgentWorkflow).order_by(desc(AgentWorkflow.created_at)).limit(limit)
            ).all()
            workflows = []
            for row in rows:
                lead_identity = db.get(AgentIdentity, row.lead_agent_id)
                if not self._environment_matches(lead_identity.environment if lead_identity else None, environment):
                    continue
                session_count = db.scalar(
                    select(func.count()).select_from(WorkflowSessionLink).where(
                        WorkflowSessionLink.workflow_id == row.workflow_id
                    )
                )
                workflows.append(
                    {
                        "workflow_id": row.workflow_id,
                        "name": row.name,
                        "user_goal": row.user_goal,
                        "lead_agent_id": row.lead_agent_id,
                        "lead_agent": self._agent_identity_to_dict(lead_identity),
                        "status": row.status,
                        "decision": row.decision,
                        "summary": row.summary,
                        "metadata": row.metadata_json,
                        "session_count": int(session_count or 0),
                        "created_at": row.created_at.isoformat(),
                        "updated_at": row.updated_at.isoformat(),
                    }
                )
            return workflows

    def workflow_environment(self, workflow_id: str) -> str | None:
        with self.session() as db:
            workflow = db.get(AgentWorkflow, workflow_id)
            if not workflow:
                return None
            identity = db.get(AgentIdentity, workflow.lead_agent_id)
            return identity.environment if identity else None

    def session_environment(self, session_id: str) -> str | None:
        with self.session() as db:
            session = db.get(AgentSession, session_id)
            if not session:
                return None
            identity = db.get(AgentIdentity, session.agent_id)
            return identity.environment if identity else None

    def agent_workflow_detail(self, workflow_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            workflow = db.get(AgentWorkflow, workflow_id)
            if not workflow:
                return None

            links = db.scalars(
                select(WorkflowSessionLink)
                .where(WorkflowSessionLink.workflow_id == workflow_id)
                .order_by(WorkflowSessionLink.sequence)
            ).all()

            sessions = []
            for link in links:
                session = db.get(AgentSession, link.session_id)
                identity = db.get(AgentIdentity, link.agent_id)
                events = db.scalars(
                    select(WorkflowEvent)
                    .where(WorkflowEvent.session_id == link.session_id)
                    .order_by(WorkflowEvent.sequence)
                ).all()
                sessions.append(
                    {
                        "link_id": link.link_id,
                        "workflow_id": link.workflow_id,
                        "session_id": link.session_id,
                        "agent_id": link.agent_id,
                        "agent_identity": self._agent_identity_to_dict(identity),
                        "role": link.role,
                        "parent_session_id": link.parent_session_id,
                        "sequence": link.sequence,
                        "metadata": link.metadata_json,
                        "session": {
                            "user_query": session.user_query if session else "",
                            "status": session.status if session else "UNKNOWN",
                            "created_at": session.created_at.isoformat() if session else None,
                            "updated_at": session.updated_at.isoformat() if session else None,
                        },
                        "events": [self._workflow_event_to_dict(row) for row in events],
                    }
                )

            return {
                "workflow_id": workflow.workflow_id,
                "name": workflow.name,
                "user_goal": workflow.user_goal,
                "lead_agent_id": workflow.lead_agent_id,
                "lead_agent": self._agent_identity_to_dict(db.get(AgentIdentity, workflow.lead_agent_id)),
                "status": workflow.status,
                "decision": workflow.decision,
                "summary": workflow.summary,
                "metadata": workflow.metadata_json,
                "created_at": workflow.created_at.isoformat(),
                "updated_at": workflow.updated_at.isoformat(),
                "sessions": sessions,
            }

    def workflow_for_session(self, session_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(WorkflowEvent)
                .where(WorkflowEvent.session_id == session_id)
                .order_by(WorkflowEvent.sequence)
            ).all()
            return [self._workflow_event_to_dict(row) for row in rows]

    @staticmethod
    def _agent_identity_to_dict(identity: AgentIdentity | None) -> dict[str, Any]:
        if not identity:
            return {}
        return {
            "agent_id": identity.agent_id,
            "display_name": identity.display_name,
            "agent_type": identity.agent_type,
            "owner": identity.owner,
            "environment": identity.environment,
            "purpose": identity.purpose,
            "permissions": identity.permissions or {},
            "metadata": identity.metadata_json or {},
            "created_at": identity.created_at.isoformat(),
            "updated_at": identity.updated_at.isoformat(),
        }

    @staticmethod
    def _workflow_definition_to_dict(definition: WorkflowDefinition | None) -> dict[str, Any]:
        if not definition:
            return {}
        return {
            "workflow_definition_id": definition.workflow_definition_id,
            "name": definition.name,
            "description": definition.description,
            "owner": definition.owner,
            "environment": definition.environment,
            "lead_agent_id": definition.lead_agent_id,
            "trigger_type": definition.trigger_type,
            "steps": definition.steps or [],
            "metadata": definition.metadata_json or {},
            "created_at": definition.created_at.isoformat(),
            "updated_at": definition.updated_at.isoformat(),
        }

    @staticmethod
    def _workflow_event_to_dict(row: WorkflowEvent) -> dict[str, Any]:
        return {
            "event_id": row.event_id,
            "session_id": row.session_id,
            "agent_id": row.agent_id,
            "sequence": row.sequence,
            "event_type": row.event_type,
            "label": row.label,
            "status": row.status,
            "payload": row.payload,
            "created_at": row.created_at.isoformat(),
        }

    def _user_context_from_row(self, db: Session, user: User) -> dict[str, Any]:
        rows = db.scalars(
            select(UserEnvironmentAccess)
            .where(UserEnvironmentAccess.user_id == user.user_id)
            .order_by(UserEnvironmentAccess.environment)
        ).all()
        permissions_by_environment = {row.environment: sorted(row.permissions or []) for row in rows}
        allowed_environments = sorted(permissions_by_environment)
        return {
            "email": user.email,
            "name": user.display_name,
            "role": user.role,
            "is_super_admin": bool(user.is_super_admin),
            "allowed_environments": allowed_environments,
            "default_environment": "all"
            if user.is_super_admin
            else (allowed_environments[0] if allowed_environments else None),
            "permissions_by_environment": permissions_by_environment,
            "can_all_environments": bool(user.is_super_admin),
        }

    def _base_environments(self, db: Session) -> list[str]:
        agent_envs = db.scalars(select(AgentIdentity.environment).distinct()).all()
        access_envs = db.scalars(select(UserEnvironmentAccess.environment).distinct()).all()
        return sorted(set(agent_envs) | set(access_envs) | {"local", "staging", "production"})

    @staticmethod
    def _upsert_environment_access(
        db: Session,
        user_id: str,
        environment: str,
        permissions: list[str],
    ) -> None:
        access_id = f"access_{user_id.replace('@', '_').replace('.', '_')}_{environment}"
        access = db.get(UserEnvironmentAccess, access_id)
        if not access:
            db.add(
                UserEnvironmentAccess(
                    access_id=access_id,
                    user_id=user_id,
                    environment=environment,
                    permissions=sorted(set(permissions)),
                )
            )
            return
        access.permissions = sorted(set(permissions))
        access.updated_at = utc_now()

    @staticmethod
    def user_has_permission(user: dict[str, Any], environment: str | None, permission: str) -> bool:
        if user.get("is_super_admin"):
            return True
        if not environment:
            return False
        permissions = user.get("permissions_by_environment", {}).get(environment, [])
        return "*" in permissions or permission in permissions or "read" in permissions and permission == "read"

    @staticmethod
    def _environment_matches(row_environment: str | None, requested: str | list[str] | None) -> bool:
        if not requested or requested == "all":
            return True
        if isinstance(requested, list):
            return row_environment in requested
        return row_environment == requested
