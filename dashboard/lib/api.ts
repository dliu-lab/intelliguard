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
  knowledgeBases: ApiRecord[];
  tools: ApiRecord[];
  environments: string[];
};

type AgentAssignments = { guardrails: ApiRecord[]; evaluators: ApiRecord[]; knowledge: ApiRecord[] };

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const SESSION_STORAGE_KEY = "governance-session";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
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

export function listWorkflowMarketplace(token: string, environment = "all") {
  return request<ApiRecord[]>(withParams("/v1/workflow-marketplace", { environment }), {
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

export function listToolMarketplace(token: string) {
  return request<ApiRecord[]>("/v1/tool-marketplace", {
    headers: authHeaders(token),
  });
}

export function listEnvironments(token: string) {
  return request<string[]>("/v1/environments", {
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
  return request<ApiRecord>("/v1/tool-marketplace", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
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
  return request<ApiRecord>("/v1/workflow-marketplace", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function runMultiAgentWorkflow(
  token: string,
  payload: { query: string; workflow_definition_id?: string },
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
    knowledgeBases,
    tools,
    environments,
  ] = await Promise.all([
    listAgents(token, environment),
    listWorkflowMarketplace(token, environment),
    listWorkflows(token, 50, environment),
    listSessions(token, 50, environment),
    listReviewQueue(token, 100, environment),
    listAuditEvents(token, 100, environment),
    listGuardrailPolicies(token, environment),
    listEvaluatorTemplates(token),
    listKnowledgeBases(token, environment),
    listToolMarketplace(token),
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
    knowledgeBases,
    tools,
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
