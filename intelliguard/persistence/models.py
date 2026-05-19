from __future__ import annotations

import os
from datetime import UTC, datetime
from uuid import uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
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


KNOWLEDGE_EMBEDDING_DIMENSION = int(os.getenv("KB_EMBED_DIMENSION", "768"))


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
    roles: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text)
    is_super_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class UserSession(Base):
    __tablename__ = "user_sessions"

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    active_role: Mapped[str | None] = mapped_column(String(80))
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
    workflow_root_id: Mapped[str | None] = mapped_column(String(120))
    version: Mapped[str] = mapped_column(String(40), default="v1")
    version_number: Mapped[int] = mapped_column(Integer, default=1)
    previous_workflow_definition_id: Mapped[str | None] = mapped_column(String(120))
    source_workflow_definition_id: Mapped[str | None] = mapped_column(String(120))
    lifecycle_status: Mapped[str] = mapped_column(String(32), default="DRAFT")
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[str | None] = mapped_column(String(160))
    created_from_deployment_id: Mapped[str | None] = mapped_column(String(120))
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    owner: Mapped[str] = mapped_column(String(120), nullable=False)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    domain: Mapped[str] = mapped_column(String(80), default="general")
    lead_agent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    trigger_type: Mapped[str] = mapped_column(String(80), default="manual")
    steps: Mapped[list] = mapped_column(JSONB, default=list)
    nodes: Mapped[list] = mapped_column(JSONB, default=list)
    edges: Mapped[list] = mapped_column(JSONB, default=list)
    policy_bindings: Mapped[dict] = mapped_column(JSONB, default=dict)
    review_rules: Mapped[dict] = mapped_column(JSONB, default=dict)
    graph_version_hash: Mapped[str | None] = mapped_column(String(64))
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkflowDefinitionVersion(Base):
    __tablename__ = "workflow_definition_versions"
    __table_args__ = (
        UniqueConstraint(
            "workflow_root_id",
            "version_number",
            name="uq_workflow_definition_versions_root_number",
        ),
        UniqueConstraint(
            "workflow_definition_id",
            name="uq_workflow_definition_versions_definition",
        ),
    )

    version_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workflow_root_id: Mapped[str] = mapped_column(String(120), nullable=False)
    workflow_definition_id: Mapped[str] = mapped_column(String(120), nullable=False)
    previous_workflow_definition_id: Mapped[str | None] = mapped_column(String(120))
    source_workflow_definition_id: Mapped[str | None] = mapped_column(String(120))
    version: Mapped[str] = mapped_column(String(40), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    lifecycle_status: Mapped[str] = mapped_column(String(32), default="DRAFT")
    change_summary: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(160), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkflowDeploymentRevision(Base):
    __tablename__ = "workflow_deployment_revisions"

    deployment_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    workflow_definition_id: Mapped[str] = mapped_column(String(120), nullable=False)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    version: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="PACKAGED")
    manifest: Mapped[dict] = mapped_column(JSONB, default=dict)
    manifest_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    graph_version_hash: Mapped[str | None] = mapped_column(String(64))
    agent_config_hashes: Mapped[dict] = mapped_column(JSONB, default=dict)
    tool_config_hashes: Mapped[dict] = mapped_column(JSONB, default=dict)
    evaluator_config_hashes: Mapped[dict] = mapped_column(JSONB, default=dict)
    policy_hashes: Mapped[dict] = mapped_column(JSONB, default=dict)
    kb_version_hashes: Mapped[dict] = mapped_column(JSONB, default=dict)
    runtime_type: Mapped[str] = mapped_column(String(40), default="native")
    runtime_limits: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_by: Mapped[str] = mapped_column(String(160), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorkflowGeneratedArtifact(Base):
    __tablename__ = "workflow_generated_artifacts"

    artifact_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    deployment_id: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    workflow_definition_id: Mapped[str] = mapped_column(String(120), nullable=False)
    artifact_type: Mapped[str] = mapped_column(String(80), nullable=False)
    artifact_name: Mapped[str] = mapped_column(String(240), nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_uri: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="GENERATED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class DeploymentJob(Base):
    __tablename__ = "deployment_jobs"

    job_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    deployment_id: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    backend: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="PENDING", index=True)
    requested_by: Mapped[str] = mapped_column(String(160), default="system")
    image_ref: Mapped[str | None] = mapped_column(Text)
    worker_pool: Mapped[str | None] = mapped_column(String(120))
    logs: Mapped[list] = mapped_column(JSONB, default=list)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkflowRuntimeRun(Base):
    __tablename__ = "workflow_runtime_runs"

    run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    deployment_id: Mapped[str] = mapped_column(String(120), nullable=False)
    workflow_definition_id: Mapped[str] = mapped_column(String(120), nullable=False)
    workflow_id: Mapped[str | None] = mapped_column(String(64))
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="PENDING")
    decision: Mapped[str | None] = mapped_column(String(32))
    idempotency_key: Mapped[str | None] = mapped_column(String(160))
    input_payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    output_payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    runtime_type: Mapped[str] = mapped_column(String(40), default="native")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class RuntimeEventOutbox(Base):
    __tablename__ = "runtime_event_outbox"

    outbox_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), nullable=False)
    workflow_id: Mapped[str | None] = mapped_column(String(64))
    session_id: Mapped[str | None] = mapped_column(String(64))
    event_type: Mapped[str] = mapped_column(String(120), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="PENDING")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    publish_attempts: Mapped[int] = mapped_column(Integer, default=0)


class ServiceConnector(Base):
    __tablename__ = "service_connectors"

    connector_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    connector_type: Mapped[str] = mapped_column(String(80), nullable=False)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="ACTIVE")
    owner: Mapped[str] = mapped_column(String(160), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ScenarioSuite(Base):
    __tablename__ = "scenario_suites"

    suite_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    workflow_definition_id: Mapped[str] = mapped_column(String(120), nullable=False)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    scenarios: Mapped[list] = mapped_column(JSONB, default=list)
    created_by: Mapped[str] = mapped_column(String(160), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ScenarioRun(Base):
    __tablename__ = "scenario_runs"

    scenario_run_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    suite_id: Mapped[str] = mapped_column(String(120), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(120))
    deployment_id: Mapped[str] = mapped_column(String(120), nullable=False)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="PENDING")
    overall_result: Mapped[str | None] = mapped_column(String(32))
    case_total: Mapped[int] = mapped_column(Integer, default=0)
    case_passed: Mapped[int] = mapped_column(Integer, default=0)
    evidence: Mapped[dict] = mapped_column(JSONB, default=dict)
    results: Mapped[dict] = mapped_column(JSONB, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


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
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ToolCall(Base):
    __tablename__ = "tool_calls"

    tool_call_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_sessions.session_id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    tool_name: Mapped[str] = mapped_column(String(120), nullable=False)
    tool_args: Mapped[dict] = mapped_column(JSONB, default=dict)
    idempotency_key: Mapped[str | None] = mapped_column(String(160))
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
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
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


class ToolRecord(Base):
    __tablename__ = "tool_records"

    tool_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tool_name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(String(80), nullable=False, default="custom")
    side_effect_level: Mapped[str] = mapped_column(String(40), nullable=False, default="read_only")
    input_schema: Mapped[dict] = mapped_column(JSONB, default=dict)
    output_schema: Mapped[dict] = mapped_column(JSONB, default=dict)
    permissions: Mapped[dict] = mapped_column(JSONB, default=dict)
    allowed_actions: Mapped[list] = mapped_column(JSONB, default=list)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    owner: Mapped[str] = mapped_column(String(120), nullable=False)
    config_hash: Mapped[str | None] = mapped_column(String(64))
    artifact_digest: Mapped[str | None] = mapped_column(String(128))
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ToolCertification(Base):
    __tablename__ = "tool_certifications"

    certification_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tool_id: Mapped[str] = mapped_column(
        ForeignKey("tool_records.tool_id"), nullable=False, unique=True
    )
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="DRAFT")
    config_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    artifact_digest: Mapped[str | None] = mapped_column(String(128))
    last_evaluation_run_id: Mapped[str | None] = mapped_column(String(64))
    certified_by: Mapped[str | None] = mapped_column(String(160))
    certified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AgentCertification(Base):
    __tablename__ = "agent_certifications"

    certification_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_id: Mapped[str] = mapped_column(
        ForeignKey("agent_identities.agent_id"), nullable=False, unique=True
    )
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="DRAFT")
    config_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    invalidation_reason: Mapped[str | None] = mapped_column(String(200))
    last_evaluation_run_id: Mapped[str | None] = mapped_column(String(64))
    certified_by: Mapped[str | None] = mapped_column(String(160))
    certified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkflowCertification(Base):
    __tablename__ = "workflow_certifications"

    certification_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workflow_definition_id: Mapped[str] = mapped_column(
        ForeignKey("workflow_definitions.workflow_definition_id"),
        nullable=False,
        unique=True,
    )
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="DRAFT")
    config_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    invalidation_reason: Mapped[str | None] = mapped_column(String(200))
    last_evaluation_run_id: Mapped[str | None] = mapped_column(String(64))
    certified_by: Mapped[str | None] = mapped_column(String(160))
    certified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class EvaluationRun(Base):
    __tablename__ = "evaluation_runs"

    run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[str] = mapped_column(String(120), nullable=False)
    config_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    artifact_digest: Mapped[str | None] = mapped_column(String(128))
    triggered_by: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="RUNNING")
    overall_result: Mapped[str | None] = mapped_column(String(20))
    criteria_total: Mapped[int] = mapped_column(Integer, default=0)
    criteria_passed: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EvaluationCriterionResult(Base):
    __tablename__ = "evaluation_criterion_results"

    criterion_result_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("evaluation_runs.run_id"), nullable=False)
    evaluator_id: Mapped[str] = mapped_column(String(64), nullable=False)
    criterion_name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    score: Mapped[int | None] = mapped_column(Integer)
    evidence_sentence: Mapped[str] = mapped_column(Text, nullable=False)
    observed_value: Mapped[dict] = mapped_column(JSONB, default=dict)
    expected_value: Mapped[dict] = mapped_column(JSONB, default=dict)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    input_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"

    kb_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source_type: Mapped[str] = mapped_column(
        String(40), nullable=False
    )  # "vector_store"|"url"|"file"
    source_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    owner: Mapped[str] = mapped_column(String(120), nullable=False, default="Unassigned")
    domain: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    sensitivity: Mapped[str] = mapped_column(String(40), nullable=False, default="internal")
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="draft")
    document_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class KnowledgeSource(Base):
    __tablename__ = "knowledge_sources"

    source_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.kb_id"), nullable=False)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    uri: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_type: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    source_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="pending")
    checksum: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    document_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.kb_id"), nullable=False)
    source_id: Mapped[str] = mapped_column(
        ForeignKey("knowledge_sources.source_id"), nullable=False
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), default="")
    storage_uri: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    checksum: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="uploaded")
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"

    chunk_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.kb_id"), nullable=False)
    source_id: Mapped[str] = mapped_column(
        ForeignKey("knowledge_sources.source_id"), nullable=False
    )
    document_id: Mapped[str] = mapped_column(
        ForeignKey("knowledge_documents.document_id"), nullable=False
    )
    index_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("knowledge_index_versions.index_version_id")
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(KNOWLEDGE_EMBEDDING_DIMENSION))
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class KnowledgeIndexVersion(Base):
    __tablename__ = "knowledge_index_versions"

    index_version_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.kb_id"), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="pending")
    source_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    document_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    embedding_model: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    vector_backend: Mapped[str] = mapped_column(String(80), nullable=False, default="local")
    artifact_digest: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class KnowledgeBaseVersion(Base):
    __tablename__ = "knowledge_base_versions"
    __table_args__ = (UniqueConstraint("kb_id", "version", name="uq_knowledge_base_version_label"),)

    version_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.kb_id"), nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="draft")
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    profile: Mapped[dict] = mapped_column(JSONB, default=dict)
    file_manifest: Mapped[list] = mapped_column(JSONB, default=list)
    retrieval_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="file")
    kb_scope: Mapped[str] = mapped_column(String(20), nullable=False, default="domain")
    scope_ref: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    vector_backend: Mapped[str] = mapped_column(String(80), nullable=False, default="pgvector")
    embedding_model: Mapped[str] = mapped_column(
        String(160), nullable=False, default="local/default"
    )
    chunking_strategy: Mapped[str] = mapped_column(String(40), nullable=False, default="semantic")
    chunk_size: Mapped[int] = mapped_column(Integer, nullable=False, default=1024)
    chunk_overlap: Mapped[int] = mapped_column(Integer, nullable=False, default=160)
    index_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("knowledge_index_versions.index_version_id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentKBAssignment(Base):
    __tablename__ = "agent_kb_assignments"
    __table_args__ = (UniqueConstraint("agent_id", "kb_id", name="uq_agent_kb"),)

    assignment_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent_identities.agent_id"), nullable=False)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.kb_id"), nullable=False)
    access_mode: Mapped[str] = mapped_column(
        String(20), nullable=False, default="read"
    )  # "read"|"read_write"
    retrieval_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="hybrid")
    top_k: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    score_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    citation_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    freshness_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_filters: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
