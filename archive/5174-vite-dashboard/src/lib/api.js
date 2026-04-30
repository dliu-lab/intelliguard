const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

function withParams(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "" && value !== "all") {
      query.set(key, value);
    }
  });
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

async function request(path, options = {}) {
  const storedSession = (() => {
    try {
      return JSON.parse(localStorage.getItem("governance-session") || "null");
    } catch {
      return null;
    }
  })();
  const authHeaders = storedSession?.token ? { Authorization: `Bearer ${storedSession.token}` } : {};
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...authHeaders, ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const payload = JSON.parse(text);
      message = payload.detail || payload.message || text;
    } catch {
      // Keep the response text when the API did not return JSON.
    }
    throw new Error(message || `Request failed: ${response.status}`);
  }
  return response.json();
}

export const api = {
  bootstrapStatus: () => request("/v1/auth/bootstrap-status"),
  login: (payload) =>
    request("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  register: (payload) =>
    request("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  logout: () =>
    request("/v1/auth/logout", {
      method: "POST",
    }),
  me: () => request("/v1/me"),
  users: () => request("/v1/users"),
  sessions: (limit = 50, environment = "all") => request(withParams("/v1/sessions", { limit, environment })),
  workflow: (sessionId) => request(`/v1/sessions/${sessionId}/workflow`),
  workflows: (limit = 50, environment = "all") => request(withParams("/v1/workflows", { limit, environment })),
  workflowDetail: (workflowId) => request(`/v1/workflows/${workflowId}`),
  workflowMarketplace: (environment = "all") => request(withParams("/v1/workflow-marketplace", { environment })),
  createWorkflowDefinition: (payload) =>
    request("/v1/workflow-marketplace", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  auditEvents: (limit = 100, environment = "all", workflowOnly = false) =>
    request(withParams("/v1/audit-events", { limit, environment, workflow_only: workflowOnly })),
  reviewQueue: (limit = 100, environment = "all") => request(withParams("/v1/review-queue", { limit, environment })),
  agents: (environment = "all") => request(withParams("/v1/agents", { environment })),
  environments: () => request("/v1/environments"),
  policies: () => request("/v1/policies"),
  guardrailPolicies: (environment = "all") => request(withParams("/v1/guardrail-policies", { environment })),
  createGuardrailPolicy: (payload) =>
    request("/v1/guardrail-policies", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateGuardrailPolicy: (policyId, payload) =>
    request(`/v1/guardrail-policies/${policyId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  agentGuardrails: (agentId) => request(`/v1/agents/${agentId}/guardrails`),
  assignGuardrail: (agentId, payload) =>
    request(`/v1/agents/${agentId}/guardrails`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateGuardrailAssignment: (agentId, assignmentId, payload) =>
    request(`/v1/agents/${agentId}/guardrails/${assignmentId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteGuardrailAssignment: (agentId, assignmentId) =>
    request(`/v1/agents/${agentId}/guardrails/${assignmentId}`, {
      method: "DELETE",
    }),
  evaluatorTemplates: () => request("/v1/evaluator-templates"),
  createEvaluatorTemplate: (payload) =>
    request("/v1/evaluator-templates", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  agentEvaluators: (agentId) => request(`/v1/agents/${agentId}/evaluators`),
  assignEvaluator: (agentId, payload) =>
    request(`/v1/agents/${agentId}/evaluators`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteEvaluatorAssignment: (agentId, assignmentId) =>
    request(`/v1/agents/${agentId}/evaluators/${assignmentId}`, {
      method: "DELETE",
    }),
  evaluationResults: (limit = 100, environment = "all", agentId, sessionId) =>
    request(withParams("/v1/evaluation-results", { limit, environment, agent_id: agentId, session_id: sessionId })),
  sessionEvaluationResults: (sessionId) => request(`/v1/sessions/${sessionId}/evaluation-results`),
  triggerEvaluation: (sessionId) =>
    request(`/v1/sessions/${sessionId}/evaluate`, {
      method: "POST",
    }),
  tools: () => request("/v1/tools"),
  toolMarketplace: () => request("/v1/tool-marketplace"),
  createAgent: (payload) =>
    request("/v1/agents", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteAgent: (agentId) =>
    request(`/v1/agents/${agentId}`, {
      method: "DELETE",
    }),
  createTool: (payload) =>
    request("/v1/tool-marketplace", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  grantTool: (agentId, toolName) =>
    request(`/v1/agents/${agentId}/tool-grants`, {
      method: "POST",
      body: JSON.stringify({ tool_name: toolName }),
    }),
  revokeTool: (agentId, toolName) =>
    request(`/v1/agents/${agentId}/tool-grants/${toolName}`, {
      method: "DELETE",
    }),
  resolveReview: (reviewId, status) =>
    request(`/v1/review-queue/${reviewId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ status, reviewer_note: `Resolved from dashboard as ${status}` }),
    }),
  runAgent: (query) =>
    request("/v1/agent-runs", {
      method: "POST",
      body: JSON.stringify({ query }),
    }),
  runMultiAgentWorkflow: (query, workflowDefinitionId) =>
    request("/v1/multi-agent-runs", {
      method: "POST",
      body: JSON.stringify({ query, workflow_definition_id: workflowDefinitionId }),
    }),
  knowledgeBases: (environment = "all") =>
    request(withParams("/v1/knowledge-bases", { environment })),
  createKnowledgeBase: (payload) =>
    request("/v1/knowledge-bases", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  agentKBs: (agentId) => request(`/v1/agents/${agentId}/knowledge-bases`),
  assignKB: (agentId, payload) =>
    request(`/v1/agents/${agentId}/knowledge-bases`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteKBAssignment: (agentId, assignmentId) =>
    request(`/v1/agents/${agentId}/knowledge-bases/${assignmentId}`, {
      method: "DELETE",
    }),
  queryKB: (kbId, payload) =>
    request(`/v1/knowledge-bases/${kbId}/query`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
