export type AuthUser = {
  email: string;
  name: string;
  role: string;
  is_super_admin: boolean;
  allowed_environments: string[];
  permissions_by_environment: Record<string, string[]>;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

export type BootstrapStatus = {
  requires_initial_admin: boolean;
  signup_roles: string[];
};

export type ApiRecord = Record<string, unknown>;
export type KnowledgeChunkingStrategy =
  | "sentence"
  | "token"
  | "markdown"
  | "json"
  | "html"
  | "code"
  | "semantic"
  | "hierarchical";

export type CertificationStatus = "DRAFT" | "EVALUATING" | "CERTIFIED" | "FAILED" | "NEEDS_REEVALUATION";

export type KnowledgeSourcePayload = {
  source_id?: string;
  source_type: "vector_store" | "url" | "file";
  display_name: string;
  uri?: string;
  content_type?: string;
  source_config?: ApiRecord;
};

export type KnowledgeBaseVersionPayload = {
  version: string;
  status?: "draft" | "indexed" | "published" | "archived" | "failed";
  notes?: string;
  profile?: ApiRecord;
  file_manifest?: ApiRecord[] | null;
  retrieval_mode?: "file" | "vector";
  kb_scope?: "domain" | "agent" | "shared";
  scope_ref?: string;
  vector_backend?: string;
  embedding_model?: string;
  chunking_strategy?: KnowledgeChunkingStrategy;
  chunk_size?: number;
  chunk_overlap?: number;
  index_version_id?: string | null;
};

export type KnowledgeBaseCreateWithFilesPayload = {
  kb_id: string;
  display_name: string;
  description?: string;
  owner?: string;
  domain?: string;
  environment: string;
  sensitivity?: string;
  retrieval_mode: "file" | "vector";
  kb_scope: "domain" | "agent" | "shared";
  scope_ref?: string;
  linked_agent_id?: string;
  version: string;
  notes?: string;
  vector_backend?: string;
  embedding_model?: string;
  chunking_strategy?: KnowledgeChunkingStrategy;
  chunk_size?: number;
  chunk_overlap?: number;
  index_after_create?: boolean;
};

export type EvaluationRun = {
  run_id: string;
  target_type: string;
  target_id: string;
  config_hash: string;
  artifact_digest?: string | null;
  triggered_by: string;
  status: string;
  overall_result: string | null;
  criteria_total: number;
  criteria_passed: number;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
};

export type CriterionResult = {
  criterion_result_id: string;
  run_id: string;
  evaluator_id: string;
  criterion_name: string;
  status: "PASS" | "FAIL" | "REVIEW";
  score: number | null;
  evidence_sentence: string;
  input_snapshot: Record<string, unknown>;
  observed_value: Record<string, unknown>;
  expected_value: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AgentCertification = {
  certification_id: string;
  agent_id: string;
  status: CertificationStatus;
  config_hash: string;
  invalidation_reason: string | null;
  last_evaluation_run_id: string | null;
  certified_by: string | null;
  certified_at: string | null;
  expires_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type PlatformData = {
  agents: ApiRecord[];
  agentAssignmentCounts: Record<string, { guardrails: number; evaluators: number; knowledge: number }>;
  agentAssignments: Record<string, { guardrails: ApiRecord[]; evaluators: ApiRecord[]; knowledge: ApiRecord[] }>;
  workflowDefinitions: ApiRecord[];
  workflows: ApiRecord[];
  workflowDetails: ApiRecord[];
  sessions: ApiRecord[];
  reviewQueue: ApiRecord[];
  auditEvents: ApiRecord[];
  guardrailPolicies: ApiRecord[];
  evaluatorTemplates: ApiRecord[];
  evaluationRules: ApiRecord[];
  evaluationRuns: EvaluationRun[];
  knowledgeBases: ApiRecord[];
  tools: ApiRecord[];
  monitoringMetrics: ApiRecord | null;
  environments: string[];
};

export type WorkflowDeploymentPayload = {
  runtime_type?: "native" | "langgraph" | "strands" | "temporal";
  timeout_seconds?: number;
  max_parallel_nodes?: number;
  max_tool_calls?: number;
  max_llm_calls?: number;
  max_cost_usd?: number;
};

export type DeploymentJobPayload = {
  backend?: "local_compose" | "kubernetes" | "temporal" | "external_ci";
  worker_pool?: string;
};

type AgentAssignments = { guardrails: ApiRecord[]; evaluators: ApiRecord[]; knowledge: ApiRecord[] };

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const SESSION_STORAGE_KEY = "governance-session";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();

    try {
      const payload = JSON.parse(text) as { detail?: string; message?: string };
      throw new Error(payload.detail || payload.message || text);
    } catch (error) {
      if (error instanceof Error && error.message !== text) {
        throw error;
      }

      throw new Error(text || `Request failed: ${response.status}`);
    }
  }

  return response.json() as Promise<T>;
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

function withParams(path: string, params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  });

  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function bootstrapStatus() {
  return request<BootstrapStatus>("/v1/auth/bootstrap-status");
}

export function login(payload: { email: string; password: string; role?: string }) {
  return request<AuthSession>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function register(payload: {
  email: string;
  password: string;
  display_name: string;
  role: string;
}) {
  return request<AuthSession>("/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function me(token: string) {
  return request<AuthUser>("/v1/me", {
    headers: authHeaders(token),
  });
}

export function listAgents(token: string, environment = "all") {
  return request<ApiRecord[]>(withParams("/v1/agents", { environment }), {
    headers: authHeaders(token),
  });
}

export function listWorkflows(token: string, limit = 50, environment = "all") {
  return request<ApiRecord[]>(withParams("/v1/workflows", { limit, environment }), {
    headers: authHeaders(token),
  });
}

export function getWorkflowDetail(token: string, workflowId: string) {
  return request<ApiRecord>(`/v1/workflows/${encodeURIComponent(workflowId)}`, {
    headers: authHeaders(token),
  });
}

export function listWorkflowDefinitions(token: string, environment = "all") {
  return request<ApiRecord[]>(withParams("/v1/workflow-definitions", { environment }), {
    headers: authHeaders(token),
  });
}

export function listSessions(token: string, limit = 50, environment = "all") {
  return request<ApiRecord[]>(withParams("/v1/sessions", { limit, environment }), {
    headers: authHeaders(token),
  });
}

export function listReviewQueue(token: string, limit = 100, environment = "all") {
  return request<ApiRecord[]>(withParams("/v1/review-queue", { limit, environment, status: "ALL" }), {
    headers: authHeaders(token),
  });
}

export function resolveReview(
  token: string,
  reviewId: string,
  payload: { status: "APPROVED" | "DENIED"; reviewer_note?: string },
) {
  return request<ApiRecord>(`/v1/review-queue/${encodeURIComponent(reviewId)}/resolve`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function listAuditEvents(token: string, limit = 100, environment = "all") {
  return request<ApiRecord[]>(withParams("/v1/audit-events", { limit, environment }), {
    headers: authHeaders(token),
  });
}

export function listGuardrailPolicies(token: string, environment = "all") {
  return request<ApiRecord[]>(withParams("/v1/guardrail-policies", { environment }), {
    headers: authHeaders(token),
  });
}

export function listEvaluatorTemplates(token: string) {
  return request<ApiRecord[]>("/v1/evaluator-templates", {
    headers: authHeaders(token),
  });
}

export function listKnowledgeBases(token: string, environment = "all") {
  return request<ApiRecord[]>(withParams("/v1/knowledge-bases", { environment }), {
    headers: authHeaders(token),
  });
}

export function getKnowledgeBaseDetail(token: string, kbId: string) {
  return request<ApiRecord>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}`, {
    headers: authHeaders(token),
  });
}

export function listKnowledgeSources(token: string, kbId: string) {
  return request<ApiRecord[]>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/sources`, {
    headers: authHeaders(token),
  });
}

export function listKnowledgeDocuments(token: string, kbId: string) {
  return request<ApiRecord[]>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents`, {
    headers: authHeaders(token),
  });
}

export function listKnowledgeBaseVersions(token: string, kbId: string) {
  return request<ApiRecord[]>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/versions`, {
    headers: authHeaders(token),
  });
}

export function createKnowledgeBaseVersion(
  token: string,
  kbId: string,
  payload: KnowledgeBaseVersionPayload,
) {
  return request<ApiRecord>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/versions`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function createKnowledgeBaseWithFiles(
  token: string,
  payload: KnowledgeBaseCreateWithFilesPayload,
  files: File[],
) {
  const body = new FormData();
  body.append("metadata", JSON.stringify(payload));
  files.forEach((file) => body.append("files", file));

  return request<ApiRecord>("/v1/knowledge-bases/create-with-files", {
    method: "POST",
    headers: authHeaders(token),
    body,
  });
}

export function evaluateKnowledgeBase(token: string, kbId: string) {
  return request<ApiRecord>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/evaluate`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export function deleteKnowledgeBase(token: string, kbId: string) {
  return request<ApiRecord>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function publishKnowledgeBaseVersion(token: string, kbId: string, versionId: string) {
  return request<ApiRecord>(
    `/v1/knowledge-bases/${encodeURIComponent(kbId)}/versions/${encodeURIComponent(versionId)}/publish`,
    {
      method: "POST",
      headers: authHeaders(token),
    },
  );
}

export function createKnowledgeSource(
  token: string,
  kbId: string,
  payload: KnowledgeSourcePayload,
) {
  return request<ApiRecord>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/sources`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function uploadKnowledgeFile(token: string, kbId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return request<ApiRecord>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/files`, {
    method: "POST",
    headers: authHeaders(token),
    body,
  });
}

export function syncKnowledgeBase(
  token: string,
  kbId: string,
  payload: {
    embedding_model?: string;
    vector_backend?: string;
    chunk_size?: number;
    chunk_overlap?: number;
    force_reindex?: boolean;
  } = {},
) {
  return request<ApiRecord>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/sync`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function queryKnowledgeBase(
  token: string,
  kbId: string,
  payload: { query: string; top_k?: number },
) {
  return request<ApiRecord[]>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/query`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function listTools(token: string, environment = "all") {
  return request<ApiRecord[]>(withParams("/v1/tools", { environment }), {
    headers: authHeaders(token),
  });
}

export function listEnvironments(token: string) {
  return request<string[]>("/v1/environments", {
    headers: authHeaders(token),
  });
}

export function getMonitoringMetrics(token: string, environment = "all") {
  return request<ApiRecord>(withParams("/v1/monitoring/metrics", { environment }), {
    headers: authHeaders(token),
  });
}

export function createAgent(token: string, payload: ApiRecord) {
  return request<ApiRecord>("/v1/agents", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deleteAgent(token: string, agentId: string) {
  return request<{ ok: boolean }>(`/v1/agents/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function createTool(token: string, payload: ApiRecord) {
  return request<ApiRecord>("/v1/tools", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function updateTool(token: string, toolId: string, payload: ApiRecord) {
  return request<ApiRecord>(`/v1/tools/${encodeURIComponent(toolId)}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function evaluateTool(token: string, toolId: string) {
  return request<ApiRecord>(`/v1/tools/${encodeURIComponent(toolId)}/evaluate`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export function listEvaluationCriteriaResults(token: string, runId: string) {
  return request<CriterionResult[]>(`/v1/evaluation-runs/${encodeURIComponent(runId)}/criteria`, {
    headers: authHeaders(token),
  });
}

export function listEvaluationRuns(
  token: string,
  limit = 100,
  environment = "all",
  targetType?: "tool" | "agent" | "workflow",
) {
  return request<EvaluationRun[]>(
    withParams("/v1/evaluation-runs", { limit, environment, target_type: targetType }),
    {
      headers: authHeaders(token),
    },
  );
}

export function listEvaluationRules(token: string) {
  return request<ApiRecord[]>("/v1/evaluation-rules", {
    headers: authHeaders(token),
  });
}

export function evaluateAgent(token: string, agentId: string) {
  return request<ApiRecord>(`/v1/agents/${encodeURIComponent(agentId)}/evaluate`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export function evaluateWorkflowDefinition(token: string, workflowDefinitionId: string) {
  return request<ApiRecord>(
    `/v1/workflow-definitions/${encodeURIComponent(workflowDefinitionId)}/evaluate`,
    {
      method: "POST",
      headers: authHeaders(token),
    },
  );
}

export function createWorkflowDeployment(
  token: string,
  workflowDefinitionId: string,
  payload: WorkflowDeploymentPayload = {},
) {
  return request<ApiRecord>(
    `/v1/workflow-definitions/${encodeURIComponent(workflowDefinitionId)}/deployments`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    },
  );
}

export function generateWorkflowDeploymentArtifacts(
  token: string,
  deploymentId: string,
  payload: DeploymentJobPayload = {},
) {
  return request<ApiRecord[]>(
    `/v1/workflow-deployments/${encodeURIComponent(deploymentId)}/generate-artifacts`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    },
  );
}

export function listWorkflowDeploymentArtifacts(token: string, deploymentId: string) {
  return request<ApiRecord[]>(`/v1/workflow-deployments/${encodeURIComponent(deploymentId)}/artifacts`, {
    headers: authHeaders(token),
  });
}

export function deployWorkflowDeployment(
  token: string,
  deploymentId: string,
  payload: DeploymentJobPayload = {},
) {
  return request<ApiRecord>(`/v1/workflow-deployments/${encodeURIComponent(deploymentId)}/deploy`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function activateWorkflowDeployment(token: string, deploymentId: string) {
  return request<ApiRecord>(`/v1/workflow-deployments/${encodeURIComponent(deploymentId)}/activate`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export function getDeploymentJob(token: string, jobId: string) {
  return request<ApiRecord>(`/v1/deployment-jobs/${encodeURIComponent(jobId)}`, {
    headers: authHeaders(token),
  });
}

export function listWorkflowDeploymentJobs(token: string, deploymentId: string) {
  return request<ApiRecord[]>(`/v1/workflow-deployments/${encodeURIComponent(deploymentId)}/jobs`, {
    headers: authHeaders(token),
  });
}

export function runWorkflowDeployment(
  token: string,
  payload: { query: string; deployment_id: string; idempotency_key?: string },
) {
  return request<ApiRecord>("/v1/multi-agent-runs", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function listRuntimeRuns(token: string, limit = 100, environment = "all") {
  return request<ApiRecord[]>(withParams("/v1/runtime-runs", { limit, environment }), {
    headers: authHeaders(token),
  });
}

export function getRuntimeRunEvents(token: string, runId: string, afterOutboxId?: string) {
  return request<{ events: ApiRecord[] }>(
    withParams(`/v1/runtime-runs/${encodeURIComponent(runId)}/events`, {
      after_outbox_id: afterOutboxId,
    }),
    { headers: authHeaders(token) },
  );
}

export function runScenarioSuite(token: string, suiteId: string, deploymentId: string) {
  return request<ApiRecord>(`/v1/scenario-suites/${encodeURIComponent(suiteId)}/runs`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ deployment_id: deploymentId }),
  });
}

export function getAgentCertification(token: string, agentId: string) {
  return request<AgentCertification>(`/v1/agents/${encodeURIComponent(agentId)}/certification`, {
    headers: authHeaders(token),
  });
}

export function listAgentEvaluationRuns(token: string, agentId: string) {
  return request<EvaluationRun[]>(`/v1/agents/${encodeURIComponent(agentId)}/evaluation-runs`, {
    headers: authHeaders(token),
  });
}

export function createGuardrailPolicy(token: string, payload: ApiRecord) {
  return request<ApiRecord>("/v1/guardrail-policies", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function createEvaluatorTemplate(token: string, payload: ApiRecord) {
  return request<ApiRecord>("/v1/evaluator-templates", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function createKnowledgeBase(token: string, payload: ApiRecord) {
  return request<ApiRecord>("/v1/knowledge-bases", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function createWorkflowDefinition(token: string, payload: ApiRecord) {
  return request<ApiRecord>("/v1/workflow-definitions", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function runMultiAgentWorkflow(
  token: string,
  payload: { query: string; workflow_definition_id?: string; deployment_id?: string; idempotency_key?: string },
) {
  return request<ApiRecord>("/v1/multi-agent-runs", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function grantAgentTool(token: string, agentId: string, toolName: string) {
  return request<ApiRecord>(`/v1/agents/${encodeURIComponent(agentId)}/tool-grants`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ tool_name: toolName }),
  });
}

export function revokeAgentTool(token: string, agentId: string, toolName: string) {
  return request<ApiRecord>(`/v1/agents/${encodeURIComponent(agentId)}/tool-grants/${encodeURIComponent(toolName)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function listAgentGuardrails(token: string, agentId: string) {
  return request<ApiRecord[]>(`/v1/agents/${encodeURIComponent(agentId)}/guardrails`, {
    headers: authHeaders(token),
  });
}

export function assignAgentGuardrail(token: string, agentId: string, payload: ApiRecord) {
  return request<ApiRecord>(`/v1/agents/${encodeURIComponent(agentId)}/guardrails`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deleteAgentGuardrail(token: string, agentId: string, assignmentId: string) {
  return request<ApiRecord>(`/v1/agents/${encodeURIComponent(agentId)}/guardrails/${encodeURIComponent(assignmentId)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function listAgentEvaluators(token: string, agentId: string) {
  return request<ApiRecord[]>(`/v1/agents/${encodeURIComponent(agentId)}/evaluators`, {
    headers: authHeaders(token),
  });
}

export function assignAgentEvaluator(token: string, agentId: string, payload: ApiRecord) {
  return request<ApiRecord>(`/v1/agents/${encodeURIComponent(agentId)}/evaluators`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deleteAgentEvaluator(token: string, agentId: string, assignmentId: string) {
  return request<ApiRecord>(`/v1/agents/${encodeURIComponent(agentId)}/evaluators/${encodeURIComponent(assignmentId)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function listAgentKnowledgeBases(token: string, agentId: string) {
  return request<ApiRecord[]>(`/v1/agents/${encodeURIComponent(agentId)}/knowledge-bases`, {
    headers: authHeaders(token),
  });
}

export function assignAgentKnowledgeBase(token: string, agentId: string, payload: ApiRecord) {
  return request<ApiRecord>(`/v1/agents/${encodeURIComponent(agentId)}/knowledge-bases`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deleteAgentKnowledgeBase(token: string, agentId: string, assignmentId: string) {
  return request<ApiRecord>(
    `/v1/agents/${encodeURIComponent(agentId)}/knowledge-bases/${encodeURIComponent(assignmentId)}`,
    {
      method: "DELETE",
      headers: authHeaders(token),
    },
  );
}

export async function platformOverview(token: string, environment = "all"): Promise<PlatformData> {
  const [
    agents,
    workflowDefinitions,
    workflows,
    sessions,
    reviewQueue,
    auditEvents,
    guardrailPolicies,
    evaluatorTemplates,
    evaluationRules,
    evaluationRuns,
    knowledgeBases,
    tools,
    monitoringMetrics,
    environments,
  ] = await Promise.all([
    listAgents(token, environment),
    listWorkflowDefinitions(token, environment),
    listWorkflows(token, 50, environment),
    listSessions(token, 50, environment),
    listReviewQueue(token, 100, environment),
    listAuditEvents(token, 100, environment),
    listGuardrailPolicies(token, environment),
    listEvaluatorTemplates(token),
    listEvaluationRules(token),
    listEvaluationRuns(token, 100, environment),
    listKnowledgeBases(token, environment),
    listTools(token, environment),
    getMonitoringMetrics(token, environment).catch(() => null),
    listEnvironments(token),
  ]);

  const workflowDetails = await Promise.all(
    workflows.map((workflow) => {
      const workflowId = typeof workflow.workflow_id === "string" ? workflow.workflow_id : "";
      return workflowId ? getWorkflowDetail(token, workflowId).catch(() => workflow) : Promise.resolve(workflow);
    }),
  );
  const agentAssignmentEntries = await Promise.all(
    agents.map(async (agent) => {
      const agentId = typeof agent.agent_id === "string" ? agent.agent_id : "";
      if (!agentId) {
        return ["", { guardrails: [], evaluators: [], knowledge: [] }] as const;
      }

      const [guardrails, evaluators, knowledge] = await Promise.all([
        listAgentGuardrails(token, agentId).catch(() => []),
        listAgentEvaluators(token, agentId).catch(() => []),
        listAgentKnowledgeBases(token, agentId).catch(() => []),
      ]);

      return [agentId, { guardrails, evaluators, knowledge }] as const;
    }),
  );
  const agentAssignments = Object.fromEntries(
    agentAssignmentEntries.filter(([agentId]) => agentId),
  ) as Record<string, AgentAssignments>;
  const agentAssignmentCounts = Object.fromEntries(
    Object.entries(agentAssignments).map(([agentId, assignments]) => [
      agentId,
      {
        guardrails: assignments.guardrails.length,
        evaluators: assignments.evaluators.length,
        knowledge: assignments.knowledge.length,
      },
    ]),
  );

  return {
    agents,
    agentAssignmentCounts,
    agentAssignments,
    workflowDefinitions,
    workflows,
    workflowDetails,
    sessions,
    reviewQueue,
    auditEvents,
    guardrailPolicies,
    evaluatorTemplates,
    evaluationRules,
    evaluationRuns,
    knowledgeBases,
    tools,
    monitoringMetrics,
    environments,
  };
}

export function saveSession(session: AuthSession) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function getSession(): AuthSession | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null") as AuthSession | null;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}
