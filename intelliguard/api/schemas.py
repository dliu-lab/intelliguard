from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

KB_CHUNKING_STRATEGY_PATTERN = (
    "^(sentence|token|markdown|json|html|code|semantic|hierarchical|"
    "semantic_sections|fixed_size|qa_pairs|procedure_steps)$"
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
    deployment_id: str | None = None
    idempotency_key: str | None = None


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


class WorkflowDefinitionVersionRequest(BaseModel):
    new_workflow_definition_id: str
    version: str
    change_summary: str = ""


class WorkflowLifecycleTransitionRequest(BaseModel):
    target_status: str


class WorkflowDeploymentRequest(BaseModel):
    runtime_type: Literal["native", "langgraph", "strands", "temporal"] = "native"
    timeout_seconds: int = Field(default=300, gt=0, le=86_400)
    max_parallel_nodes: int = Field(default=4, gt=0, le=128)
    max_tool_calls: int = Field(default=30, gt=0, le=10_000)
    max_llm_calls: int = Field(default=20, gt=0, le=10_000)
    max_cost_usd: float = Field(default=5.0, ge=0)


class ServiceConnectorRequest(BaseModel):
    connector_id: str
    name: str
    connector_type: Literal["http", "mcp"]
    environment: str
    owner: str
    config: dict[str, Any] = Field(default_factory=dict)
    status: str = "ACTIVE"


class ServiceConnectorTestRequest(BaseModel):
    operation: str
    payload: dict[str, Any] = Field(default_factory=dict)


class ScenarioSuiteRequest(BaseModel):
    suite_id: str | None = None
    name: str
    description: str = ""
    workflow_definition_id: str
    environment: str = "demo"
    scenarios: list[dict[str, Any]] = Field(default_factory=list)
    pass_threshold: float = Field(default=1.0, ge=0, le=1)


class ScenarioRunRequest(BaseModel):
    deployment_id: str


class WorkflowDeploymentJobRequest(BaseModel):
    backend: Literal["local_compose", "kubernetes", "temporal", "external_ci"] = "local_compose"
    worker_pool: str = "shared-readonly"


class LoginRequest(BaseModel):
    email: str
    password: str
    role: str | None = None


class LoginRoleOptionsRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    display_name: str
    roles: list[str] = Field(default_factory=lambda: ["Agent Developer"], min_length=1)


class UserEnvironmentGrant(BaseModel):
    environment: str
    permissions: list[str] = Field(default_factory=lambda: ["read"])


class UserCreateRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    display_name: str
    roles: list[str] = Field(default_factory=lambda: ["Agent Developer"], min_length=1)
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
    kb_id: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    description: str = ""
    source_type: str = Field(pattern="^(vector_store|url|file)$", min_length=1)
    source_config: dict[str, Any] = Field(default_factory=dict)
    environment: str = Field(default="demo", min_length=1)
    owner: str = "Unassigned"
    domain: str = ""
    sensitivity: str = "internal"
    embedding_model: str = "local/default"


class KnowledgeBaseCreateWithFilesMetadata(BaseModel):
    kb_id: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    description: str = ""
    owner: str = "Unassigned"
    domain: str = ""
    environment: str = Field(default="demo", min_length=1)
    sensitivity: str = "internal"
    retrieval_mode: str = Field(pattern="^(file|vector)$", default="file")
    kb_scope: str = Field(pattern="^(domain|agent|shared)$", default="domain")
    scope_ref: str = ""
    linked_agent_id: str = ""
    version: str = Field(pattern=r"^v\d+\.\d+\.\d+$", default="v0.1.0")
    notes: str = ""
    vector_backend: str = "pgvector"
    embedding_model: str = "nomic-embed-text"
    chunking_strategy: str = Field(
        pattern=KB_CHUNKING_STRATEGY_PATTERN,
        default="semantic",
    )
    chunk_size: int = Field(default=512, ge=128, le=8192)
    chunk_overlap: int = Field(default=80, ge=0, le=2048)
    index_after_create: bool = False


class KnowledgeBaseVersionRequest(BaseModel):
    version: str = Field(pattern=r"^v\d+\.\d+\.\d+$")
    status: str = Field(pattern="^(draft|indexed|published|archived|failed)$", default="draft")
    notes: str = ""
    profile: dict[str, Any] = Field(default_factory=dict)
    file_manifest: list[dict[str, Any]] | None = None
    retrieval_mode: str = Field(pattern="^(file|vector)$", default="file")
    kb_scope: str = Field(pattern="^(domain|agent|shared)$", default="domain")
    scope_ref: str = ""
    vector_backend: str = "pgvector"
    embedding_model: str = "local/default"
    chunking_strategy: str = Field(
        pattern=KB_CHUNKING_STRATEGY_PATTERN,
        default="semantic",
    )
    chunk_size: int = Field(default=512, ge=128, le=8192)
    chunk_overlap: int = Field(default=80, ge=0, le=2048)
    index_version_id: str | None = None


class KnowledgeSourceRequest(BaseModel):
    source_id: str | None = None
    source_type: str = Field(pattern="^(vector_store|url|file)$", min_length=1)
    display_name: str = Field(min_length=1)
    uri: str = ""
    content_type: str = ""
    source_config: dict[str, Any] = Field(default_factory=dict)


class KnowledgeSyncRequest(BaseModel):
    embedding_model: str | None = None
    vector_backend: str | None = None
    chunk_size: int | None = Field(default=None, ge=128, le=8192)
    chunk_overlap: int | None = Field(default=None, ge=0, le=2048)
    force_reindex: bool = True


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
    score_threshold: float | None = Field(default=None, ge=0, le=1)


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
    metadata: dict[str, Any]
    reviewer_note: str | None
    resolved_at: str | None
    created_at: str
