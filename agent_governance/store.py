from __future__ import annotations

from contextlib import contextmanager
from datetime import timedelta
from typing import Any, Iterator

from sqlalchemy import desc, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from agent_governance.auth import hash_password, hash_token, new_session_token, verify_password
from agent_governance.db import build_session_factory, seed_demo_data
from agent_governance.models import (
    AgentEvaluatorAssignment,
    AgentGuardrailAssignment,
    AgentIdentity,
    AgentKBAssignment,
    AgentCertification,
    AgentSession,
    AgentWorkflow,
    AuditEvent,
    EvaluationCriterionResult,
    EvaluationRun,
    EvaluationResult,
    EvaluatorTemplate,
    GuardrailPolicy,
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeIndexVersion,
    KnowledgeSource,
    PolicyDecision,
    ReviewQueueItem,
    ToolCertification,
    ToolCall,
    ToolRecord,
    User,
    UserSession,
    UserEnvironmentAccess,
    WorkflowCertification,
    WorkflowDefinition,
    WorkflowEvent,
    WorkflowSessionLink,
    new_id,
    utc_now,
)
from agent_governance.workflow_graph import (
    WorkflowGraphError,
    normalize_agent_type,
    normalize_workflow_graph,
)


DEFAULT_AGENT_LLM_CONFIG = {
    "gateway": "litellm",
    "endpoint": "/llm/v1",
    "model": "ollama/qwen3.5:9b",
    "temperature": 0.2,
}


_UNSET: Any = object()
KNOWLEDGE_DOCUMENT_STATUSES = {"uploaded", "queued", "parsing", "embedding", "indexed", "failed"}
KNOWLEDGE_DOCUMENT_INGESTION_ERROR = "One or more documents failed ingestion"


def metadata_with_default_llm(metadata: dict[str, Any] | None) -> dict[str, Any]:
    next_metadata = dict(metadata or {})
    next_metadata["llm"] = {
        **DEFAULT_AGENT_LLM_CONFIG,
        **(next_metadata.get("llm") or {}),
    }
    return next_metadata


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
            "staging": [
                "read",
                "agent:create",
                "agent:run",
                "workflow:create",
                "workflow:run",
                "tool:create",
                "tool:grant",
                "review:resolve",
            ],
        },
    },
    "Agent Developer": {
        "is_super_admin": False,
        "access": {
            "local": [
                "read",
                "agent:create",
                "agent:run",
                "workflow:create",
                "workflow:run",
                "tool:create",
                "tool:grant",
            ],
            "staging": [
                "read",
                "agent:create",
                "agent:run",
                "workflow:create",
                "workflow:run",
                "tool:create",
                "tool:grant",
            ],
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
            return bool(
                db.scalar(
                    select(func.count()).select_from(User).where(User.password_hash.is_not(None))
                )
                or 0
            )

    def register_user(
        self, *, email: str, password: str, display_name: str, role: str
    ) -> dict[str, Any]:
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

    def find_agent_identity(self, agent_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            identity = db.get(AgentIdentity, agent_id)
            if not identity:
                return None
            cert = db.scalar(
                select(AgentCertification).where(AgentCertification.agent_id == agent_id)
            )
            return self._agent_identity_to_dict(identity, cert)

    def list_agents(self, environment: str | list[str] | None = None) -> list[dict[str, Any]]:
        with self.session() as db:
            stmt = select(AgentIdentity).order_by(AgentIdentity.agent_id)
            if isinstance(environment, list):
                stmt = stmt.where(AgentIdentity.environment.in_(environment))
            elif environment and environment != "all":
                stmt = stmt.where(AgentIdentity.environment == environment)
            rows = db.scalars(stmt).all()
            return [
                self._agent_identity_to_dict(
                    row,
                    db.scalar(
                        select(AgentCertification).where(
                            AgentCertification.agent_id == row.agent_id
                        )
                    ),
                )
                for row in rows
            ]

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
            if not identity:
                raise ValueError(f"Agent '{agent_id}' not found")
            return identity.environment

    def get_agent_identity(self, agent_id: str) -> dict[str, Any]:
        identity = self.find_agent_identity(agent_id)
        if not identity:
            raise ValueError(f"Agent '{agent_id}' not found")
        return identity

    def upsert_agent_identity(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            identity = db.get(AgentIdentity, payload["agent_id"])
            if not identity:
                identity = AgentIdentity(
                    agent_id=payload["agent_id"],
                    display_name=payload["display_name"],
                    agent_type=normalize_agent_type(payload["agent_type"]),
                    owner=payload["owner"],
                    environment=payload["environment"],
                    purpose=payload["purpose"],
                    permissions=payload.get("permissions") or {},
                    metadata_json=metadata_with_default_llm(payload.get("metadata")),
                )
                db.add(identity)
            else:
                identity.display_name = payload["display_name"]
                identity.agent_type = normalize_agent_type(payload["agent_type"])
                identity.owner = payload["owner"]
                identity.environment = payload["environment"]
                identity.purpose = payload["purpose"]
                identity.permissions = payload.get("permissions") or {}
                identity.metadata_json = metadata_with_default_llm(payload.get("metadata"))
                identity.updated_at = utc_now()
                self._invalidate_agent_cert_if_certified(
                    db, payload["agent_id"], "agent configuration updated"
                )
            db.flush()
            cert = db.scalar(
                select(AgentCertification).where(AgentCertification.agent_id == identity.agent_id)
            )
            return self._agent_identity_to_dict(identity, cert)

    def delete_agent_identity(self, agent_id: str) -> bool:
        with self.session() as db:
            identity = db.get(AgentIdentity, agent_id)
            if not identity:
                return False
            for assignment in db.scalars(
                select(AgentGuardrailAssignment).where(
                    AgentGuardrailAssignment.agent_id == agent_id
                )
            ).all():
                db.delete(assignment)
            for assignment in db.scalars(
                select(AgentEvaluatorAssignment).where(
                    AgentEvaluatorAssignment.agent_id == agent_id
                )
            ).all():
                db.delete(assignment)
            cert = db.scalar(
                select(AgentCertification).where(AgentCertification.agent_id == agent_id)
            )
            if cert:
                db.delete(cert)
            db.delete(identity)
            return True

    def list_workflow_definitions(
        self, environment: str | list[str] | None = None
    ) -> list[dict[str, Any]]:
        with self.session() as db:
            stmt = select(WorkflowDefinition).order_by(WorkflowDefinition.name)
            if isinstance(environment, list):
                stmt = stmt.where(WorkflowDefinition.environment.in_(environment))
            elif environment and environment != "all":
                stmt = stmt.where(WorkflowDefinition.environment == environment)
            rows = db.scalars(stmt).all()
            return [
                self._workflow_definition_to_dict(
                    row,
                    db.scalar(
                        select(WorkflowCertification).where(
                            WorkflowCertification.workflow_definition_id
                            == row.workflow_definition_id
                        )
                    ),
                )
                for row in rows
            ]

    def get_workflow_definition(self, workflow_definition_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            definition = db.get(WorkflowDefinition, workflow_definition_id)
            if not definition:
                return None
            cert = db.scalar(
                select(WorkflowCertification).where(
                    WorkflowCertification.workflow_definition_id == workflow_definition_id
                )
            )
            return self._workflow_definition_to_dict(definition, cert)

    def workflow_definition_environment(self, workflow_definition_id: str) -> str | None:
        with self.session() as db:
            definition = db.get(WorkflowDefinition, workflow_definition_id)
            return definition.environment if definition else None

    def upsert_workflow_definition(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            agent_ids = {
                str(payload["lead_agent_id"]),
                *[
                    str(step.get("agent_id"))
                    for step in payload.get("steps", [])
                    if isinstance(step, dict) and step.get("agent_id")
                ],
                *[
                    str(node.get("agent_id"))
                    for node in payload.get("nodes", [])
                    if isinstance(node, dict) and node.get("agent_id")
                ],
            }
            agent_types_by_id: dict[str, str] = {}
            for agent_id in agent_ids:
                identity = db.get(AgentIdentity, agent_id)
                if not identity:
                    raise WorkflowGraphError(f"Unknown workflow agent_id '{agent_id}'.")
                agent_types_by_id[agent_id] = identity.agent_type

            graph = normalize_workflow_graph(payload=payload, agent_types_by_id=agent_types_by_id)
            metadata = {
                **(payload.get("metadata") or {}),
                "domain": payload.get("domain")
                or (payload.get("metadata") or {}).get("domain")
                or "general",
                "graph_version_hash": graph["graph_version_hash"],
            }
            definition = db.get(WorkflowDefinition, payload["workflow_definition_id"])
            if not definition:
                definition = WorkflowDefinition(
                    workflow_definition_id=payload["workflow_definition_id"],
                    name=payload["name"],
                    description=payload["description"],
                    owner=payload["owner"],
                    environment=payload["environment"],
                    domain=metadata["domain"],
                    lead_agent_id=payload["lead_agent_id"],
                    trigger_type=payload.get("trigger_type") or "manual",
                    steps=payload.get("steps") or [],
                    nodes=graph["nodes"],
                    edges=graph["edges"],
                    policy_bindings=graph["policy_bindings"],
                    review_rules=graph["review_rules"],
                    graph_version_hash=graph["graph_version_hash"],
                    metadata_json=metadata,
                )
                db.add(definition)
            else:
                definition.name = payload["name"]
                definition.description = payload["description"]
                definition.owner = payload["owner"]
                definition.environment = payload["environment"]
                definition.domain = metadata["domain"]
                definition.lead_agent_id = payload["lead_agent_id"]
                definition.trigger_type = payload.get("trigger_type") or "manual"
                definition.steps = payload.get("steps") or []
                definition.nodes = graph["nodes"]
                definition.edges = graph["edges"]
                definition.policy_bindings = graph["policy_bindings"]
                definition.review_rules = graph["review_rules"]
                definition.graph_version_hash = graph["graph_version_hash"]
                definition.metadata_json = metadata
                definition.updated_at = utc_now()
                self._invalidate_workflow_cert_if_certified(
                    db, payload["workflow_definition_id"], "workflow graph changed"
                )
            db.flush()
            cert = db.scalar(
                select(WorkflowCertification).where(
                    WorkflowCertification.workflow_definition_id
                    == definition.workflow_definition_id
                )
            )
            return self._workflow_definition_to_dict(definition, cert)

    def list_guardrail_policies(
        self, environment: str | list[str] | None = None
    ) -> list[dict[str, Any]]:
        with self.session() as db:
            stmt = select(GuardrailPolicy).order_by(GuardrailPolicy.display_name)
            if isinstance(environment, list):
                stmt = stmt.where(GuardrailPolicy.environment.in_(environment))
            elif environment and environment != "all":
                stmt = stmt.where(GuardrailPolicy.environment == environment)
            return [self._guardrail_policy_to_dict(row) for row in db.scalars(stmt).all()]

    def get_guardrail_policy(self, policy_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            row = db.get(GuardrailPolicy, policy_id)
            return self._guardrail_policy_to_dict(row) if row else None

    def upsert_guardrail_policy(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            row = db.get(GuardrailPolicy, payload["policy_id"])
            if not row:
                row = GuardrailPolicy(
                    policy_id=payload["policy_id"],
                    display_name=payload["display_name"],
                    description=payload.get("description") or "",
                    environment=payload["environment"],
                    config=payload.get("config") or {},
                )
                db.add(row)
            else:
                row.display_name = payload["display_name"]
                row.description = payload.get("description") or ""
                row.environment = payload["environment"]
                row.config = payload.get("config") or {}
                row.updated_at = utc_now()
            db.flush()
            return self._guardrail_policy_to_dict(row)

    @staticmethod
    def _guardrail_policy_to_dict(row: GuardrailPolicy | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "policy_id": row.policy_id,
            "display_name": row.display_name,
            "description": row.description,
            "environment": row.environment,
            "config": row.config or {},
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
        }

    def get_agent_guardrail_assignment(
        self, agent_id: str, environment: str
    ) -> dict[str, Any] | None:
        with self.session() as db:
            row = db.scalar(
                select(AgentGuardrailAssignment).where(
                    AgentGuardrailAssignment.agent_id == agent_id,
                    AgentGuardrailAssignment.environment == environment,
                )
            )
            return self._guardrail_assignment_to_dict(row) if row else None

    def list_agent_guardrail_assignments(self, agent_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(AgentGuardrailAssignment)
                .where(AgentGuardrailAssignment.agent_id == agent_id)
                .order_by(AgentGuardrailAssignment.environment)
            ).all()
            return [self._guardrail_assignment_to_dict(row) for row in rows]

    def upsert_agent_guardrail_assignment(
        self,
        *,
        agent_id: str,
        environment: str,
        policy_id: str,
        mode: str,
        threshold_overrides: dict[str, Any],
    ) -> dict[str, Any]:
        with self.session() as db:
            row = db.scalar(
                select(AgentGuardrailAssignment).where(
                    AgentGuardrailAssignment.agent_id == agent_id,
                    AgentGuardrailAssignment.environment == environment,
                )
            )
            if not row:
                row = AgentGuardrailAssignment(
                    assignment_id=new_id("gra"),
                    agent_id=agent_id,
                    environment=environment,
                    policy_id=policy_id,
                    mode=mode,
                    threshold_overrides=threshold_overrides or {},
                )
                db.add(row)
            else:
                row.policy_id = policy_id
                row.mode = mode
                row.threshold_overrides = threshold_overrides or {}
                row.updated_at = utc_now()
            self._invalidate_agent_cert_if_certified(db, agent_id, "guardrail assignments changed")
            db.flush()
            return self._guardrail_assignment_to_dict(row)

    def delete_agent_guardrail_assignment(self, assignment_id: str) -> bool:
        with self.session() as db:
            row = db.get(AgentGuardrailAssignment, assignment_id)
            if not row:
                return False
            self._invalidate_agent_cert_if_certified(
                db, row.agent_id, "guardrail assignments changed"
            )
            db.delete(row)
            return True

    def get_sessions_for_workflow(self, workflow_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            links = db.scalars(
                select(WorkflowSessionLink).where(WorkflowSessionLink.workflow_id == workflow_id)
            ).all()
            result = []
            for link in links:
                session = db.get(AgentSession, link.session_id)
                if session:
                    result.append(
                        {
                            "session_id": session.session_id,
                            "agent_id": session.agent_id,
                            "status": session.status,
                        }
                    )
            return result

    def get_policy_decisions_for_session(self, session_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(PolicyDecision).where(PolicyDecision.session_id == session_id)
            ).all()
            return [{"decision": row.decision, "tool_name": row.tool_name} for row in rows]

    def get_tool_calls_for_session(self, session_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(select(ToolCall).where(ToolCall.session_id == session_id)).all()
            return [
                {
                    "agent_id": row.agent_id,
                    "tool_name": row.tool_name,
                    "decision": row.decision,
                }
                for row in rows
            ]

    def get_audit_events_for_session(self, session_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(select(AuditEvent).where(AuditEvent.session_id == session_id)).all()
            return [{"risk_type": row.risk_type, "decision": row.decision} for row in rows]

    @staticmethod
    def _guardrail_assignment_to_dict(row: AgentGuardrailAssignment | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "assignment_id": row.assignment_id,
            "agent_id": row.agent_id,
            "environment": row.environment,
            "policy_id": row.policy_id,
            "mode": row.mode,
            "threshold_overrides": row.threshold_overrides or {},
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
        }

    def list_evaluator_templates(self) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(EvaluatorTemplate).order_by(EvaluatorTemplate.display_name)
            ).all()
            return [self._evaluator_template_to_dict(row) for row in rows]

    def get_evaluator_template(self, evaluator_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            row = db.get(EvaluatorTemplate, evaluator_id)
            return self._evaluator_template_to_dict(row) if row else None

    def upsert_evaluator_template(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            row = db.get(EvaluatorTemplate, payload["evaluator_id"])
            if not row:
                row = EvaluatorTemplate(
                    evaluator_id=payload["evaluator_id"],
                    display_name=payload["display_name"],
                    evaluator_type=payload["evaluator_type"],
                    scope=payload["scope"],
                    description=payload.get("description") or "",
                    default_config=payload.get("default_config") or {},
                    llm_enabled=bool(payload.get("llm_enabled", False)),
                )
                db.add(row)
            else:
                row.display_name = payload["display_name"]
                row.evaluator_type = payload["evaluator_type"]
                row.scope = payload["scope"]
                row.description = payload.get("description") or ""
                row.default_config = payload.get("default_config") or {}
                row.llm_enabled = bool(payload.get("llm_enabled", False))
                row.updated_at = utc_now()
            db.flush()
            return self._evaluator_template_to_dict(row)

    def list_agent_evaluator_assignments(self, agent_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(AgentEvaluatorAssignment)
                .where(AgentEvaluatorAssignment.agent_id == agent_id)
                .order_by(
                    AgentEvaluatorAssignment.environment, AgentEvaluatorAssignment.evaluator_id
                )
            ).all()
            return [self._evaluator_assignment_to_dict(row) for row in rows]

    def get_agent_evaluator_assignments_for_trigger(
        self, agent_id: str, environment: str, trigger: str
    ) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(AgentEvaluatorAssignment).where(
                    AgentEvaluatorAssignment.agent_id == agent_id,
                    AgentEvaluatorAssignment.environment == environment,
                    AgentEvaluatorAssignment.trigger == trigger,
                )
            ).all()
            return [self._evaluator_assignment_to_dict(row) for row in rows]

    def upsert_agent_evaluator_assignment(
        self,
        *,
        agent_id: str,
        environment: str,
        evaluator_id: str,
        trigger: str,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        with self.session() as db:
            row = db.scalar(
                select(AgentEvaluatorAssignment).where(
                    AgentEvaluatorAssignment.agent_id == agent_id,
                    AgentEvaluatorAssignment.environment == environment,
                    AgentEvaluatorAssignment.evaluator_id == evaluator_id,
                )
            )
            if not row:
                row = AgentEvaluatorAssignment(
                    assignment_id=new_id("eva"),
                    agent_id=agent_id,
                    environment=environment,
                    evaluator_id=evaluator_id,
                    trigger=trigger,
                    config=config or {},
                )
                db.add(row)
            else:
                row.trigger = trigger
                row.config = config or {}
                row.updated_at = utc_now()
            self._invalidate_agent_cert_if_certified(db, agent_id, "evaluator assignments changed")
            db.flush()
            return self._evaluator_assignment_to_dict(row)

    def delete_agent_evaluator_assignment(self, assignment_id: str) -> bool:
        with self.session() as db:
            row = db.get(AgentEvaluatorAssignment, assignment_id)
            if not row:
                return False
            self._invalidate_agent_cert_if_certified(
                db, row.agent_id, "evaluator assignments changed"
            )
            db.delete(row)
            return True

    @staticmethod
    def _evaluator_template_to_dict(row: EvaluatorTemplate | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "evaluator_id": row.evaluator_id,
            "display_name": row.display_name,
            "evaluator_type": row.evaluator_type,
            "scope": row.scope,
            "description": row.description,
            "default_config": row.default_config or {},
            "llm_enabled": bool(row.llm_enabled),
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
        }

    @staticmethod
    def _evaluator_assignment_to_dict(row: AgentEvaluatorAssignment | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "assignment_id": row.assignment_id,
            "agent_id": row.agent_id,
            "environment": row.environment,
            "evaluator_id": row.evaluator_id,
            "trigger": row.trigger,
            "config": row.config or {},
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
        }

    def add_evaluation_result(
        self,
        *,
        session_id: str,
        workflow_id: str | None,
        agent_id: str,
        evaluator_id: str,
        score: int,
        passed: bool,
        findings: list[dict[str, Any]],
        trigger: str,
    ) -> dict[str, Any]:
        result_id = new_id("evr")
        with self.session() as db:
            row = EvaluationResult(
                result_id=result_id,
                session_id=session_id,
                workflow_id=workflow_id,
                agent_id=agent_id,
                evaluator_id=evaluator_id,
                score=score,
                passed=passed,
                findings=findings,
                trigger=trigger,
            )
            db.add(row)
            db.flush()
            return self._evaluation_result_to_dict(row)

    def list_session_evaluation_results(self, session_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(EvaluationResult)
                .where(EvaluationResult.session_id == session_id)
                .order_by(EvaluationResult.created_at)
            ).all()
            return [self._evaluation_result_to_dict(row) for row in rows]

    def list_evaluation_results(
        self,
        environment: str | list[str] | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        with self.session() as db:
            stmt = select(EvaluationResult).order_by(desc(EvaluationResult.created_at)).limit(limit)
            if agent_id:
                stmt = stmt.where(EvaluationResult.agent_id == agent_id)
            if session_id:
                stmt = stmt.where(EvaluationResult.session_id == session_id)
            rows = db.scalars(stmt).all()
            results = []
            for row in rows:
                if environment:
                    identity = db.get(AgentIdentity, row.agent_id)
                    if not self._environment_matches(
                        identity.environment if identity else None, environment
                    ):
                        continue
                results.append(self._evaluation_result_to_dict(row))
            return results

    @staticmethod
    def _evaluation_result_to_dict(row: EvaluationResult | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "result_id": row.result_id,
            "session_id": row.session_id,
            "workflow_id": row.workflow_id,
            "agent_id": row.agent_id,
            "evaluator_id": row.evaluator_id,
            "score": row.score,
            "passed": bool(row.passed),
            "findings": row.findings or [],
            "trigger": row.trigger,
            "created_at": row.created_at.isoformat(),
        }

    def create_tool_record(self, payload: dict[str, Any]) -> dict[str, Any]:
        from agent_governance.evaluation.tool_evaluators import compute_config_hash

        tool_id = payload.get("tool_id") or new_id("tool")
        config_hash = compute_config_hash(payload)
        with self.session() as db:
            if db.get(ToolRecord, tool_id):
                raise ValueError(f"Tool ID '{tool_id}' already exists")
            if db.scalar(select(ToolRecord).where(ToolRecord.tool_name == payload["tool_name"])):
                raise ValueError(f"Tool name '{payload['tool_name']}' already exists")

            record = ToolRecord(
                tool_id=tool_id,
                tool_name=payload["tool_name"],
                display_name=payload.get("display_name")
                or payload["tool_name"].replace("_", " ").title(),
                description=payload.get("description", ""),
                category=payload.get("category", "custom"),
                side_effect_level=payload.get("side_effect_level", "read_only"),
                input_schema=payload.get("input_schema") or {},
                output_schema=payload.get("output_schema") or {},
                permissions=payload.get("permissions") or {},
                allowed_actions=payload.get("allowed_actions") or [],
                environment=payload.get("environment", "demo"),
                owner=payload.get("owner", "Unassigned"),
                config_hash=config_hash,
                artifact_digest=payload.get("artifact_digest"),
                metadata_json=payload.get("metadata") or {},
            )
            db.add(record)
            db.flush()
            cert = ToolCertification(
                certification_id=new_id("cert"),
                tool_id=tool_id,
                status="DRAFT",
                config_hash=config_hash,
                artifact_digest=payload.get("artifact_digest"),
            )
            db.add(cert)
            db.flush()
            return self._tool_record_to_dict(record, cert)

    def upsert_tool_record(self, payload: dict[str, Any]) -> dict[str, Any]:
        from agent_governance.evaluation.tool_evaluators import compute_config_hash

        config_hash = compute_config_hash(payload)
        tool_id = payload.get("tool_id") or new_id("tool")
        with self.session() as db:
            record = db.get(ToolRecord, tool_id)
            if not record and payload.get("tool_name"):
                record = db.scalar(
                    select(ToolRecord).where(ToolRecord.tool_name == payload["tool_name"])
                )
            if not record:
                record = ToolRecord(
                    tool_id=tool_id,
                    tool_name=payload["tool_name"],
                    display_name=payload.get("display_name")
                    or payload["tool_name"].replace("_", " ").title(),
                    description=payload.get("description", ""),
                    category=payload.get("category", "custom"),
                    side_effect_level=payload.get("side_effect_level", "read_only"),
                    input_schema=payload.get("input_schema") or {},
                    output_schema=payload.get("output_schema") or {},
                    permissions=payload.get("permissions") or {},
                    allowed_actions=payload.get("allowed_actions") or [],
                    environment=payload.get("environment", "demo"),
                    owner=payload.get("owner", "Unassigned"),
                    config_hash=config_hash,
                    artifact_digest=payload.get("artifact_digest"),
                    metadata_json=payload.get("metadata") or {},
                )
                db.add(record)
                db.flush()
            else:
                if payload.get("tool_name") and payload["tool_name"] != record.tool_name:
                    duplicate = db.scalar(
                        select(ToolRecord).where(ToolRecord.tool_name == payload["tool_name"])
                    )
                    if duplicate and duplicate.tool_id != record.tool_id:
                        raise ValueError(f"Tool name '{payload['tool_name']}' already exists")
                    record.tool_name = payload["tool_name"]
                record.display_name = payload.get("display_name") or record.display_name
                record.description = payload.get("description", "")
                record.category = payload.get("category", "custom")
                record.side_effect_level = payload.get("side_effect_level", "read_only")
                record.input_schema = payload.get("input_schema") or {}
                record.output_schema = payload.get("output_schema") or {}
                record.permissions = payload.get("permissions") or {}
                record.allowed_actions = payload.get("allowed_actions") or []
                record.environment = payload.get("environment", record.environment)
                record.owner = payload.get("owner", record.owner)
                record.config_hash = config_hash
                record.artifact_digest = payload.get("artifact_digest")
                record.metadata_json = payload.get("metadata") or {}
                record.updated_at = utc_now()

            cert = db.scalar(
                select(ToolCertification).where(ToolCertification.tool_id == record.tool_id)
            )
            if not cert:
                cert = ToolCertification(
                    certification_id=new_id("cert"),
                    tool_id=record.tool_id,
                    status=payload.get("certification_status", "DRAFT"),
                    config_hash=config_hash,
                    artifact_digest=payload.get("artifact_digest"),
                )
                db.add(cert)
            else:
                requested_status = payload.get("certification_status")
                if requested_status:
                    cert.status = requested_status
                elif cert.status == "CERTIFIED" and cert.config_hash != config_hash:
                    cert.status = "NEEDS_REEVALUATION"
                    cert.failure_reason = "Tool configuration changed after certification."
                cert.config_hash = config_hash
                cert.artifact_digest = payload.get("artifact_digest")
                cert.updated_at = utc_now()
            if payload.get("certified_by"):
                cert.certified_by = payload["certified_by"]
            if payload.get("certified_at"):
                cert.certified_at = payload["certified_at"]
            db.flush()
            return self._tool_record_to_dict(record, cert)

    def list_tool_records(self, environment: str | list[str] | None = None) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(select(ToolRecord).order_by(ToolRecord.display_name)).all()
            result = []
            for row in rows:
                if not self._environment_matches(row.environment, environment):
                    continue
                cert = db.scalar(
                    select(ToolCertification).where(ToolCertification.tool_id == row.tool_id)
                )
                result.append(self._tool_record_to_dict(row, cert))
            return result

    def get_tool_record(self, tool_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            row = db.get(ToolRecord, tool_id)
            if not row:
                return None
            cert = db.scalar(select(ToolCertification).where(ToolCertification.tool_id == tool_id))
            return self._tool_record_to_dict(row, cert)

    def get_tool_record_by_name(self, tool_name: str) -> dict[str, Any] | None:
        with self.session() as db:
            row = db.scalar(select(ToolRecord).where(ToolRecord.tool_name == tool_name))
            if not row:
                return None
            cert = db.scalar(
                select(ToolCertification).where(ToolCertification.tool_id == row.tool_id)
            )
            return self._tool_record_to_dict(row, cert)

    def get_tool_certification(self, tool_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            cert = db.scalar(select(ToolCertification).where(ToolCertification.tool_id == tool_id))
            return self._tool_certification_to_dict(cert) if cert else None

    def update_tool_certification(self, tool_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            cert = db.scalar(select(ToolCertification).where(ToolCertification.tool_id == tool_id))
            if not cert:
                raise ValueError(f"No certification record for tool '{tool_id}'")
            for field in (
                "status",
                "config_hash",
                "artifact_digest",
                "last_evaluation_run_id",
                "certified_by",
                "certified_at",
                "expires_at",
                "failure_reason",
            ):
                if field in payload:
                    setattr(cert, field, payload[field])
            cert.updated_at = utc_now()
            db.flush()
            return self._tool_certification_to_dict(cert)

    def create_evaluation_run(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            run = EvaluationRun(
                run_id=new_id("run"),
                target_type=payload["target_type"],
                target_id=payload["target_id"],
                config_hash=payload["config_hash"],
                artifact_digest=payload.get("artifact_digest"),
                triggered_by=payload["triggered_by"],
                status="RUNNING",
                metadata_json=payload.get("metadata") or {},
            )
            db.add(run)
            db.flush()
            return self._evaluation_run_to_dict(run)

    def complete_evaluation_run(
        self,
        run_id: str,
        *,
        overall_result: str,
        criteria_total: int,
        criteria_passed: int,
        duration_ms: int,
    ) -> dict[str, Any]:
        with self.session() as db:
            run = db.get(EvaluationRun, run_id)
            if not run:
                raise ValueError(f"Evaluation run '{run_id}' not found")
            run.status = "COMPLETED"
            run.overall_result = overall_result
            run.criteria_total = criteria_total
            run.criteria_passed = criteria_passed
            run.duration_ms = duration_ms
            run.completed_at = utc_now()
            db.flush()
            return self._evaluation_run_to_dict(run)

    def add_evaluation_criterion_results(self, run_id: str, results: list[dict[str, Any]]) -> None:
        with self.session() as db:
            for result in results:
                db.add(
                    EvaluationCriterionResult(
                        criterion_result_id=new_id("crit"),
                        run_id=run_id,
                        evaluator_id=result["evaluator_id"],
                        criterion_name=result["criterion_name"],
                        status=result["status"],
                        score=result.get("score"),
                        evidence_sentence=result["evidence_sentence"],
                        observed_value=result.get("observed_value") or {},
                        expected_value=result.get("expected_value") or {},
                        metadata_json=result.get("metadata") or {},
                        input_snapshot=result.get("input_snapshot") or {},
                    )
                )

    def list_evaluation_runs_for_tool(self, tool_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(EvaluationRun)
                .where(EvaluationRun.target_type == "tool", EvaluationRun.target_id == tool_id)
                .order_by(desc(EvaluationRun.created_at))
            ).all()
            return [self._evaluation_run_to_dict(row) for row in rows]

    def list_evaluation_criterion_results(self, run_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(EvaluationCriterionResult)
                .where(EvaluationCriterionResult.run_id == run_id)
                .order_by(EvaluationCriterionResult.created_at)
            ).all()
            return [self._evaluation_criterion_to_dict(row) for row in rows]

    def create_agent_certification(self, agent_id: str, config_hash: str) -> dict[str, Any]:
        with self.session() as db:
            existing = db.scalar(
                select(AgentCertification).where(AgentCertification.agent_id == agent_id)
            )
            if existing:
                return self._agent_certification_to_dict(existing)
            cert = AgentCertification(
                certification_id=new_id("acert"),
                agent_id=agent_id,
                status="DRAFT",
                config_hash=config_hash,
            )
            db.add(cert)
            db.flush()
            return self._agent_certification_to_dict(cert)

    def get_agent_certification(self, agent_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            cert = db.scalar(
                select(AgentCertification).where(AgentCertification.agent_id == agent_id)
            )
            return self._agent_certification_to_dict(cert) if cert else None

    def update_agent_certification(self, agent_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            cert = db.scalar(
                select(AgentCertification).where(AgentCertification.agent_id == agent_id)
            )
            if not cert:
                raise ValueError(f"No certification record for agent '{agent_id}'")
            for field in (
                "status",
                "config_hash",
                "invalidation_reason",
                "last_evaluation_run_id",
                "certified_by",
                "certified_at",
                "expires_at",
                "failure_reason",
            ):
                if field in payload:
                    setattr(cert, field, payload[field])
            cert.updated_at = utc_now()
            db.flush()
            return self._agent_certification_to_dict(cert)

    def list_evaluation_runs_for_agent(self, agent_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(EvaluationRun)
                .where(EvaluationRun.target_type == "agent", EvaluationRun.target_id == agent_id)
                .order_by(desc(EvaluationRun.created_at))
            ).all()
            return [self._evaluation_run_to_dict(row) for row in rows]

    def create_workflow_certification(
        self, workflow_definition_id: str, config_hash: str
    ) -> dict[str, Any]:
        with self.session() as db:
            cert = WorkflowCertification(
                certification_id=new_id("cert"),
                workflow_definition_id=workflow_definition_id,
                status="DRAFT",
                config_hash=config_hash,
            )
            db.add(cert)
            db.flush()
            return self._workflow_certification_to_dict(cert)

    def get_workflow_certification(self, workflow_definition_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            cert = db.scalar(
                select(WorkflowCertification).where(
                    WorkflowCertification.workflow_definition_id == workflow_definition_id
                )
            )
            return self._workflow_certification_to_dict(cert) if cert else None

    def update_workflow_certification(
        self, workflow_definition_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        with self.session() as db:
            cert = db.scalar(
                select(WorkflowCertification).where(
                    WorkflowCertification.workflow_definition_id == workflow_definition_id
                )
            )
            if not cert:
                raise ValueError(f"No certification record for workflow '{workflow_definition_id}'")
            for field in (
                "status",
                "config_hash",
                "invalidation_reason",
                "last_evaluation_run_id",
                "certified_by",
                "certified_at",
                "expires_at",
                "failure_reason",
            ):
                if field in payload:
                    setattr(cert, field, payload[field])
            cert.updated_at = utc_now()
            db.flush()
            return self._workflow_certification_to_dict(cert)

    def list_evaluation_runs_for_workflow(
        self, workflow_definition_id: str
    ) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(EvaluationRun)
                .where(
                    EvaluationRun.target_type == "workflow",
                    EvaluationRun.target_id == workflow_definition_id,
                )
                .order_by(desc(EvaluationRun.created_at))
            ).all()
            return [self._evaluation_run_to_dict(row) for row in rows]

    def list_evaluation_runs(
        self,
        *,
        target_type: str | None = None,
        environment: str | list[str] | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        with self.session() as db:
            stmt = select(EvaluationRun).order_by(desc(EvaluationRun.created_at)).limit(limit)
            if target_type:
                stmt = stmt.where(EvaluationRun.target_type == target_type)
            rows = db.scalars(stmt).all()

            runs = []
            for row in rows:
                if environment and not self._evaluation_run_environment_matches(
                    db, row, environment
                ):
                    continue
                runs.append(self._evaluation_run_to_dict(row))
            return runs

    @staticmethod
    def _tool_record_to_dict(
        row: ToolRecord | None, cert: ToolCertification | None = None
    ) -> dict[str, Any]:
        if not row:
            return {}
        metadata = row.metadata_json or {}
        return {
            "tool_id": row.tool_id,
            "tool_name": row.tool_name,
            "display_name": row.display_name,
            "description": row.description,
            "domain": metadata.get("domain") or metadata.get("data_domain") or row.category,
            "category": row.category,
            "side_effect_level": row.side_effect_level,
            "input_schema": row.input_schema or {},
            "output_schema": row.output_schema or {},
            "permissions": row.permissions or {},
            "allowed_actions": row.allowed_actions or [],
            "environment": row.environment,
            "owner": row.owner,
            "config_hash": row.config_hash,
            "artifact_digest": row.artifact_digest,
            "metadata": metadata,
            "certification": GovernanceStore._tool_certification_to_dict(cert) if cert else None,
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
        }

    @staticmethod
    def _tool_certification_to_dict(cert: ToolCertification | None) -> dict[str, Any]:
        if not cert:
            return {}
        return {
            "certification_id": cert.certification_id,
            "tool_id": cert.tool_id,
            "status": cert.status,
            "config_hash": cert.config_hash,
            "artifact_digest": cert.artifact_digest,
            "last_evaluation_run_id": cert.last_evaluation_run_id,
            "certified_by": cert.certified_by,
            "certified_at": cert.certified_at.isoformat() if cert.certified_at else None,
            "expires_at": cert.expires_at.isoformat() if cert.expires_at else None,
            "failure_reason": cert.failure_reason,
            "created_at": cert.created_at.isoformat(),
            "updated_at": cert.updated_at.isoformat(),
        }

    @staticmethod
    def _evaluation_run_to_dict(row: EvaluationRun | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "run_id": row.run_id,
            "target_type": row.target_type,
            "target_id": row.target_id,
            "config_hash": row.config_hash,
            "artifact_digest": row.artifact_digest,
            "triggered_by": row.triggered_by,
            "status": row.status,
            "overall_result": row.overall_result,
            "criteria_total": row.criteria_total,
            "criteria_passed": row.criteria_passed,
            "duration_ms": row.duration_ms,
            "metadata": row.metadata_json or {},
            "created_at": row.created_at.isoformat(),
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        }

    @staticmethod
    def _evaluation_criterion_to_dict(row: EvaluationCriterionResult) -> dict[str, Any]:
        return {
            "criterion_result_id": row.criterion_result_id,
            "run_id": row.run_id,
            "evaluator_id": row.evaluator_id,
            "criterion_name": row.criterion_name,
            "status": row.status,
            "score": row.score,
            "evidence_sentence": row.evidence_sentence,
            "observed_value": row.observed_value or {},
            "expected_value": row.expected_value or {},
            "metadata": row.metadata_json or {},
            "input_snapshot": row.input_snapshot or {},
            "created_at": row.created_at.isoformat(),
        }

    @staticmethod
    def _agent_certification_to_dict(cert: AgentCertification | None) -> dict[str, Any]:
        if not cert:
            return {}
        return {
            "certification_id": cert.certification_id,
            "agent_id": cert.agent_id,
            "status": cert.status,
            "config_hash": cert.config_hash,
            "invalidation_reason": cert.invalidation_reason,
            "last_evaluation_run_id": cert.last_evaluation_run_id,
            "certified_by": cert.certified_by,
            "certified_at": cert.certified_at.isoformat() if cert.certified_at else None,
            "expires_at": cert.expires_at.isoformat() if cert.expires_at else None,
            "failure_reason": cert.failure_reason,
            "created_at": cert.created_at.isoformat(),
            "updated_at": cert.updated_at.isoformat(),
        }

    @staticmethod
    def _workflow_certification_to_dict(
        cert: WorkflowCertification | None,
    ) -> dict[str, Any]:
        if not cert:
            return {}
        return {
            "certification_id": cert.certification_id,
            "workflow_definition_id": cert.workflow_definition_id,
            "status": cert.status,
            "config_hash": cert.config_hash,
            "invalidation_reason": cert.invalidation_reason,
            "last_evaluation_run_id": cert.last_evaluation_run_id,
            "certified_by": cert.certified_by,
            "certified_at": cert.certified_at.isoformat() if cert.certified_at else None,
            "expires_at": cert.expires_at.isoformat() if cert.expires_at else None,
            "failure_reason": cert.failure_reason,
            "created_at": cert.created_at.isoformat(),
            "updated_at": cert.updated_at.isoformat(),
        }

    def _invalidate_agent_cert_if_certified(self, db: Session, agent_id: str, reason: str) -> None:
        cert = db.scalar(select(AgentCertification).where(AgentCertification.agent_id == agent_id))
        if cert and cert.status not in {"DRAFT", "NEEDS_REEVALUATION"}:
            cert.status = "NEEDS_REEVALUATION"
            cert.invalidation_reason = reason
            cert.updated_at = utc_now()

    def _invalidate_workflow_cert_if_certified(
        self, db: Session, workflow_definition_id: str, reason: str
    ) -> None:
        cert = db.scalar(
            select(WorkflowCertification).where(
                WorkflowCertification.workflow_definition_id == workflow_definition_id
            )
        )
        if cert and cert.status not in {"DRAFT", "NEEDS_REEVALUATION"}:
            cert.status = "NEEDS_REEVALUATION"
            cert.invalidation_reason = reason
            cert.updated_at = utc_now()

    def _evaluation_run_environment_matches(
        self, db: Session, row: EvaluationRun, environment: str | list[str]
    ) -> bool:
        if row.target_type == "tool":
            tool = db.get(ToolRecord, row.target_id)
            return self._environment_matches(tool.environment if tool else None, environment)
        if row.target_type == "agent":
            identity = db.get(AgentIdentity, row.target_id)
            return self._environment_matches(
                identity.environment if identity else None, environment
            )
        if row.target_type == "workflow":
            definition = db.get(WorkflowDefinition, row.target_id)
            return self._environment_matches(
                definition.environment if definition else None, environment
            )
        return True

    def grant_agent_tool(self, agent_id: str, tool_name: str) -> dict[str, Any]:
        with self.session() as db:
            identity = db.get(AgentIdentity, agent_id)
            if not identity:
                raise ValueError(f"Agent '{agent_id}' not found")

            permissions = dict(identity.permissions or {})
            tools = sorted(set(permissions.get("tools", [])) | {tool_name})
            permissions["tools"] = tools
            identity.permissions = permissions
            identity.updated_at = utc_now()
            self._invalidate_agent_cert_if_certified(db, agent_id, "tool grants changed")
            db.flush()
            cert = db.scalar(
                select(AgentCertification).where(AgentCertification.agent_id == agent_id)
            )
            return self._agent_identity_to_dict(identity, cert)

    def revoke_agent_tool(self, agent_id: str, tool_name: str) -> dict[str, Any]:
        with self.session() as db:
            identity = db.get(AgentIdentity, agent_id)
            if not identity:
                raise ValueError(f"Agent '{agent_id}' not found")

            permissions = dict(identity.permissions or {})
            permissions["tools"] = [
                tool for tool in permissions.get("tools", []) if tool != tool_name
            ]
            identity.permissions = permissions
            identity.updated_at = utc_now()
            self._invalidate_agent_cert_if_certified(db, agent_id, "tool grants changed")
            db.flush()
            cert = db.scalar(
                select(AgentCertification).where(AgentCertification.agent_id == agent_id)
            )
            return self._agent_identity_to_dict(identity, cert)

    def ensure_agent_session(self, session_id: str, agent_id: str, user_query: str) -> None:
        with self.session() as db:
            if not db.get(AgentIdentity, agent_id):
                raise ValueError(f"Agent '{agent_id}' not found")
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
        with self.session() as db:
            if not db.get(AgentIdentity, lead_agent_id):
                raise ValueError(f"Agent '{lead_agent_id}' not found")
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
        with self.session() as db:
            if not db.get(AgentIdentity, agent_id):
                raise ValueError(f"Agent '{agent_id}' not found")
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
        policy_id: str | None = None,
        stage: str | None = None,
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
                    policy_id=policy_id,
                    stage=stage,
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
                    select(func.count())
                    .select_from(ToolCall)
                    .where(
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
            rows = db.scalars(
                select(AuditEvent).order_by(desc(AuditEvent.created_at)).limit(limit)
            ).all()
            events = []
            for row in rows:
                identity = db.get(AgentIdentity, row.agent_id)
                if not self._environment_matches(
                    identity.environment if identity else None, environment
                ):
                    continue
                workflow_link = db.scalar(
                    select(WorkflowSessionLink)
                    .where(WorkflowSessionLink.session_id == row.session_id)
                    .limit(1)
                )
                if workflow_only and not workflow_link:
                    continue
                metadata = row.metadata_json or {}
                events.append(
                    {
                        "event_id": row.event_id,
                        "session_id": row.session_id,
                        "workflow_id": workflow_link.workflow_id if workflow_link else None,
                        "agent_id": row.agent_id,
                        "environment": identity.environment if identity else None,
                        "risk_type": row.risk_type,
                        "decision": row.decision,
                        "reason": row.reason,
                        "tool_name": row.tool_name,
                        "risk_score": row.risk_score,
                        "policy_id": row.policy_id,
                        "stage": row.stage
                        if row.stage is not None
                        else (row.metadata_json or {}).get("stage"),
                        "policy_snapshot_hash": (row.metadata_json or {}).get(
                            "policy_snapshot_hash"
                        ),
                        "metadata": metadata,
                        "created_at": row.created_at.isoformat(),
                    }
                )
            return events

    def list_review_queue(
        self,
        limit: int = 100,
        environment: str | list[str] | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        with self.session() as db:
            stmt = select(ReviewQueueItem).order_by(desc(ReviewQueueItem.created_at)).limit(limit)
            if not status or status == "ALL":
                pass  # return all statuses
            else:
                stmt = stmt.where(ReviewQueueItem.status == status)

            rows = db.scalars(stmt).all()
            reviews = []
            for row in rows:
                identity = db.get(AgentIdentity, row.agent_id)
                if not self._environment_matches(
                    identity.environment if identity else None, environment
                ):
                    continue
                workflow_link = db.scalar(
                    select(WorkflowSessionLink)
                    .where(WorkflowSessionLink.session_id == row.session_id)
                    .limit(1)
                )
                reviews.append(
                    {
                        "review_id": row.review_id,
                        "session_id": row.session_id,
                        "workflow_id": workflow_link.workflow_id if workflow_link else None,
                        "agent_id": row.agent_id,
                        "environment": identity.environment if identity else None,
                        "tool_name": row.tool_name,
                        "tool_args": row.tool_args,
                        "user_query": row.user_query,
                        "risk_score": row.risk_score,
                        "risk_types": row.risk_types,
                        "reason": row.reason,
                        "status": row.status,
                        "reviewer_note": row.reviewer_note,
                        "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
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

    def list_sessions(
        self, limit: int = 50, environment: str | list[str] | None = None
    ) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(AgentSession).order_by(desc(AgentSession.created_at)).limit(limit)
            ).all()
            sessions = []
            for row in rows:
                identity = db.get(AgentIdentity, row.agent_id)
                if not self._environment_matches(
                    identity.environment if identity else None, environment
                ):
                    continue
                sessions.append(
                    {
                        "session_id": row.session_id,
                        "agent_id": row.agent_id,
                        "agent_identity": self._agent_identity_to_dict(identity)
                        if identity
                        else None,
                        "user_query": row.user_query,
                        "status": row.status,
                        "created_at": row.created_at.isoformat(),
                        "updated_at": row.updated_at.isoformat(),
                    }
                )
            return sessions

    def list_agent_workflows(
        self, limit: int = 50, environment: str | list[str] | None = None
    ) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(AgentWorkflow).order_by(desc(AgentWorkflow.created_at)).limit(limit)
            ).all()
            workflows = []
            for row in rows:
                lead_identity = db.get(AgentIdentity, row.lead_agent_id)
                if not self._environment_matches(
                    lead_identity.environment if lead_identity else None, environment
                ):
                    continue
                session_count = db.scalar(
                    select(func.count())
                    .select_from(WorkflowSessionLink)
                    .where(WorkflowSessionLink.workflow_id == row.workflow_id)
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
                "lead_agent": self._agent_identity_to_dict(
                    db.get(AgentIdentity, workflow.lead_agent_id)
                ),
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
    def _agent_identity_to_dict(
        identity: AgentIdentity | None, cert: AgentCertification | None = None
    ) -> dict[str, Any]:
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
            "certification": GovernanceStore._agent_certification_to_dict(cert) if cert else None,
            "created_at": identity.created_at.isoformat(),
            "updated_at": identity.updated_at.isoformat(),
        }

    @staticmethod
    def _workflow_definition_to_dict(
        definition: WorkflowDefinition | None,
        cert: WorkflowCertification | None = None,
    ) -> dict[str, Any]:
        if not definition:
            return {}
        return {
            "workflow_definition_id": definition.workflow_definition_id,
            "name": definition.name,
            "description": definition.description,
            "owner": definition.owner,
            "environment": definition.environment,
            "domain": definition.domain,
            "lead_agent_id": definition.lead_agent_id,
            "trigger_type": definition.trigger_type,
            "steps": definition.steps or [],
            "nodes": definition.nodes or [],
            "edges": definition.edges or [],
            "policy_bindings": definition.policy_bindings or {},
            "review_rules": definition.review_rules or {},
            "graph_version_hash": definition.graph_version_hash,
            "metadata": definition.metadata_json or {},
            "certification": GovernanceStore._workflow_certification_to_dict(cert)
            if cert
            else None,
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
        permissions_by_environment = {
            row.environment: sorted(row.permissions or []) for row in rows
        }
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
        return (
            "*" in permissions
            or permission in permissions
            or "read" in permissions
            and permission == "read"
        )

    @staticmethod
    def _environment_matches(
        row_environment: str | None, requested: str | list[str] | None
    ) -> bool:
        if not requested or requested == "all":
            return True
        if isinstance(requested, list):
            return row_environment in requested
        return row_environment == requested

    def list_knowledge_bases(
        self, environment: str | list[str] | None = None
    ) -> list[dict[str, Any]]:
        with self.session() as db:
            stmt = select(KnowledgeBase).order_by(KnowledgeBase.display_name)
            if isinstance(environment, list):
                stmt = stmt.where(KnowledgeBase.environment.in_(environment))
            elif environment and environment != "all":
                stmt = stmt.where(KnowledgeBase.environment == environment)
            rows = db.scalars(stmt).all()
            payloads = [self._kb_to_dict(row) for row in rows]
            for payload in payloads:
                kb_id = payload["kb_id"]
                payload["source_count"] = db.scalar(
                    select(func.count())
                    .select_from(KnowledgeSource)
                    .where(KnowledgeSource.kb_id == kb_id)
                )
                payload["assigned_agent_count"] = db.scalar(
                    select(func.count())
                    .select_from(AgentKBAssignment)
                    .where(AgentKBAssignment.kb_id == kb_id)
                )
                latest_index = db.scalar(
                    select(KnowledgeIndexVersion)
                    .where(KnowledgeIndexVersion.kb_id == kb_id)
                    .order_by(KnowledgeIndexVersion.created_at.desc())
                )
                payload["latest_index"] = (
                    self._kb_index_to_dict(latest_index) if latest_index else None
                )
            return payloads

    def get_knowledge_base(self, kb_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            row = db.get(KnowledgeBase, kb_id)
            return self._kb_to_dict(row) if row else None

    def upsert_knowledge_base(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            row = db.get(KnowledgeBase, payload["kb_id"])
            explicit_source_config = payload.get("source_config")
            source_config = (
                dict(explicit_source_config)
                if explicit_source_config
                else dict(row.source_config or {})
                if row
                else {}
            )
            if "embedding_model" in payload:
                source_config["embedding_model"] = payload["embedding_model"]
            if not row:
                row = KnowledgeBase(
                    kb_id=payload["kb_id"],
                    display_name=payload["display_name"],
                    description=payload.get("description") or "",
                    source_type=payload["source_type"],
                    source_config=source_config,
                    environment=payload["environment"],
                    owner=payload["owner"] if "owner" in payload else "Unassigned",
                    domain=payload["domain"] if "domain" in payload else "",
                    sensitivity=payload["sensitivity"] if "sensitivity" in payload else "internal",
                    status=payload["status"] if "status" in payload else "draft",
                )
                db.add(row)
            else:
                row.display_name = payload["display_name"]
                row.description = payload.get("description") or ""
                row.source_type = payload["source_type"]
                row.source_config = source_config
                row.environment = payload["environment"]
                if "owner" in payload:
                    row.owner = payload["owner"]
                if "domain" in payload:
                    row.domain = payload["domain"]
                if "sensitivity" in payload:
                    row.sensitivity = payload["sensitivity"]
                if "status" in payload:
                    row.status = payload["status"]
                row.updated_at = utc_now()
            db.flush()
            return self._kb_to_dict(row)

    def get_knowledge_base_detail(self, kb_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            row = db.get(KnowledgeBase, kb_id)
            if not row:
                return None
            payload = self._kb_to_dict(row)
            sources = db.scalars(
                select(KnowledgeSource)
                .where(KnowledgeSource.kb_id == kb_id)
                .order_by(KnowledgeSource.created_at.desc())
            ).all()
            latest_index = db.scalar(
                select(KnowledgeIndexVersion)
                .where(KnowledgeIndexVersion.kb_id == kb_id)
                .order_by(KnowledgeIndexVersion.created_at.desc())
            )
            assignments = db.scalars(
                select(AgentKBAssignment).where(AgentKBAssignment.kb_id == kb_id)
            ).all()
            payload["source_count"] = len(sources)
            payload["assigned_agent_count"] = len(assignments)
            payload["latest_index"] = self._kb_index_to_dict(latest_index) if latest_index else None
            return payload

    def list_knowledge_sources(self, kb_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(KnowledgeSource)
                .where(KnowledgeSource.kb_id == kb_id)
                .order_by(KnowledgeSource.display_name)
            ).all()
            return [self._kb_source_to_dict(row) for row in rows]

    def upsert_knowledge_source(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            if not db.get(KnowledgeBase, kb_id):
                raise ValueError(f"Knowledge base {kb_id!r} not found")

            source_id = payload.get("source_id") or new_id("kbs")
            row = db.get(KnowledgeSource, source_id)
            if not row:
                row = KnowledgeSource(
                    source_id=source_id,
                    kb_id=kb_id,
                    source_type=payload["source_type"],
                    display_name=payload["display_name"],
                    uri=payload.get("uri") or "",
                    content_type=payload.get("content_type") or "",
                    source_config=payload.get("source_config") or {},
                    status=payload["status"] if "status" in payload else "pending",
                )
                db.add(row)
            else:
                if row.kb_id != kb_id:
                    raise ValueError(
                        f"Knowledge source '{source_id}' belongs to knowledge base "
                        f"'{row.kb_id}', not '{kb_id}'"
                    )
                row.source_type = payload["source_type"]
                row.display_name = payload["display_name"]
                row.uri = payload.get("uri") or ""
                row.content_type = payload.get("content_type") or ""
                row.source_config = payload.get("source_config") or {}
                if "status" in payload:
                    row.status = payload["status"]
                row.updated_at = utc_now()
            db.flush()
            return self._kb_source_to_dict(row)

    def create_knowledge_document(
        self, kb_id: str, source_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        with self.session() as db:
            if not db.get(KnowledgeBase, kb_id):
                raise ValueError(f"Knowledge base {kb_id!r} not found")
            source = db.get(KnowledgeSource, source_id)
            if not source or source.kb_id != kb_id:
                raise ValueError(f"Knowledge source {source_id!r} not found for {kb_id!r}")
            status = self._validate_knowledge_document_status(
                payload.get("status") or "uploaded"
            )
            row = KnowledgeDocument(
                document_id=new_id("kbd"),
                kb_id=kb_id,
                source_id=source_id,
                file_name=payload["file_name"],
                content_type=payload.get("content_type") or "",
                storage_uri=payload["storage_uri"],
                size_bytes=int(payload.get("size_bytes") or 0),
                checksum=payload["checksum"],
                status=status,
            )
            db.add(row)
            source.status = "pending"
            source.checksum = row.checksum
            source.updated_at = utc_now()
            db.flush()
            return self._kb_document_to_dict(row)

    def list_knowledge_documents(self, kb_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(KnowledgeDocument)
                .where(KnowledgeDocument.kb_id == kb_id)
                .order_by(KnowledgeDocument.created_at.desc())
            ).all()
            return [self._kb_document_to_dict(row) for row in rows]

    def get_knowledge_document(self, document_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            row = db.get(KnowledgeDocument, document_id)
            return self._kb_document_to_dict(row) if row else None

    def mark_knowledge_document_status(
        self, document_id: str, status: str, error: str | None = None
    ) -> dict[str, Any]:
        status = self._validate_knowledge_document_status(status)
        with self.session() as db:
            row = db.get(KnowledgeDocument, document_id)
            if not row:
                raise ValueError(f"Knowledge document {document_id!r} not found")
            row.status = status
            row.last_error = error
            row.updated_at = utc_now()
            source = db.get(KnowledgeSource, row.source_id)
            if source:
                self._refresh_source_document_health(db, source, fallback_status=status)
                source.updated_at = utc_now()
            db.flush()
            return self._kb_document_to_dict(row)

    def mark_knowledge_document_indexed(
        self, document_id: str, chunk_count: int
    ) -> dict[str, Any]:
        with self.session() as db:
            row = db.get(KnowledgeDocument, document_id)
            if not row:
                raise ValueError(f"Knowledge document {document_id!r} not found")
            indexed_at = utc_now()
            row.status = "indexed"
            row.chunk_count = chunk_count
            row.last_error = None
            row.indexed_at = indexed_at
            row.updated_at = indexed_at
            source = db.get(KnowledgeSource, row.source_id)
            if source:
                self._refresh_source_document_health(db, source, fallback_status="ready")
                source.last_synced_at = indexed_at
                source.updated_at = indexed_at
            db.flush()
            return self._kb_document_to_dict(row)

    def replace_knowledge_chunks(
        self, document_id: str, index_version_id: str | None, chunks: list[dict[str, Any]]
    ) -> int:
        with self.session() as db:
            document = db.get(KnowledgeDocument, document_id)
            if not document:
                raise ValueError(f"Knowledge document {document_id!r} not found")
            self._knowledge_index_for_kb(db, document.kb_id, index_version_id)
            db.query(KnowledgeChunk).filter(
                KnowledgeChunk.document_id == document_id,
                KnowledgeChunk.index_version_id == index_version_id,
            ).delete()
            for chunk in chunks:
                db.add(
                    KnowledgeChunk(
                        chunk_id=new_id("kbc"),
                        kb_id=document.kb_id,
                        source_id=document.source_id,
                        document_id=document.document_id,
                        index_version_id=index_version_id,
                        chunk_index=int(chunk["chunk_index"]),
                        content=chunk["content"],
                        content_hash=chunk["content_hash"],
                        embedding=chunk["embedding"],
                        metadata_json=chunk.get("metadata") or {},
                    )
                )
            db.flush()
            return len(chunks)

    def create_knowledge_index_version(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            kb = db.get(KnowledgeBase, kb_id)
            if not kb:
                raise ValueError(f"Knowledge base {kb_id!r} not found")

            status = payload.get("status") or "pending"
            completed_at = utc_now() if status in {"ready", "failed"} else None
            row = KnowledgeIndexVersion(
                index_version_id=new_id("kbi"),
                kb_id=kb_id,
                status=status,
                source_count=int(payload.get("source_count") or 0),
                document_count=int(payload.get("document_count") or 0),
                chunk_count=int(payload.get("chunk_count") or 0),
                embedding_model=payload.get("embedding_model") or "",
                vector_backend=payload.get("vector_backend") or "local",
                artifact_digest=payload.get("artifact_digest"),
                error=payload.get("error"),
                completed_at=completed_at,
            )
            db.add(row)
            if row.status == "ready":
                kb.status = "ready"
                kb.document_count = row.document_count
                kb.chunk_count = row.chunk_count
                kb.last_indexed_at = row.completed_at
                kb.last_error = None
                kb.updated_at = utc_now()
            elif row.status == "failed":
                kb.status = "failed"
                kb.last_error = row.error
                kb.updated_at = utc_now()
            db.flush()
            return self._kb_index_to_dict(row)

    def refresh_knowledge_base_index_state(
        self, kb_id: str, index_version_id: str | None = None
    ) -> dict[str, Any]:
        with self.session() as db:
            kb = db.get(KnowledgeBase, kb_id)
            if not kb:
                raise ValueError(f"Knowledge base {kb_id!r} not found")
            index = (
                self._knowledge_index_for_kb(db, kb_id, index_version_id)
                if index_version_id
                else None
            )
            if index:
                document_count = int(
                    db.scalar(
                        select(func.count(func.distinct(KnowledgeChunk.document_id)))
                        .select_from(KnowledgeChunk)
                        .join(
                            KnowledgeDocument,
                            KnowledgeDocument.document_id == KnowledgeChunk.document_id,
                        )
                        .where(
                            KnowledgeChunk.kb_id == kb_id,
                            KnowledgeChunk.index_version_id == index_version_id,
                            KnowledgeDocument.status == "indexed",
                        )
                    )
                    or 0
                )
                chunk_count = int(
                    db.scalar(
                        select(func.count())
                        .select_from(KnowledgeChunk)
                        .join(
                            KnowledgeDocument,
                            KnowledgeDocument.document_id == KnowledgeChunk.document_id,
                        )
                        .where(
                            KnowledgeChunk.kb_id == kb_id,
                            KnowledgeChunk.index_version_id == index_version_id,
                            KnowledgeDocument.status == "indexed",
                        )
                    )
                    or 0
                )
            else:
                document_count = int(
                    db.scalar(
                        select(func.count())
                        .select_from(KnowledgeDocument)
                        .where(
                            KnowledgeDocument.kb_id == kb_id,
                            KnowledgeDocument.status == "indexed",
                        )
                    )
                    or 0
                )
                chunk_count = int(
                    db.scalar(
                        select(func.count())
                        .select_from(KnowledgeChunk)
                        .join(
                            KnowledgeDocument,
                            KnowledgeDocument.document_id == KnowledgeChunk.document_id,
                        )
                        .where(
                            KnowledgeChunk.kb_id == kb_id,
                            KnowledgeDocument.status == "indexed",
                        )
                    )
                    or 0
                )
            failed_count = int(
                db.scalar(
                    select(func.count())
                    .select_from(KnowledgeDocument)
                    .where(
                        KnowledgeDocument.kb_id == kb_id,
                        KnowledgeDocument.status == "failed",
                    )
                )
                or 0
            )
            indexed_at = utc_now()
            kb.document_count = document_count
            kb.chunk_count = chunk_count
            kb.status = (
                "degraded"
                if failed_count and chunk_count
                else "failed"
                if failed_count
                else "ready"
                if chunk_count
                else "draft"
            )
            kb.last_error = (
                KNOWLEDGE_DOCUMENT_INGESTION_ERROR
                if kb.status in {"degraded", "failed"}
                else None
            )
            kb.last_indexed_at = indexed_at if chunk_count else kb.last_indexed_at
            kb.updated_at = indexed_at
            if index:
                index.status = (
                    "degraded"
                    if failed_count and chunk_count
                    else "failed"
                    if failed_count
                    else "ready"
                    if chunk_count
                    else "pending"
                )
                index.document_count = document_count
                index.chunk_count = chunk_count
                index.completed_at = indexed_at if index.status != "pending" else None
                index.error = kb.last_error
            db.flush()
            return self._kb_to_dict(kb)

    def list_agent_kb_assignments(self, agent_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(AgentKBAssignment)
                .where(AgentKBAssignment.agent_id == agent_id)
                .order_by(AgentKBAssignment.kb_id)
            ).all()
            return [self._kb_assignment_to_dict(row) for row in rows]

    def upsert_agent_kb_assignment(
        self,
        *,
        agent_id: str,
        kb_id: str,
        access_mode: str,
        retrieval_mode: str = _UNSET,
        top_k: int = _UNSET,
        score_threshold: float | None = _UNSET,
        citation_required: bool = _UNSET,
        freshness_days: int | None = _UNSET,
        metadata_filters: dict[str, Any] | None = _UNSET,
    ) -> dict[str, Any]:
        with self.session() as db:
            row = db.scalar(
                select(AgentKBAssignment).where(
                    AgentKBAssignment.agent_id == agent_id,
                    AgentKBAssignment.kb_id == kb_id,
                )
            )
            if not row:
                row = AgentKBAssignment(
                    assignment_id=new_id("kba"),
                    agent_id=agent_id,
                    kb_id=kb_id,
                    access_mode=access_mode,
                    retrieval_mode=("hybrid" if retrieval_mode is _UNSET else retrieval_mode),
                    top_k=5 if top_k is _UNSET else top_k,
                    score_threshold=(None if score_threshold is _UNSET else score_threshold),
                    citation_required=(True if citation_required is _UNSET else citation_required),
                    freshness_days=(None if freshness_days is _UNSET else freshness_days),
                    metadata_filters=({} if metadata_filters is _UNSET else metadata_filters or {}),
                )
                db.add(row)
            else:
                row.access_mode = access_mode
                if retrieval_mode is not _UNSET:
                    row.retrieval_mode = retrieval_mode
                if top_k is not _UNSET:
                    row.top_k = top_k
                if score_threshold is not _UNSET:
                    row.score_threshold = score_threshold
                if citation_required is not _UNSET:
                    row.citation_required = citation_required
                if freshness_days is not _UNSET:
                    row.freshness_days = freshness_days
                if metadata_filters is not _UNSET:
                    row.metadata_filters = metadata_filters or {}
            self._invalidate_agent_cert_if_certified(
                db, agent_id, "knowledge base assignments changed"
            )
            db.flush()
            return self._kb_assignment_to_dict(row)

    def delete_agent_kb_assignment(self, assignment_id: str) -> bool:
        with self.session() as db:
            row = db.get(AgentKBAssignment, assignment_id)
            if not row:
                return False
            self._invalidate_agent_cert_if_certified(
                db, row.agent_id, "knowledge base assignments changed"
            )
            db.delete(row)
            return True

    @staticmethod
    def _validate_knowledge_document_status(status: str) -> str:
        if status not in KNOWLEDGE_DOCUMENT_STATUSES:
            raise ValueError(f"Unsupported knowledge document status {status!r}")
        return status

    @staticmethod
    def _knowledge_index_for_kb(
        db: Session, kb_id: str, index_version_id: str | None
    ) -> KnowledgeIndexVersion:
        if not index_version_id:
            raise ValueError("Knowledge index version is required")
        index = db.get(KnowledgeIndexVersion, index_version_id)
        if not index:
            raise ValueError(f"Knowledge index version {index_version_id!r} not found")
        if index.kb_id != kb_id:
            raise ValueError(
                f"Knowledge index version {index_version_id!r} belongs to knowledge "
                f"base {index.kb_id!r}, not {kb_id!r}"
            )
        return index

    @staticmethod
    def _refresh_source_document_health(
        db: Session, source: KnowledgeSource, *, fallback_status: str
    ) -> None:
        statuses = list(
            db.scalars(
                select(KnowledgeDocument.status).where(
                    KnowledgeDocument.source_id == source.source_id
                )
            )
        )
        if not statuses:
            source.status = fallback_status
            source.last_error = None
            return
        failed_count = statuses.count("failed")
        if failed_count == len(statuses):
            source.status = "failed"
            source.last_error = KNOWLEDGE_DOCUMENT_INGESTION_ERROR
            return
        if failed_count:
            source.status = "degraded"
            source.last_error = KNOWLEDGE_DOCUMENT_INGESTION_ERROR
            return
        if "indexed" in statuses:
            source.status = "ready"
            source.last_error = None
            return
        source.status = fallback_status
        source.last_error = None

    @staticmethod
    def _kb_to_dict(row: KnowledgeBase | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "kb_id": row.kb_id,
            "display_name": row.display_name,
            "description": row.description,
            "source_type": row.source_type,
            "source_config": row.source_config or {},
            "embedding_model": (row.source_config or {}).get("embedding_model") or "local/default",
            "environment": row.environment,
            "owner": row.owner,
            "domain": row.domain,
            "sensitivity": row.sensitivity,
            "status": row.status,
            "document_count": row.document_count,
            "chunk_count": row.chunk_count,
            "last_indexed_at": row.last_indexed_at.isoformat() if row.last_indexed_at else None,
            "last_error": row.last_error,
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
        }

    @staticmethod
    def _kb_document_to_dict(row: KnowledgeDocument | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "document_id": row.document_id,
            "kb_id": row.kb_id,
            "source_id": row.source_id,
            "file_name": row.file_name,
            "content_type": row.content_type,
            "storage_uri": row.storage_uri,
            "size_bytes": row.size_bytes,
            "checksum": row.checksum,
            "status": row.status,
            "chunk_count": row.chunk_count,
            "last_error": row.last_error,
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
            "indexed_at": row.indexed_at.isoformat() if row.indexed_at else None,
        }

    @staticmethod
    def _kb_source_to_dict(row: KnowledgeSource | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "source_id": row.source_id,
            "kb_id": row.kb_id,
            "source_type": row.source_type,
            "display_name": row.display_name,
            "uri": row.uri,
            "content_type": row.content_type,
            "source_config": row.source_config or {},
            "status": row.status,
            "checksum": row.checksum,
            "last_synced_at": row.last_synced_at.isoformat() if row.last_synced_at else None,
            "last_error": row.last_error,
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
        }

    @staticmethod
    def _kb_index_to_dict(row: KnowledgeIndexVersion | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "index_version_id": row.index_version_id,
            "kb_id": row.kb_id,
            "status": row.status,
            "source_count": row.source_count,
            "document_count": row.document_count,
            "chunk_count": row.chunk_count,
            "embedding_model": row.embedding_model,
            "vector_backend": row.vector_backend,
            "artifact_digest": row.artifact_digest,
            "error": row.error,
            "created_at": row.created_at.isoformat(),
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        }

    @staticmethod
    def _kb_assignment_to_dict(row: AgentKBAssignment | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "assignment_id": row.assignment_id,
            "agent_id": row.agent_id,
            "kb_id": row.kb_id,
            "access_mode": row.access_mode,
            "retrieval_mode": row.retrieval_mode,
            "top_k": row.top_k,
            "score_threshold": row.score_threshold,
            "citation_required": row.citation_required,
            "freshness_days": row.freshness_days,
            "metadata_filters": row.metadata_filters or {},
            "created_at": row.created_at.isoformat(),
        }
