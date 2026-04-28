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
    throw new Error(text || `Request failed: ${response.status}`);
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
  tools: () => request("/v1/tools"),
  toolMarketplace: () => request("/v1/tool-marketplace"),
  createAgent: (payload) =>
    request("/v1/agents", {
      method: "POST",
      body: JSON.stringify(payload),
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
};
