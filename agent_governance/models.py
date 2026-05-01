from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utc_now() -> datetime:
    return datetime.now(UTC)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:16]}"


class Base(DeclarativeBase):
    pass


class Customer(Base):
    __tablename__ = "customers"

    customer_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(160), nullable=False)
    phone: Mapped[str] = mapped_column(String(40), nullable=False)
    city: Mapped[str] = mapped_column(String(80), nullable=False)
    tier: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class CustomerTransaction(Base):
    __tablename__ = "transactions"

    transaction_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.customer_id"), nullable=False)
    merchant: Mapped[str] = mapped_column(String(120), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="AUD")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SupportCase(Base):
    __tablename__ = "support_cases"

    case_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.customer_id"), nullable=False)
    subject: Mapped[str] = mapped_column(String(180), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class User(Base):
    __tablename__ = "users"

    user_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    email: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str] = mapped_column(String(80), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text)
    is_super_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class UserSession(Base):
    __tablename__ = "user_sessions"

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class UserEnvironmentAccess(Base):
    __tablename__ = "user_environment_access"
    __table_args__ = (
        UniqueConstraint("user_id", "environment", name="uq_user_environment_access"),
    )

    access_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    permissions: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AgentIdentity(Base):
    __tablename__ = "agent_identities"

    agent_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    agent_type: Mapped[str] = mapped_column(String(80), nullable=False)
    owner: Mapped[str] = mapped_column(String(120), nullable=False)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    permissions: Mapped[dict] = mapped_column(JSONB, default=dict)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AgentWorkflow(Base):
    __tablename__ = "agent_workflows"

    workflow_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    user_goal: Mapped[str] = mapped_column(Text, nullable=False)
    lead_agent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="RUNNING")
    decision: Mapped[str | None] = mapped_column(String(24))
    summary: Mapped[str | None] = mapped_column(Text)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkflowDefinition(Base):
    __tablename__ = "workflow_definitions"

    workflow_definition_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    owner: Mapped[str] = mapped_column(String(120), nullable=False)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    lead_agent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    trigger_type: Mapped[str] = mapped_column(String(80), default="manual")
    steps: Mapped[list] = mapped_column(JSONB, default=list)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkflowSessionLink(Base):
    __tablename__ = "workflow_session_links"
    __table_args__ = (
        UniqueConstraint("workflow_id", "session_id", name="uq_workflow_session_link"),
    )

    link_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workflow_id: Mapped[str] = mapped_column(
        ForeignKey("agent_workflows.workflow_id"), nullable=False
    )
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_sessions.session_id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[str] = mapped_column(String(80), nullable=False)
    parent_session_id: Mapped[str | None] = mapped_column(String(64))
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AgentSession(Base):
    __tablename__ = "agent_sessions"

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    user_query: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="RUNNING")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ToolCall(Base):
    __tablename__ = "tool_calls"

    tool_call_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_sessions.session_id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    tool_name: Mapped[str] = mapped_column(String(120), nullable=False)
    tool_args: Mapped[dict] = mapped_column(JSONB, default=dict)
    decision: Mapped[str | None] = mapped_column(String(24))
    result_summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class PolicyDecision(Base):
    __tablename__ = "policy_decisions"

    decision_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_sessions.session_id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    tool_name: Mapped[str | None] = mapped_column(String(120))
    decision: Mapped[str] = mapped_column(String(24), nullable=False)
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)
    risk_types: Mapped[list] = mapped_column(JSONB, default=list)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    triggered_rules: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_sessions.session_id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    risk_type: Mapped[str] = mapped_column(String(80), nullable=False)
    decision: Mapped[str] = mapped_column(String(24), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    tool_name: Mapped[str | None] = mapped_column(String(120))
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    policy_id: Mapped[str | None] = mapped_column(String(64))
    stage: Mapped[str | None] = mapped_column(String(40))
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ReviewQueueItem(Base):
    __tablename__ = "review_queue"

    review_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_sessions.session_id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    tool_name: Mapped[str] = mapped_column(String(120), nullable=False)
    tool_args: Mapped[dict] = mapped_column(JSONB, default=dict)
    user_query: Mapped[str] = mapped_column(Text, nullable=False)
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)
    risk_types: Mapped[list] = mapped_column(JSONB, default=list)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="PENDING")
    reviewer_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorkflowEvent(Base):
    __tablename__ = "workflow_events"
    __table_args__ = (
        UniqueConstraint("session_id", "sequence", name="uq_workflow_session_sequence"),
    )

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_sessions.session_id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class GuardrailPolicy(Base):
    __tablename__ = "guardrail_policies"

    policy_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AgentGuardrailAssignment(Base):
    __tablename__ = "agent_guardrail_assignments"
    __table_args__ = (UniqueConstraint("agent_id", "environment", name="uq_agent_guardrail_env"),)

    assignment_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent_identities.agent_id"), nullable=False)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    policy_id: Mapped[str] = mapped_column(
        ForeignKey("guardrail_policies.policy_id"), nullable=False
    )
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="enforce")
    threshold_overrides: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class EvaluatorTemplate(Base):
    __tablename__ = "evaluator_templates"

    evaluator_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    evaluator_type: Mapped[str] = mapped_column(String(80), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    default_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    llm_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AgentEvaluatorAssignment(Base):
    __tablename__ = "agent_evaluator_assignments"
    __table_args__ = (
        UniqueConstraint("agent_id", "environment", "evaluator_id", name="uq_agent_evaluator_env"),
    )

    assignment_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent_identities.agent_id"), nullable=False)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    evaluator_id: Mapped[str] = mapped_column(
        ForeignKey("evaluator_templates.evaluator_id"), nullable=False
    )
    trigger: Mapped[str] = mapped_column(String(32), nullable=False, default="after_run")
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class EvaluationResult(Base):
    __tablename__ = "evaluation_results"

    result_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_sessions.session_id"), nullable=False)
    workflow_id: Mapped[str | None] = mapped_column(String(64))
    agent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    evaluator_id: Mapped[str] = mapped_column(
        ForeignKey("evaluator_templates.evaluator_id"), nullable=False
    )
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    findings: Mapped[list] = mapped_column(JSONB, default=list)
    trigger: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"

    kb_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)  # "vector_store"|"url"|"file"
    source_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AgentKBAssignment(Base):
    __tablename__ = "agent_kb_assignments"
    __table_args__ = (UniqueConstraint("agent_id", "kb_id", name="uq_agent_kb"),)

    assignment_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent_identities.agent_id"), nullable=False)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.kb_id"), nullable=False)
    access_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="read")  # "read"|"read_write"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
