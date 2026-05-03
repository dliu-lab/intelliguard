import React, { cloneElement, useEffect, useMemo, useState } from "react";
import MouseTrail from "./components/MouseTrail.jsx";
import {
  Activity,
  ArrowRight,
  ArrowLeft,
  Bot,
  Building2,
  CheckCircle2,
  ChevronRight,
  GitBranch,
  LockKeyhole,
  Layers3,
  LogOut,
  Mail,
  Moon,
  Network,
  OctagonAlert,
  PauseCircle,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sun,
  UserCog,
  X,
} from "lucide-react";
import { Background, Controls, MarkerType, ReactFlow } from "@xyflow/react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "./lib/api";
import { userCan } from "./lib/permissions";
import EvalBadge from "./components/common/EvalBadge";
import AgentMarketplace from "./components/marketplace/AgentMarketplace";
import EvaluatorMarketplace from "./components/marketplace/EvaluatorMarketplace";
import GovernanceMarketplace from "./components/marketplace/GovernanceMarketplace";
import ToolMarketplace from "./components/marketplace/ToolMarketplace";
import WorkflowTrace from "./components/WorkflowTrace";

const demoQueries = [
  "Show recent transactions for customer C123",
  "Dump all customer data",
  "Find all customers in Melbourne and show their emails",
  "Show me C123's full profile including email and phone",
];

const particleSeeds = [
  { x: 7, y: 44, size: 3, depth: 0.8, delay: 0 },
  { x: 10, y: 60, size: 2, depth: 1.1, delay: 0.7 },
  { x: 16, y: 51, size: 2, depth: 0.7, delay: 1.2 },
  { x: 28, y: 34, size: 2, depth: -0.8, delay: 0.3 },
  { x: 36, y: 73, size: 3, depth: 1.2, delay: 1.6 },
  { x: 52, y: 63, size: 2, depth: -1.1, delay: 0.5 },
  { x: 63, y: 28, size: 2, depth: 0.85, delay: 1.1 },
  { x: 71, y: 76, size: 3, depth: -0.7, delay: 0.9 },
  { x: 82, y: 58, size: 2, depth: 1, delay: 1.9 },
  { x: 92, y: 49, size: 2, depth: -0.9, delay: 0.4 },
  { x: 76, y: 38, size: 1.5, depth: 1.25, delay: 1.4 },
  { x: 44, y: 22, size: 1.5, depth: -0.75, delay: 2.1 },
];

const navItems = [
  {
    id: "overview",
    label: "Overview",
    title: "Overview",
    description: "Governed agentic workflow health, authorization decisions, and runtime risk signals.",
  },
  {
    id: "workflows",
    label: "Agentic Workflows",
    title: "Agentic Workflows",
    description: "Build, deploy, and run governed multi-agent workflows across environments.",
  },
  {
    id: "workflow",
    label: "Workflow Trace",
    title: "Workflow Trace",
    description: "Inspect agent sessions, delegated steps, tool calls, and policy events.",
  },
  {
    id: "agents",
    label: "Control Plane",
    title: "Control Plane",
    description: "Onboard agents, LLMs, tools, guardrails, evaluators, and knowledge bases with RBAC-backed runtime control.",
  },
  {
    id: "policies",
    label: "Runtime Policies",
    title: "Runtime Policies",
    description: "Review active runtime rules, thresholds, and enforcement outcomes.",
  },
  {
    id: "review",
    label: "Review Queue",
    title: "Review Queue",
    description: "Resolve human review items raised by governed agent activity.",
  },
  {
    id: "audit",
    label: "Audit Events",
    title: "Audit Events",
    description: "Search the complete record of governed actions and decisions.",
  },
];

const loginRoles = [
  "Governance Lead",
  "Governance Reviewer",
  "Support Operations Manager",
  "Agent Developer",
];

const governanceLeadEnvironmentOptions = ["all", "demo", "staging", "production", "local"];

const defaultAgentLlm = {
  gateway: "litellm",
  endpoint: "/llm/v1",
  model: "ollama/qwen3.5:9b",
  temperature: 0.2,
};

const agentTemplate = {
  agent_id: "claims-review-agent",
  display_name: "Claims Review Agent",
  agent_type: "specialist_agent",
  owner: "Support Operations",
  environment: "demo",
  purpose: "Reviews customer claims using explicitly granted tools and records governed decisions.",
  permissions: {
    tools: ["get_customer_profile"],
    actions: ["read_customer_profile", "summarize_claim_context"],
    scopes: {
      customer_access: "customer_id",
      pii_exposure: "summaries_only",
    },
  },
  metadata: {
    framework: "custom-agent",
    data_domain: "customer_support",
    llm: defaultAgentLlm,
  },
};

const toolTemplate = {
  tool_name: "summarize_support_case",
  display_name: "Summarize Support Case",
  category: "support_operations",
  description: "Creates a governed summary of a support case for an approved agent.",
  access_model: "grant_required",
  input_schema: {
    type: "object",
    properties: {
      case_id: { type: "string" },
    },
    required: ["case_id"],
  },
  output_schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
    },
  },
  metadata: {
    side_effects: "none",
    data_classification: "customer_sensitive",
  },
};

const workflowDefinitionTemplate = {
  workflow_definition_id: "customer-support-investigation",
  name: "Customer Support Investigation",
  description: "Verify customer context, review recent transactions, and record a governed response recommendation.",
  owner: "Support Operations",
  environment: "demo",
  lead_agent_id: "customer-support-lead-agent",
  trigger_type: "manual",
  steps: [
    {
      step_id: "identity",
      label: "Verify customer profile",
      role: "sub_agent:identity",
      agent_id: "identity-verification-agent",
      task: "Verify customer profile for {{customer_id}}.",
      tool_name: "get_customer_profile",
      tool_args: { customer_id: "{{customer_id}}" },
    },
    {
      step_id: "transactions",
      label: "Retrieve recent transactions",
      role: "sub_agent:transactions",
      agent_id: "transaction-analyst-agent",
      task: "Retrieve recent transactions for {{customer_id}}.",
      tool_name: "get_customer_transactions",
      tool_args: { customer_id: "{{customer_id}}" },
    },
    {
      step_id: "risk_review",
      label: "Review workflow outputs",
      role: "sub_agent:risk_review",
      agent_id: "risk-review-agent",
      task: "Review outputs for safe response composition.",
    },
  ],
  metadata: {
    domain: "customer_support",
    risk_controls: ["policy_check", "audit_trail", "human_review_when_required"],
  },
};

const guardrailPolicyTemplate = {
  policy_id: "pol_custom_001",
  display_name: "Custom Policy",
  description: "",
  environment: "demo",
  config: {
    allowed_tools: [],
    blocked_tools: [],
    max_records_returned: 100,
    block_pii_in_response: true,
    redact_pii_in_response: false,
    blocked_patterns: [],
    review_required_for: [],
    decision_thresholds: { review: 50, block: 80 },
  },
};

function agentTemplateFor(environment) {
  return {
    ...agentTemplate,
    environment: environment && environment !== "all" ? environment : agentTemplate.environment,
  };
}

function workflowTemplateFor(environment) {
  return {
    ...workflowDefinitionTemplate,
    environment: environment && environment !== "all" ? environment : workflowDefinitionTemplate.environment,
  };
}

function guardrailPolicyTemplateFor(environment) {
  return {
    ...guardrailPolicyTemplate,
    environment: environment && environment !== "all" ? environment : guardrailPolicyTemplate.environment,
  };
}

function parseWorkflowDefinition(json) {
  try {
    const parsed = JSON.parse(json);
    return {
      ...workflowDefinitionTemplate,
      ...parsed,
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      metadata: parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : {},
    };
  } catch {
    return workflowDefinitionTemplate;
  }
}

function updateWorkflowDefinitionJson(json, updater) {
  const next = updater(parseWorkflowDefinition(json));
  return JSON.stringify(next, null, 2);
}

function viewFromHash() {
  if (typeof window === "undefined") {
    return "overview";
  }
  const hash = window.location.hash.replace("#", "");
  return navItems.some((item) => item.id === hash) ? hash : "overview";
}

function decisionClass(decision) {
  return `pill pill-${String(decision || "neutral").toLowerCase()}`;
}

function storedSelectedEnvironment() {
  try {
    return JSON.parse(localStorage.getItem("governance-session") || "null")?.selected_environment || "all";
  } catch {
    return "all";
  }
}

export default function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("governance-session") || "null")?.user || null;
    } catch {
      return null;
    }
  });
  const [sessions, setSessions] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [workflow, setWorkflow] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [workflowDefinitions, setWorkflowDefinitions] = useState([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);
  const [selectedWorkflowDefinitionId, setSelectedWorkflowDefinitionId] = useState("");
  const [workflowDetail, setWorkflowDetail] = useState(null);
  const [agents, setAgents] = useState([]);
  const [tools, setTools] = useState([]);
  const [toolMarketplace, setToolMarketplace] = useState([]);
  const [guardrailPolicies, setGuardrailPolicies] = useState([]);
  const [evaluatorTemplates, setEvaluatorTemplates] = useState([]);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [policies, setPolicies] = useState(null);
  const [selectedEnvironment, setSelectedEnvironment] = useState(storedSelectedEnvironment);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState("customer-support-agent");
  const [activeMarketplaceTab, setActiveMarketplaceTab] = useState("agents");
  const [activeWorkflowTab, setActiveWorkflowTab] = useState("runs");
  const [agentJson, setAgentJson] = useState(() => JSON.stringify(agentTemplateFor("all"), null, 2));
  const [toolJson, setToolJson] = useState(() => JSON.stringify(toolTemplate, null, 2));
  const [workflowDefinitionJson, setWorkflowDefinitionJson] = useState(() => JSON.stringify(workflowTemplateFor("all"), null, 2));
  const [guardrailPolicyJson, setGuardrailPolicyJson] = useState(() => JSON.stringify(guardrailPolicyTemplateFor("all"), null, 2));
  const [knowledgeBaseJson, setKnowledgeBaseJson] = useState(() =>
    JSON.stringify(
      { kb_id: "policy-docs", display_name: "Policy Documents", description: "", source_type: "vector_store", source_config: {}, environment: "demo" },
      null,
      2,
    )
  );
  const [selectedWorkflowBuilderStepId, setSelectedWorkflowBuilderStepId] = useState("identity");
  const [activeView, setActiveView] = useState(viewFromHash);
  const [query, setQuery] = useState(demoQueries[0]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function syncViewFromHash() {
      setActiveView(viewFromHash());
    }
    window.addEventListener("hashchange", syncViewFromHash);
    window.addEventListener("popstate", syncViewFromHash);
    syncViewFromHash();
    return () => {
      window.removeEventListener("hashchange", syncViewFromHash);
      window.removeEventListener("popstate", syncViewFromHash);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowIntro(false), 2300);
    return () => window.clearTimeout(timer);
  }, []);

  function updateSelectedEnvironment(environment) {
    setSelectedEnvironment(environment);
    try {
      const existingSession = JSON.parse(localStorage.getItem("governance-session") || "{}");
      if (existingSession?.token) {
        localStorage.setItem(
          "governance-session",
          JSON.stringify({ ...existingSession, selected_environment: environment }),
        );
      }
    } catch {
      // Ignore private browsing storage restrictions in the console.
    }
  }

  async function login(payload, mode, requestedEnvironment = "all") {
    const authSession = mode === "signup" ? await api.register(payload) : await api.login(payload);
    const initialEnvironment = requestedEnvironment || authSession.user.default_environment || "all";
    setSelectedEnvironment(initialEnvironment);
    setCurrentUser(authSession.user);
    try {
      localStorage.setItem(
        "governance-session",
        JSON.stringify({ ...authSession, selected_environment: initialEnvironment }),
      );
      localStorage.removeItem("governance-user");
    } catch {
      // The console can still run if browser storage is unavailable for this session.
    }
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      // The local session should still be cleared if the API token is already expired.
    }
    localStorage.removeItem("governance-session");
    localStorage.removeItem("governance-user");
    setCurrentUser(null);
    setSelectedEnvironment("all");
  }

  const environmentOptions = useMemo(() => {
    if (currentUser?.can_all_environments) {
      return Array.from(new Set(["all", ...environments]));
    }
    return currentUser?.allowed_environments?.length ? currentUser.allowed_environments : environments;
  }, [currentUser, environments]);

  const workflowBuilderDefinition = useMemo(
    () => parseWorkflowDefinition(workflowDefinitionJson),
    [workflowDefinitionJson],
  );
  const workflowBuilderEnvironment =
    workflowBuilderDefinition.environment || (selectedEnvironment === "all" ? "demo" : selectedEnvironment);

  const canCreateAgent = userCan(currentUser, selectedEnvironment, "agent:create");
  const canCreateTool = userCan(currentUser, selectedEnvironment, "tool:create");
  const canCreateWorkflow = userCan(currentUser, workflowBuilderEnvironment, "workflow:create");

  async function refresh(
    nextSessionId = selectedSessionId,
    nextWorkflowId = selectedWorkflowId,
    environment = selectedEnvironment,
  ) {
    setError("");
    const userContext = await api.me();
    setCurrentUser((existing) =>
      JSON.stringify(existing) === JSON.stringify(userContext) ? existing : userContext,
    );
    try {
      const existingSession = JSON.parse(localStorage.getItem("governance-session") || "{}");
      localStorage.setItem("governance-session", JSON.stringify({ ...existingSession, user: userContext }));
    } catch {
      // Ignore private browsing storage restrictions in the console.
    }
    const allowedOptions = userContext.can_all_environments
      ? Array.from(new Set(["all", ...userContext.allowed_environments]))
      : userContext.allowed_environments;
    const effectiveEnvironment = userContext.can_all_environments
      ? environment || userContext.default_environment || "all"
      : allowedOptions.includes(environment)
        ? environment
        : userContext.default_environment || allowedOptions[0] || "all";
    if (effectiveEnvironment !== selectedEnvironment) {
      updateSelectedEnvironment(effectiveEnvironment);
    }
    const [
      sessionRows,
      workflowRows,
      auditRows,
      reviewRows,
      agentRows,
      workflowDefinitionRows,
      environmentRows,
      policyPayload,
      toolRows,
      toolMarketplaceRows,
      guardrailPolicyRows,
      evaluatorTemplateRows,
      kbRows,
    ] = await Promise.all([
      api.sessions(50, effectiveEnvironment),
      api.workflows(50, effectiveEnvironment),
      api.auditEvents(100, effectiveEnvironment, true),
      api.reviewQueue(100, effectiveEnvironment),
      api.agents(effectiveEnvironment),
      api.workflowMarketplace(effectiveEnvironment),
      api.environments(),
      api.policies(),
      api.tools(),
      api.toolMarketplace().catch(() => []),
      api.guardrailPolicies(effectiveEnvironment).catch(() => []),
      api.evaluatorTemplates().catch(() => []),
      api.knowledgeBases(effectiveEnvironment).catch(() => []),
    ]);
    setSessions(sessionRows);
    setWorkflows(workflowRows);
    setAuditEvents(auditRows);
    setReviews(reviewRows);
    setAgents(agentRows);
    setWorkflowDefinitions(workflowDefinitionRows);
    setEnvironments(environmentRows);
    setPolicies(policyPayload);
    setTools(toolRows);
    setToolMarketplace(toolMarketplaceRows);
    setGuardrailPolicies(guardrailPolicyRows);
    setEvaluatorTemplates(evaluatorTemplateRows);
    setKnowledgeBases(kbRows);
    setSelectedAgentId((current) =>
      agentRows.some((agent) => agent.agent_id === current)
        ? current
        : agentRows[0]?.agent_id || "",
    );
    setSelectedWorkflowDefinitionId((current) =>
      workflowDefinitionRows.some((definition) => definition.workflow_definition_id === current)
        ? current
        : workflowDefinitionRows[0]?.workflow_definition_id || "",
    );
    const activeWorkflowId = workflowRows.some((workflowRow) => workflowRow.workflow_id === nextWorkflowId)
      ? nextWorkflowId
      : workflowRows[0]?.workflow_id || null;
    setSelectedWorkflowId(activeWorkflowId);
    let activeWorkflowDetail = null;
    if (activeWorkflowId) {
      try {
        activeWorkflowDetail = await api.workflowDetail(activeWorkflowId);
        setWorkflowDetail(activeWorkflowDetail);
      } catch {
        setWorkflowDetail(null);
      }
    } else {
      setWorkflowDetail(null);
    }

    const workflowSessions = activeWorkflowDetail?.sessions || [];
    const activeSessionId = workflowSessions.some((session) => session.session_id === nextSessionId)
      ? nextSessionId
      : workflowSessions[0]?.session_id;
    setSelectedSessionId(activeSessionId || null);
    if (activeSessionId) {
      try {
        const trace = await api.workflow(activeSessionId);
        setWorkflow(trace);
      } catch {
        setWorkflow([]);
      }
      setSelectedEvent(null);
    } else {
      setWorkflow([]);
      setSelectedEvent(null);
    }
  }

  useEffect(() => {
    if (!currentUser) {
      return;
    }
    refresh().catch((err) => setError(err.message));
  }, [currentUser, selectedEnvironment]);

  async function runDemo(event) {
    event?.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api.runAgent(query);
      await refresh(result.session_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function runWorkflowDemo(event) {
    event?.preventDefault();
    if (!selectedWorkflowDefinitionId) {
      setError("Build or select a workflow definition before running a workflow.");
      switchView("workflows");
      setActiveWorkflowTab("marketplace");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api.runMultiAgentWorkflow(query, selectedWorkflowDefinitionId);
      setSelectedWorkflowId(result.workflow_id);
      const detail = await api.workflowDetail(result.workflow_id);
      setWorkflowDetail(detail);
      const leadSessionId = result.lead_session_id || detail.sessions?.[0]?.session_id;
      await refresh(leadSessionId, result.workflow_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function selectWorkflow(workflowId) {
    setSelectedWorkflowId(workflowId);
    const detail = await api.workflowDetail(workflowId);
    setWorkflowDetail(detail);
    const firstSessionId = detail.sessions?.[0]?.session_id;
    if (firstSessionId) {
      setSelectedSessionId(firstSessionId);
      const trace = await api.workflow(firstSessionId);
      setWorkflow(trace);
      setSelectedEvent(null);
    }
  }

  async function selectWorkflowSession(sessionId) {
    setSelectedSessionId(sessionId);
    const trace = await api.workflow(sessionId);
    setWorkflow(trace);
    setSelectedEvent(null);
  }

  async function viewWorkflowTrace(workflowId) {
    setSelectedWorkflowId(workflowId);
    const detail = await api.workflowDetail(workflowId);
    setWorkflowDetail(detail);
    const leadSessionId = detail.metadata?.lead_session_id || detail.sessions?.[0]?.session_id;
    if (leadSessionId) {
      await selectWorkflowSession(leadSessionId);
    }
    switchView("workflow");
  }

  async function resolveReview(reviewId, status) {
    await api.resolveReview(reviewId, status);
    await refresh();
  }

  async function grantTool(agentId, toolName) {
    const agent = agents.find((item) => item.agent_id === agentId);
    if (!userCan(currentUser, agent?.environment || selectedEnvironment, "tool:grant")) {
      setError("Your current role cannot change tool grants in this environment.");
      return;
    }
    if (!agentId) {
      setError("Register or select an agent in this environment before attaching tools.");
      return;
    }
    if (!toolName) {
      setError("Select a tool before attaching it to an agent.");
      return;
    }
    await api.grantTool(agentId, toolName);
    await refresh();
  }

  async function createAgentFromJson(event) {
    event?.preventDefault();
    setError("");
    try {
      const payload = JSON.parse(agentJson);
      if (!canCreateAgent) {
        setError("Your current role cannot register or update agents in this environment.");
        return;
      }
      if (selectedEnvironment !== "all") {
        payload.environment = selectedEnvironment;
      }
      const agent = await api.createAgent(payload);
      setSelectedAgentId(agent.agent_id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateAgentProfile(payload) {
    setError("");
    if (!userCan(currentUser, payload.environment, "agent:create")) {
      throw new Error("Your current role cannot update agents in this environment.");
    }
    const agent = await api.createAgent(payload);
    setSelectedAgentId(agent.agent_id);
    await refresh();
    return agent;
  }

  async function createToolFromJson(event) {
    event?.preventDefault();
    setError("");
    try {
      const payload = JSON.parse(toolJson);
      if (!canCreateTool) {
        setError("Your current role cannot register tools in this environment.");
        return;
      }
      payload.environment = selectedEnvironment === "all" ? "demo" : selectedEnvironment;
      const tool = await api.createTool(payload);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createWorkflowDefinitionFromJson(event) {
    event?.preventDefault();
    setError("");
    try {
      const payload = JSON.parse(workflowDefinitionJson);
      if (!canCreateWorkflow) {
        setError("Your current role cannot build workflow definitions in this environment.");
        return;
      }
      payload.environment = payload.environment || (selectedEnvironment === "all" ? "demo" : selectedEnvironment);
      const definition = await api.createWorkflowDefinition(payload);
      setSelectedWorkflowDefinitionId(definition.workflow_definition_id);
      setActiveWorkflowTab("runs");
      await refresh(undefined, undefined, payload.environment);
    } catch (err) {
      setError(err.message);
    }
  }

  function updateWorkflowDefinitionField(field, value) {
    setWorkflowDefinitionJson((current) =>
      updateWorkflowDefinitionJson(current, (definition) => ({ ...definition, [field]: value })),
    );
  }

  function updateWorkflowBuilderStep(field, value) {
    if (!selectedWorkflowBuilderStep) {
      return;
    }
    setWorkflowDefinitionJson((current) =>
      updateWorkflowDefinitionJson(current, (definition) => ({
        ...definition,
        steps: definition.steps.map((step) =>
          step.step_id === selectedWorkflowBuilderStep.step_id ? { ...step, [field]: value } : step,
        ),
      })),
    );
  }

  function updateWorkflowBuilderStepToolArgs(value) {
    if (!selectedWorkflowBuilderStep) {
      return;
    }
    let parsed = {};
    try {
      parsed = JSON.parse(value || "{}");
    } catch {
      parsed = selectedWorkflowBuilderStep.tool_args || {};
    }
    updateWorkflowBuilderStep("tool_args", parsed);
  }

  function addWorkflowBuilderStep() {
    const nextIndex = workflowBuilderDefinition.steps.length + 1;
    const stepId = `step_${nextIndex}`;
    const nextStep = {
      step_id: stepId,
      label: `Workflow Step ${nextIndex}`,
      role: `sub_agent:${stepId}`,
      agent_id: agents[0]?.agent_id || "",
      task: "Describe the work this step should perform.",
      tool_name: tools[0] || "",
      tool_args: {},
    };
    setWorkflowDefinitionJson((current) =>
      updateWorkflowDefinitionJson(current, (definition) => ({
        ...definition,
        steps: [...definition.steps, nextStep],
      })),
    );
    setSelectedWorkflowBuilderStepId(stepId);
  }

  function removeWorkflowBuilderStep() {
    if (!selectedWorkflowBuilderStep) {
      return;
    }
    const remaining = workflowBuilderDefinition.steps.filter(
      (step) => step.step_id !== selectedWorkflowBuilderStep.step_id,
    );
    setWorkflowDefinitionJson((current) =>
      updateWorkflowDefinitionJson(current, (definition) => ({ ...definition, steps: remaining })),
    );
    setSelectedWorkflowBuilderStepId(remaining[0]?.step_id || "");
  }

  function loadJsonFile(event, setter) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setter(String(reader.result || ""));
    reader.onerror = () => setError("Could not read the selected JSON file.");
    reader.readAsText(file);
    event.target.value = "";
  }

  async function revokeTool(agentId, toolName) {
    const agent = agents.find((item) => item.agent_id === agentId);
    if (!userCan(currentUser, agent?.environment || selectedEnvironment, "tool:grant")) {
      setError("Your current role cannot revoke tool grants in this environment.");
      return;
    }
    await api.revokeTool(agentId, toolName);
    await refresh();
  }

  async function deleteAgent(agent) {
    if (!currentUser?.is_super_admin) {
      setError("Only governance admins can delete agents.");
      return;
    }
    const confirmed = window.confirm(`Delete ${agent.display_name}? This removes the agent identity and its governance assignments.`);
    if (!confirmed) {
      return;
    }
    await api.deleteAgent(agent.agent_id);
    if (selectedAgentId === agent.agent_id) {
      setSelectedAgentId("");
    }
    await refresh();
  }

  async function assignGuardrail(agentId, payload) {
    await api.assignGuardrail(agentId, payload);
  }

  async function deleteGuardrailAssignment(agentId, assignmentId) {
    await api.deleteGuardrailAssignment(agentId, assignmentId);
  }

  async function assignEvaluator(agentId, payload) {
    await api.assignEvaluator(agentId, payload);
  }

  async function deleteEvaluatorAssignment(agentId, assignmentId) {
    await api.deleteEvaluatorAssignment(agentId, assignmentId);
  }

  async function assignKB(agentId, payload) {
    await api.assignKB(agentId, payload);
  }

  async function deleteKBAssignment(agentId, assignmentId) {
    await api.deleteKBAssignment(agentId, assignmentId);
  }

  async function createGuardrailPolicyFromJson(event) {
    event?.preventDefault();
    setError("");
    try {
      const payload = JSON.parse(guardrailPolicyJson);
      const targetEnvironment =
        payload.environment || (selectedEnvironment === "all" ? "demo" : selectedEnvironment);
      if (!userCan(currentUser, targetEnvironment, "agent:create")) {
        setError("Your current role cannot register guardrail policies in this environment.");
        return;
      }
      payload.environment = targetEnvironment;
      await api.createGuardrailPolicy(payload);
      await refresh(undefined, undefined, targetEnvironment);
    } catch (err) {
      setError(err.message);
    }
  }

  async function createKnowledgeBaseFromJson(event) {
    event?.preventDefault();
    setError("");
    try {
      const payload = JSON.parse(knowledgeBaseJson);
      const targetEnvironment =
        payload.environment || (selectedEnvironment === "all" ? "demo" : selectedEnvironment);
      if (!userCan(currentUser, targetEnvironment, "agent:create")) {
        setError("Your current role cannot onboard knowledge bases in this environment.");
        return;
      }
      payload.environment = targetEnvironment;
      await api.createKnowledgeBase(payload);
      await refresh(undefined, undefined, targetEnvironment);
    } catch (err) {
      setError(err.message);
    }
  }

  function switchView(viewId) {
    setActiveView(viewId);
    window.history.replaceState(null, "", `#${viewId}`);
  }

  const metrics = useMemo(() => {
    const totals = { ALLOW: 0, REVIEW: 0, BLOCK: 0 };
    auditEvents.forEach((event) => {
      totals[event.decision] = (totals[event.decision] || 0) + 1;
    });
    const workflowSessionCount = workflows.reduce(
      (total, workflowRow) => total + Number(workflowRow.session_count || 0),
      0,
    );
    return {
      workflowSessions: workflowSessionCount,
      allowed: totals.ALLOW || 0,
      reviewed: totals.REVIEW || 0,
      blocked: totals.BLOCK || 0,
      highRisk: auditEvents.filter((event) => event.risk_score >= 80).length,
      workflows: workflows.length,
    };
  }, [auditEvents, workflows]);

  const riskChart = useMemo(() => {
    const counts = new Map();
    auditEvents.forEach((event) => counts.set(event.risk_type, (counts.get(event.risk_type) || 0) + 1));
    return Array.from(counts, ([risk, count]) => ({ risk, count }));
  }, [auditEvents]);

  const selectedWorkflowBuilderStep =
    workflowBuilderDefinition.steps.find((step) => step.step_id === selectedWorkflowBuilderStepId) ||
    workflowBuilderDefinition.steps[0] ||
    null;

  const workflowBuilderGraph = useMemo(() => {
    const nodes = [
      {
        id: "lead",
        position: { x: 40, y: 140 },
        data: { label: `Lead\n${workflowBuilderDefinition.lead_agent_id || "Select lead agent"}` },
        className: "node-neutral workflow-builder-node",
        sourcePosition: "right",
        targetPosition: "left",
      },
      ...workflowBuilderDefinition.steps.map((step, index) => ({
        id: step.step_id || `step-${index + 1}`,
        position: { x: 310 + index * 250, y: index % 2 === 0 ? 90 : 235 },
        data: {
          label: `${step.label || step.step_id || `Step ${index + 1}`}\n${step.agent_id || "No agent"}`,
        },
        className: `node-neutral workflow-builder-node ${
          selectedWorkflowBuilderStep?.step_id === step.step_id ? "node-selected" : ""
        }`,
        sourcePosition: "right",
        targetPosition: "left",
      })),
    ];
    const ids = ["lead", ...workflowBuilderDefinition.steps.map((step, index) => step.step_id || `step-${index + 1}`)];
    const edges = ids.slice(1).map((id, index) => ({
      id: `${ids[index]}-${id}`,
      source: ids[index],
      target: id,
      markerEnd: { type: MarkerType.ArrowClosed },
    }));
    return { nodes, edges };
  }, [selectedWorkflowBuilderStep?.step_id, workflowBuilderDefinition]);

  const activeNavItem = navItems.find((item) => item.id === activeView) || navItems[0];

  if (!currentUser) {
    return (
      <>
        <MouseTrail variant="landing" />
        <IntroTransition active={showIntro} />
        <LoginPage onLogin={login} />
      </>
    );
  }

  return (
    <>
      <MouseTrail />
      <IntroTransition active={showIntro} />
      <main className="app-shell">
        <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Shield size={24} />
          </div>
          <div>
            <strong>IntelliGuard</strong>
            <span title="Governed agentic workflow platform">Agentic workflow platform</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={activeView === item.id ? "selected" : ""}
              type="button"
              onClick={() => switchView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-account-row">
            <div className="sidebar-user-card">
              <ShieldCheck size={16} />
              <span>{currentUser.name}</span>
              <small>{currentUser.role}</small>
            </div>
            <button className="sidebar-exit-button" type="button" onClick={logout} title="Exit dashboard" aria-label="Exit dashboard">
              <LogOut size={16} />
            </button>
          </div>
          <span>Copyright 2026 Intellidata Consulting.</span>
        </div>
        </aside>

        <section className="content">
        <header className="topbar">
          <div>
            <span className="eyebrow">IntelliGuard Platform</span>
            <h1>{activeNavItem.title}</h1>
            <p>{activeNavItem.description}</p>
          </div>
          <div className="topbar-actions">
            <label className="environment-switcher">
              <span>{currentUser?.role === "Governance Lead" ? "Environment to check" : "Environment"}</span>
              <select value={selectedEnvironment} onChange={(event) => updateSelectedEnvironment(event.target.value)}>
                {(environmentOptions.length ? environmentOptions : [selectedEnvironment || "all"]).map((environment) => (
                  <option key={environment} value={environment}>
                    {environment === "all" ? "All environments" : environment}
                  </option>
                ))}
              </select>
            </label>
            <button className="icon-button" onClick={() => refresh()} title="Refresh dashboard">
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        {activeView === "overview" ? (
          <section id="overview" className="view-stack">
            <div className="metric-grid">
              <Metric icon={<Activity />} label="Workflow Sessions" value={metrics.workflowSessions} />
              <Metric icon={<CheckCircle2 />} label="Allowed" value={metrics.allowed} tone="allow" />
              <Metric icon={<PauseCircle />} label="Reviewed" value={metrics.reviewed} tone="review" />
              <Metric icon={<OctagonAlert />} label="Blocked" value={metrics.blocked} tone="block" />
              <Metric icon={<GitBranch />} label="High Risk" value={metrics.highRisk} tone="risk" />
              <Metric icon={<Network />} label="Workflows" value={metrics.workflows} />
            </div>

            <form className="demo-runner" onSubmit={runDemo}>
              <select value={query} onChange={(event) => setQuery(event.target.value)}>
                {demoQueries.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={loading}>
                {loading ? "Running..." : "Run Agent"}
              </button>
              <select
                value={selectedWorkflowDefinitionId}
                onChange={(event) => setSelectedWorkflowDefinitionId(event.target.value)}
                aria-label="Workflow definition"
              >
                {workflowDefinitions.map((definition) => (
                  <option key={definition.workflow_definition_id} value={definition.workflow_definition_id}>
                    {definition.name}
                  </option>
                ))}
                {!workflowDefinitions.length ? <option value="">No workflow definitions</option> : null}
              </select>
              <button type="button" onClick={runWorkflowDemo} disabled={loading || !selectedWorkflowDefinitionId}>
                {loading ? "Running..." : "Run Workflow"}
              </button>
            </form>

            <section className="lower-grid">
              <div className="panel">
                <div className="panel-title">Risk Types</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={riskChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4ded2" />
                    <XAxis dataKey="risk" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#287c72" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </section>
        ) : null}

        {activeView === "workflows" ? (
          <section id="workflows" className={`workflow-hub ${activeWorkflowTab === "marketplace" ? "workflow-builder-mode" : ""}`}>
            <div className="panel workflow-list-panel">
              <div className="panel-title marketplace-title">
                <span>{activeWorkflowTab === "runs" ? "Workflow Runs" : "Workflow Builder"}</span>
                <div className="marketplace-tabs" role="tablist" aria-label="Workflow views">
                  <button
                    className={activeWorkflowTab === "runs" ? "selected" : ""}
                    type="button"
                    role="tab"
                    aria-selected={activeWorkflowTab === "runs"}
                    onClick={() => setActiveWorkflowTab("runs")}
                  >
                    Runs
                  </button>
                  <button
                    className={activeWorkflowTab === "marketplace" ? "selected" : ""}
                    type="button"
                    role="tab"
                    aria-selected={activeWorkflowTab === "marketplace"}
                    onClick={() => setActiveWorkflowTab("marketplace")}
                  >
                    Builder
                  </button>
                </div>
              </div>
              {activeWorkflowTab === "runs" ? (
                <>
                  {workflows.map((item) => (
                    <div
                      key={item.workflow_id}
                      className={`workflow-row ${selectedWorkflowId === item.workflow_id ? "selected" : ""}`}
                    >
                      <button type="button" className="workflow-row-main" onClick={() => selectWorkflow(item.workflow_id)}>
                        <span>{item.workflow_id}</span>
                        <span className="workflow-decision-line">
                          <strong>{item.decision || item.status}</strong>
                          <EvalBadge workflowId={item.workflow_id} />
                        </span>
                        <small>{item.name}</small>
                        <em>{item.session_count} agent sessions</em>
                      </button>
                      <button type="button" className="workflow-trace-action" onClick={() => viewWorkflowTrace(item.workflow_id)}>
                        View Trace
                      </button>
                    </div>
                  ))}
                  {!workflows.length ? <div className="empty-state">Run a multi-agent workflow to create a grouped trace.</div> : null}
                </>
              ) : (
                <form className="workflow-builder-form" onSubmit={createWorkflowDefinitionFromJson}>
                  <div className="builder-header workflow-builder-header">
                    <div>
                      <span className="eyebrow">Agentic Workflow</span>
                      <h2>Build governed workflow.</h2>
                      {!canCreateWorkflow ? (
                        <p>This role cannot build workflow definitions in the selected environment.</p>
                      ) : null}
                    </div>
                    <div className="builder-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setWorkflowDefinitionJson(JSON.stringify(workflowTemplateFor(selectedEnvironment), null, 2));
                          setSelectedWorkflowBuilderStepId("identity");
                        }}
                      >
                        Use Template
                      </button>
                      <button type="button" onClick={addWorkflowBuilderStep}>
                        Add Step
                      </button>
                      <label className="file-action">
                        Import JSON
                        <input
                          accept="application/json,.json"
                          type="file"
                          onChange={(event) => loadJsonFile(event, setWorkflowDefinitionJson)}
                        />
                      </label>
                      <button className="builder-submit" type="submit" disabled={!canCreateWorkflow}>
                        Save Workflow
                      </button>
                    </div>
                  </div>

                  <div className="workflow-builder-grid">
                    <div className="workflow-canvas-panel">
                      <div className="workflow-builder-toolbar">
                        <label>
                          <span>ID</span>
                          <input
                            value={workflowBuilderDefinition.workflow_definition_id}
                            onChange={(event) => updateWorkflowDefinitionField("workflow_definition_id", event.target.value)}
                          />
                        </label>
                        <label>
                          <span>Name</span>
                          <input
                            value={workflowBuilderDefinition.name}
                            onChange={(event) => updateWorkflowDefinitionField("name", event.target.value)}
                          />
                        </label>
                        <label>
                          <span>Environment</span>
                          <select
                            value={workflowBuilderDefinition.environment}
                            onChange={(event) => {
                              updateWorkflowDefinitionField("environment", event.target.value);
                              setSelectedEnvironment(event.target.value);
                            }}
                          >
                            {environmentOptions.filter((item) => item !== "all").map((environment) => (
                              <option key={environment} value={environment}>
                                {environment}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Lead Agent</span>
                          <select
                            value={workflowBuilderDefinition.lead_agent_id}
                            onChange={(event) => updateWorkflowDefinitionField("lead_agent_id", event.target.value)}
                          >
                            {agents.map((agent) => (
                              <option key={agent.agent_id} value={agent.agent_id}>
                                {agent.display_name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="workflow-builder-canvas">
                        <ReactFlow
                          nodes={workflowBuilderGraph.nodes}
                          edges={workflowBuilderGraph.edges}
                          fitView
                          minZoom={0.35}
                          maxZoom={1.35}
                          onNodeClick={(_, node) => {
                            if (node.id !== "lead") {
                              setSelectedWorkflowBuilderStepId(node.id);
                            }
                          }}
                        >
                          <Background color="#d7d0c2" gap={18} />
                          <Controls />
                        </ReactFlow>
                      </div>
                    </div>

                    <div className="workflow-step-panel">
                      <div className="panel-title">Step Detail</div>
                      {selectedWorkflowBuilderStep ? (
                        <>
                          <label>
                            <span>Step ID</span>
                            <input
                              value={selectedWorkflowBuilderStep.step_id}
                              onChange={(event) => {
                                const nextId = event.target.value;
                                updateWorkflowBuilderStep("step_id", nextId);
                                setSelectedWorkflowBuilderStepId(nextId);
                              }}
                            />
                          </label>
                          <label>
                            <span>Label</span>
                            <input
                              value={selectedWorkflowBuilderStep.label || ""}
                              onChange={(event) => updateWorkflowBuilderStep("label", event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Agent</span>
                            <select
                              value={selectedWorkflowBuilderStep.agent_id || ""}
                              onChange={(event) => updateWorkflowBuilderStep("agent_id", event.target.value)}
                            >
                              {agents.map((agent) => (
                                <option key={agent.agent_id} value={agent.agent_id}>
                                  {agent.display_name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Tool</span>
                            <select
                              value={selectedWorkflowBuilderStep.tool_name || ""}
                              onChange={(event) => updateWorkflowBuilderStep("tool_name", event.target.value)}
                            >
                              <option value="">No tool</option>
                              {tools.map((tool) => (
                                <option key={tool} value={tool}>
                                  {tool}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Task</span>
                            <textarea
                              value={selectedWorkflowBuilderStep.task || ""}
                              onChange={(event) => updateWorkflowBuilderStep("task", event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Tool Args JSON</span>
                            <textarea
                              value={JSON.stringify(selectedWorkflowBuilderStep.tool_args || {}, null, 2)}
                              onChange={(event) => updateWorkflowBuilderStepToolArgs(event.target.value)}
                            />
                          </label>
                          <button type="button" className="danger-button" onClick={removeWorkflowBuilderStep}>
                            Remove Step
                          </button>
                        </>
                      ) : (
                        <div className="empty-state">Add a step or select a node.</div>
                      )}
                    </div>
                  </div>
                </form>
              )}
            </div>

            {activeWorkflowTab === "runs" ? (
            <div className="panel workflow-agents-panel">
              <div className="panel-title">{activeWorkflowTab === "runs" ? "Workflow Agents" : "Available Definitions"}</div>
              {workflowDetail ? (
                <div className="workflow-summary">
                  <div>
                    <span className="eyebrow">Selected workflow</span>
                    <h2>{workflowDetail.name}</h2>
                    <p>{workflowDetail.summary || workflowDetail.user_goal}</p>
                  </div>
                  <div className="workflow-agent-grid">
                    {workflowDetail.sessions.map((item) => (
                    <button
                      key={item.session_id}
                      className={`agent-session-card ${selectedSessionId === item.session_id ? "selected" : ""}`}
                      onClick={async () => {
                        await selectWorkflowSession(item.session_id);
                        switchView("workflow");
                      }}
                    >
                      <Layers3 size={17} />
                      <span>{item.role}</span>
                        <strong>{item.agent_identity?.display_name || item.agent_id}</strong>
                        <small>{item.session?.status}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="empty-state">No workflow selected.</div>
              )}
            </div>
            ) : null}
          </section>
        ) : null}

        {activeView === "workflow" ? (
          <section id="workflow" className="workflow-trace-view">
            <div className="panel workflow-panel">
              <div className="panel-title trace-panel-title">
                <span>Workflow Trace</span>
                <button type="button" onClick={() => switchView("workflows")}>
                  <ArrowLeft size={16} />
                  Back to Workflows
                </button>
              </div>
              <WorkflowTrace
                events={workflowDetail ? workflow : []}
                selectedEventId={selectedEvent?.event_id}
                onSelect={setSelectedEvent}
              />
            </div>

            <div className="workflow-trace-lower">
              <div className="panel run-list">
                <div className="panel-title">Workflow Sessions</div>
                {workflowDetail?.sessions?.map((item) => (
                  <button
                    key={item.session_id}
                    className={`run-row ${selectedSessionId === item.session_id ? "selected" : ""}`}
                    onClick={() => selectWorkflowSession(item.session_id)}
                  >
                    <span>{item.session_id}</span>
                    <strong>{item.session?.status}</strong>
                    <span>{item.agent_identity?.display_name || item.agent_id}</span>
                    <small>{item.session?.user_query}</small>
                  </button>
                ))}
                {!workflowDetail ? <div className="empty-state">No workflow selected.</div> : null}
              </div>

              {selectedEvent ? (
                <div className="panel details-panel">
                  <div className="panel-title">Node Detail</div>
                  <pre>{JSON.stringify(selectedEvent, null, 2)}</pre>
                </div>
              ) : (
                <div className="panel details-panel empty-detail-panel">
                  <div className="panel-title">Node Detail</div>
                  <div className="empty-state">Click a workflow node to inspect its detail.</div>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {activeView === "agents" ? (
          <section id="agents" className="panel agents-panel">
            <div className="panel-title marketplace-title">
              <span>Control Plane</span>
              <div className="marketplace-tabs" role="tablist" aria-label="Control plane resource views">
                <button
                  className={activeMarketplaceTab === "agents" ? "selected" : ""}
                  type="button"
                  role="tab"
                  aria-selected={activeMarketplaceTab === "agents"}
                  onClick={() => setActiveMarketplaceTab("agents")}
                >
                  Agents
                </button>
                <button
                  className={activeMarketplaceTab === "tools" ? "selected" : ""}
                  type="button"
                  role="tab"
                  aria-selected={activeMarketplaceTab === "tools"}
                  onClick={() => setActiveMarketplaceTab("tools")}
                >
                  Tools
                </button>
                <button
                  className={activeMarketplaceTab === "guardrails" ? "selected" : ""}
                  type="button"
                  role="tab"
                  aria-selected={activeMarketplaceTab === "guardrails"}
                  onClick={() => setActiveMarketplaceTab("guardrails")}
                >
                  Guardrails
                </button>
                <button
                  className={activeMarketplaceTab === "evaluators" ? "selected" : ""}
                  type="button"
                  role="tab"
                  aria-selected={activeMarketplaceTab === "evaluators"}
                  onClick={() => setActiveMarketplaceTab("evaluators")}
                >
                  Evaluators
                </button>
                <button
                  className={activeMarketplaceTab === "knowledge" ? "selected" : ""}
                  type="button"
                  role="tab"
                  aria-selected={activeMarketplaceTab === "knowledge"}
                  onClick={() => setActiveMarketplaceTab("knowledge")}
                >
                  Knowledge
                </button>
              </div>
            </div>

            {activeMarketplaceTab === "agents" ? (
              <AgentMarketplace
                agents={agents}
                tools={tools}
                currentUser={currentUser}
                selectedEnvironment={selectedEnvironment}
                environments={environments}
                selectedAgentId={selectedAgentId}
                agentJson={agentJson}
                guardrailPolicies={guardrailPolicies}
                evaluatorTemplates={evaluatorTemplates}
                knowledgeBases={knowledgeBases}
                canCreateAgent={canCreateAgent}
                onCreateAgent={createAgentFromJson}
                onUpdateAgent={updateAgentProfile}
                onSetAgentJson={setAgentJson}
                onSetSelectedAgentId={setSelectedAgentId}
                onLoadJsonFile={loadJsonFile}
                onUseTemplate={() => setAgentJson(JSON.stringify(agentTemplateFor(selectedEnvironment), null, 2))}
                onGrantTool={grantTool}
                onRevokeTool={revokeTool}
                onAssignGuardrail={assignGuardrail}
                onDeleteGuardrail={deleteGuardrailAssignment}
                onAssignEvaluator={assignEvaluator}
                onDeleteEvaluator={deleteEvaluatorAssignment}
                onAssignKB={assignKB}
                onDeleteKBAssignment={deleteKBAssignment}
                onDeleteAgent={deleteAgent}
              />
            ) : null}

            {activeMarketplaceTab === "tools" ? (
              <ToolMarketplace
                toolJson={toolJson}
                toolMarketplace={toolMarketplace}
                canCreateTool={canCreateTool}
                onCreateTool={createToolFromJson}
                onSetToolJson={setToolJson}
                onLoadJsonFile={loadJsonFile}
                onUseTemplate={() => setToolJson(JSON.stringify(toolTemplate, null, 2))}
              />
            ) : null}

            {activeMarketplaceTab === "guardrails" ? (
              <GovernanceMarketplace
                guardrailPolicyJson={guardrailPolicyJson}
                guardrailPolicies={guardrailPolicies}
                canCreateGuardrailPolicy={userCan(
                  currentUser,
                  selectedEnvironment === "all" ? "demo" : selectedEnvironment,
                  "agent:create",
                )}
                onCreateGuardrailPolicy={createGuardrailPolicyFromJson}
                onSetGuardrailPolicyJson={setGuardrailPolicyJson}
                onLoadJsonFile={loadJsonFile}
                onUseTemplate={() =>
                  setGuardrailPolicyJson(JSON.stringify(guardrailPolicyTemplateFor(selectedEnvironment), null, 2))
                }
                knowledgeBaseJson={knowledgeBaseJson}
                knowledgeBases={knowledgeBases}
                canCreateKnowledgeBase={userCan(
                  currentUser,
                  selectedEnvironment === "all" ? "demo" : selectedEnvironment,
                  "agent:create",
                )}
                onCreateKnowledgeBase={createKnowledgeBaseFromJson}
                onSetKnowledgeBaseJson={setKnowledgeBaseJson}
              />
            ) : null}

            {activeMarketplaceTab === "knowledge" ? (
              <GovernanceMarketplace
                guardrailPolicyJson={guardrailPolicyJson}
                guardrailPolicies={guardrailPolicies}
                canCreateGuardrailPolicy={userCan(
                  currentUser,
                  selectedEnvironment === "all" ? "demo" : selectedEnvironment,
                  "agent:create",
                )}
                onCreateGuardrailPolicy={createGuardrailPolicyFromJson}
                onSetGuardrailPolicyJson={setGuardrailPolicyJson}
                onLoadJsonFile={loadJsonFile}
                onUseTemplate={() =>
                  setGuardrailPolicyJson(JSON.stringify(guardrailPolicyTemplateFor(selectedEnvironment), null, 2))
                }
                knowledgeBaseJson={knowledgeBaseJson}
                knowledgeBases={knowledgeBases}
                canCreateKnowledgeBase={userCan(
                  currentUser,
                  selectedEnvironment === "all" ? "demo" : selectedEnvironment,
                  "agent:create",
                )}
                onCreateKnowledgeBase={createKnowledgeBaseFromJson}
                onSetKnowledgeBaseJson={setKnowledgeBaseJson}
                defaultSection="knowledge"
              />
            ) : null}

            {activeMarketplaceTab === "evaluators" ? (
              <EvaluatorMarketplace evaluatorTemplates={evaluatorTemplates} />
            ) : null}
          </section>
        ) : null}

        {activeView === "policies" ? (
          <section id="policies" className="policy-view">
            {policies ? (
              <>
                <div className="policy-summary-grid">
                  <div className="policy-summary-card">
                    <span>Scope</span>
                    <strong>{policies.environment_scope}</strong>
                    <small>{policies.policy_path}</small>
                  </div>
                  <div className="policy-summary-card review">
                    <span>Review threshold</span>
                    <strong>{policies.policy.decision_thresholds.review}</strong>
                    <small>risk score</small>
                  </div>
                  <div className="policy-summary-card block">
                    <span>Block threshold</span>
                    <strong>{policies.policy.decision_thresholds.block}</strong>
                    <small>risk score</small>
                  </div>
                  <div className="policy-summary-card">
                    <span>Max records</span>
                    <strong>{policies.policy.max_records_returned}</strong>
                    <small>per tool result</small>
                  </div>
                </div>

                <div className="policy-grid">
                  {policies.policy.risk_controls.map((control) => (
                    <div className="policy-card" key={control.control_id}>
                      <div className="policy-card-header">
                        <div>
                          <strong>{control.control_id.replaceAll("_", " ")}</strong>
                          <span>{control.category}</span>
                        </div>
                        <span className={control.enabled ? "policy-state enabled" : "policy-state"}>
                          {control.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                      <div className={decisionClass(control.decision)}>{control.decision}</div>
                      <div className="policy-rule-list">
                        {control.rules.length ? (
                          control.rules.map((rule) => <span key={rule}>{rule}</span>)
                        ) : (
                          <em>No rules configured</em>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="panel policy-raw-panel">
                  <div className="panel-title">Runtime Policy JSON</div>
                  <pre>{JSON.stringify(policies.policy, null, 2)}</pre>
                </div>
              </>
            ) : (
              <div className="panel">
                <div className="empty-state">No policy configuration loaded.</div>
              </div>
            )}
          </section>
        ) : null}

        {activeView === "review" ? (
          <section id="review" className="panel review-panel">
            <div className="panel-title">Review Queue</div>
            <div className="table">
              {reviews.map((review) => (
                <div className="table-row" key={review.review_id}>
                  <span>{review.tool_name}</span>
                  <span className="risk-text">{review.risk_types.join(", ")}</span>
                  <span>{review.risk_score}</span>
                  <button
                    disabled={!userCan(currentUser, review.agent_environment, "review:resolve")}
                    onClick={() => resolveReview(review.review_id, "APPROVED")}
                  >
                    Approve
                  </button>
                  <button
                    className="danger-button"
                    disabled={!userCan(currentUser, review.agent_environment, "review:resolve")}
                    onClick={() => resolveReview(review.review_id, "DENIED")}
                  >
                    Deny
                  </button>
                </div>
              ))}
              {!reviews.length ? <div className="empty-state">No pending review items.</div> : null}
            </div>
          </section>
        ) : null}

        {activeView === "audit" ? (
          <section id="audit" className="panel audit-panel">
            <div className="panel-title">Audit Events</div>
            <div className="audit-table">
              <div className="audit-head">
                <span>Decision</span>
                <span>Risk</span>
                <span>Tool</span>
                <span>Reason</span>
              </div>
              {auditEvents.map((event) => (
                <div className="audit-row" key={event.event_id}>
                  <span className={decisionClass(event.decision)}>{event.decision}</span>
                  <span>{event.risk_type}</span>
                  <span>{event.tool_name || "final_response"}</span>
                  <span>{event.reason}</span>
                </div>
              ))}
              {!auditEvents.length ? <div className="empty-state">No workflow audit events.</div> : null}
            </div>
          </section>
        ) : null}
        </section>
      </main>
    </>
  );
}

function Metric({ icon, label, value, tone = "" }) {
  return (
    <div className={`metric ${tone}`}>
      {cloneElement(icon, { size: 20 })}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("Agent Developer");
  const [authMode, setAuthMode] = useState(null);
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requiresInitialAdmin, setRequiresInitialAdmin] = useState(true);
  const [signupRoles, setSignupRoles] = useState(loginRoles);
  const [governanceLeadEnvironment, setGovernanceLeadEnvironment] = useState("all");
  const [guardieOpen, setGuardieOpen] = useState(false);
  const [landingTheme, setLandingTheme] = useState(() => {
    if (typeof window === "undefined") {
      return "dark";
    }
    try {
      const storedTheme = window.localStorage.getItem("intelliguard-theme");
      if (storedTheme === "light" || storedTheme === "dark") {
        return storedTheme;
      }
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    api.bootstrapStatus()
      .then((status) => {
        setRequiresInitialAdmin(status.requires_initial_admin);
        setSignupRoles(status.signup_roles?.length ? status.signup_roles : loginRoles);
      })
      .catch(() => {
        setSignupRoles(loginRoles);
      });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = landingTheme;
    try {
      window.localStorage.setItem("intelliguard-theme", landingTheme);
    } catch {
      // Ignore storage restrictions; the visible theme still updates.
    }
  }, [landingTheme]);

  useEffect(() => {
    if (authMode === "signup" && requiresInitialAdmin) {
      setRole("Governance Lead");
      return;
    }
    if (authMode === "signup" && !signupRoles.includes(role)) {
      setRole(signupRoles[0] || "Agent Developer");
    }
  }, [authMode, requiresInitialAdmin, role, signupRoles]);

  const activeRoleOptions = authMode === "signup" ? signupRoles : loginRoles;
  const showGovernanceLeadEnvironment = role === "Governance Lead";
  const capabilities = [
    {
      icon: Activity,
      title: "Monitor agent actions",
      description: "Observe autonomous workflows, tool calls, context usage, and decision paths.",
    },
    {
      icon: Network,
      title: "Evaluate risk",
      description: "Score actions against policy, business rules, safety frameworks, and operational thresholds.",
    },
    {
      icon: ShieldCheck,
      title: "Enforce controls",
      description: "Block, approve, route, or escalate actions before they impact production systems.",
    },
    {
      icon: GitBranch,
      title: "Audit decisions",
      description: "Preserve evidence across prompts, outputs, tool executions, policies, and approvals.",
    },
  ];
  const useCases = [
    {
      title: "AI code review governance",
      problem: "Autonomous code agents can approve changes without enough policy context.",
      help: "IntelliGuard scores actions against engineering controls, ownership rules, and release policy.",
      outcome: "High-risk changes route to review before they merge or deploy.",
    },
    {
      title: "Agent runtime monitoring",
      problem: "Teams cannot see how agents use tools, context, prompts, and delegated steps.",
      help: "IntelliGuard links runtime traces to agent identity, permissions, policies, and reviews.",
      outcome: "Operations teams get searchable evidence for every autonomous workflow.",
    },
    {
      title: "Enterprise LLM risk controls",
      problem: "Model outputs and tool calls need enforcement before they touch production systems.",
      help: "IntelliGuard blocks, approves, escalates, or audits actions through runtime governance hooks.",
      outcome: "Risk teams get enforceable control without slowing engineering delivery.",
    },
  ];
  const controlPlane = ["Policy Engine", "Risk Scoring", "Approval Workflow", "Audit Trail"];
  const executionPlane = ["Agentic Workflows", "Agents", "Tools", "APIs", "Data Sources", "LLMs"];
  const developerBullets = [
    "API-first governance hooks",
    "Policy-as-code ready",
    "Works with agent frameworks",
    "Built for runtime evidence",
  ];
  const authCopy = authMode === "signup"
    ? {
        eyebrow: "Sandbox access",
        title: "Start with IntelliGuard",
        description: "Create a controlled sandbox to evaluate runtime governance before production rollout.",
        button: "Create sandbox",
      }
    : {
        eyebrow: "Workspace access",
        title: "Login to IntelliGuard",
        description: "Return to your governance control plane for agents, policies, approvals, and audit evidence.",
        button: "Continue to workspace",
      };

  async function submit(event) {
    event?.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Enter an email and password to continue.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onLogin(
        {
          email: email.trim(),
          password,
          display_name: fullName.trim() || email.trim().split("@")[0] || "IntelliGuard user",
          role,
        },
        authMode,
        showGovernanceLeadEnvironment ? governanceLeadEnvironment : undefined,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function moveParticles(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 24;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 24;
    event.currentTarget.style.setProperty("--particle-shift-x", `${x.toFixed(2)}px`);
    event.currentTarget.style.setProperty("--particle-shift-y", `${y.toFixed(2)}px`);
  }

  function toggleLandingTheme() {
    setLandingTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  return (
    <main className="landing-page particle-stage" data-theme={landingTheme} onPointerMove={moveParticles}>
      <div className="landing-backdrop" aria-hidden="true">
        <span className="landing-backdrop-ambient" />
        <span className="landing-orb landing-orb-primary" />
        <span className="landing-orb landing-orb-horizon" />
        <span className="landing-scan-field" />
        <span className="landing-grid" />
        <span className="landing-vertical-line line-a" />
        <span className="landing-vertical-line line-b" />
        <span className="landing-vertical-line line-c" />
        <span className="landing-vignette" />
      </div>
      <InteractiveParticles />

      <header className="landing-nav">
        <a className="landing-wordmark" href="#platform" aria-label="IntelliGuard home">
          <span className="landing-mark">
            <ShieldCheck size={20} aria-hidden="true" />
          </span>
          <strong>IntelliGuard</strong>
        </a>
        <nav aria-label="Landing navigation">
          <a href="#platform">Platform</a>
          <a href="#governance">Governance</a>
          <a href="#use-cases">Use Cases</a>
          <a href="#developers">Developers</a>
          <a href="#contact">Contact</a>
        </nav>
        <div className="landing-nav-actions">
          <button
            className="landing-theme-toggle"
            type="button"
            onClick={toggleLandingTheme}
            aria-label={`Switch to ${landingTheme === "dark" ? "light" : "dark"} mode`}
          >
            {landingTheme === "dark" ? <Sun size={22} aria-hidden="true" /> : <Moon size={22} aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode("signin");
              setError("");
            }}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => {
              if (!requiresInitialAdmin && role === "Governance Lead") {
                setRole("Agent Developer");
              }
              setAuthMode("signup");
              setError("");
            }}
          >
            Sign Up
          </button>
          <button
            className="landing-primary"
            type="button"
            onClick={() => {
              if (!requiresInitialAdmin && role === "Governance Lead") {
                setRole("Agent Developer");
              }
              setAuthMode("signup");
              setError("");
            }}
          >
            Request Demo
          </button>
        </div>
      </header>

      <section id="platform" className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-pill">
            <span />
            AI runtime control plane
          </div>
          <h1>Governance wired into AI runtime</h1>
          <p className="landing-subheadline">
            Monitor agent actions. Evaluate risk. Enforce controls. Protect trust.
          </p>
          <div className="landing-cta-row">
            <a href="#architecture">View Platform</a>
            <button
              className="landing-primary"
              type="button"
              onClick={() => {
                if (!requiresInitialAdmin && role === "Governance Lead") {
                  setRole("Agent Developer");
                }
                setAuthMode("signup");
                setError("");
              }}
            >
              Try IntelliGuard
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="landing-hero-panel" aria-label="Human plus AI to governed runtime">
          <div className="hero-panel-topline hero-panel-topline-end">
            <strong>governed runtime</strong>
          </div>
          <div className="runtime-core">
            <span className="runtime-chip chip-policy">Policy</span>
            <span className="runtime-chip chip-risk">Risk</span>
            <span className="runtime-chip chip-audit">Audit</span>
            <span className="runtime-chip chip-rbac">RBAC</span>
            <div className="runtime-actor">
              <span />
              <strong>Human</strong>
              <small>intent</small>
            </div>
            <div className="runtime-shield">
              <ShieldCheck size={38} aria-hidden="true" />
              <span>IntelliGuard</span>
            </div>
            <div className="runtime-actor">
              <span />
              <strong>AI</strong>
              <small>agent action</small>
            </div>
          </div>
          <div className="runtime-progress">
            <div>
              <span>Human + AI</span>
              <strong>Governed Runtime</strong>
            </div>
            <span className="runtime-progress-bar" />
          </div>
        </div>
      </section>

      <section id="governance" className="landing-section">
        <div className="landing-section-heading">
          <span>Platform capabilities</span>
          <h2>Control surfaces for autonomous AI.</h2>
          <p>IntelliGuard turns agent behavior into observable, scored, enforceable runtime decisions.</p>
        </div>
        <div className="landing-card-grid four">
          {capabilities.map(({ icon: Icon, title, description }) => (
            <article className="landing-card" key={title}>
              <div className="card-icon">
                <Icon size={22} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="architecture" className="landing-section">
        <div className="landing-section-heading centered">
          <span>Architecture</span>
          <h2>The execution plane runs. The control plane governs.</h2>
          <p>
            Agentic workflows remain the execution plane. IntelliGuard governs through policy, authorization,
            evaluation, approval, model routing, and evidence capture.
          </p>
        </div>
        <div className="architecture-panel">
          <ArchitectureLayer title="Control Plane" items={controlPlane} tone="control" />
          <div className="flow-bridge" aria-hidden="true">
            <span />
          </div>
          <ArchitectureLayer title="Execution Plane" items={executionPlane} tone="execution" />
        </div>
      </section>

      <section id="use-cases" className="landing-section">
        <div className="landing-section-heading">
          <span>Use cases</span>
          <h2>Governance where agentic work happens.</h2>
        </div>
        <div className="landing-card-grid three">
          {useCases.map((useCase) => (
            <article className="landing-card use-case-card" key={useCase.title}>
              <h3>{useCase.title}</h3>
              <dl>
                <dt>Problem</dt>
                <dd>{useCase.problem}</dd>
                <dt>How IntelliGuard helps</dt>
                <dd>{useCase.help}</dd>
                <dt>Outcome</dt>
                <dd>{useCase.outcome}</dd>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section id="developers" className="landing-section developer-section">
        <div>
          <div className="landing-section-heading">
            <span>Developers</span>
            <h2>Built for engineers, trusted by risk teams.</h2>
          </div>
          <div className="code-window">
            <div className="code-window-header">
              <span />
              <span />
              <span />
              <strong>runtime-governance.ts</strong>
            </div>
            <pre>{`const decision = await intelliguard.evaluate({
  agentId: "claims-agent",
  action: "approve_refund",
  context: {
    customerTier: "enterprise",
    refundAmount: 4200,
    policyVersion: "v3.2"
  }
});

if (decision.status === "blocked") {
  await intelliguard.escalate(decision);
}`}</pre>
          </div>
        </div>
        <aside className="landing-card developer-bullets">
          <h3>Runtime control without heavy lift.</h3>
          {developerBullets.map((bullet) => (
            <p key={bullet}>
              <CheckCircle2 size={18} aria-hidden="true" />
              {bullet}
            </p>
          ))}
        </aside>
      </section>

      <section id="contact" className="landing-section final-cta">
        <div>
          <h2>Bring control to autonomous AI.</h2>
          <p>
            IntelliGuard helps teams monitor, evaluate, and govern AI actions before they become business risk.
          </p>
          <div className="landing-cta-row">
            <button
              className="landing-primary"
              type="button"
              onClick={() => {
                if (!requiresInitialAdmin && role === "Governance Lead") {
                  setRole("Agent Developer");
                }
                setAuthMode("signup");
                setError("");
              }}
            >
              Request Demo
              <ArrowRight size={16} aria-hidden="true" />
            </button>
            <a href="#architecture">Explore Architecture</a>
          </div>
        </div>
      </section>

      <aside className="guardie-chatbot" aria-label="Guardie chatbot">
        {guardieOpen ? (
          <div className="guardie-chat-panel">
            <div className="guardie-chat-header">
              <span className="guardie-chat-icon">
                <Bot size={19} aria-hidden="true" />
              </span>
              <div>
                <strong>Guardie</strong>
                <span>Platform facilitator</span>
              </div>
            </div>
            <p>I can help you inspect risks, policies, and agent actions.</p>
            <div className="guardie-chat-actions" aria-label="Guardie quick actions">
              {["Inspect Risk", "View Policy", "Audit Trail"].map((action) => (
                <button key={action} type="button">
                  <span>{action}</span>
                  <ChevronRight size={13} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <button
          className="guardie-chat-trigger"
          type="button"
          aria-label={guardieOpen ? "Close Guardie assistant" : "Open Guardie assistant"}
          onClick={() => setGuardieOpen((current) => !current)}
        >
          <span className="guardie-eyes" aria-hidden="true">
            <span />
            <span />
          </span>
        </button>
      </aside>

      <footer className="landing-footer">
        <strong>IntelliGuard</strong>
        <nav aria-label="Footer navigation">
          <a href="#platform">Platform</a>
          <a href="#governance">Governance</a>
          <a href="#developers">Developers</a>
          <a href="#contact">Contact</a>
        </nav>
        <small>Copyright 2026 IntelliData Consulting Pty Ltd. All rights reserved.</small>
      </footer>

      {authMode ? (
        <div className="auth-modal-backdrop" role="dialog" aria-modal="true" aria-label="IntelliGuard access form">
          <section className="auth-modal-v2" aria-labelledby="auth-modal-title">
            <button className="auth-close-v2" type="button" onClick={() => setAuthMode(null)} aria-label="Close login and sign up modal">
              <X size={28} strokeWidth={1.8} aria-hidden="true" />
            </button>

            <aside className="auth-modal-intro">
              <div className="auth-intro-content">
                <div className="auth-intro-mark">
                  <ShieldCheck size={34} strokeWidth={2.1} aria-hidden="true" />
                </div>
                <p className="auth-intro-eyebrow">{authCopy.eyebrow}</p>
                <h2 id="auth-modal-title">{authCopy.title}</h2>
                <p>{authCopy.description}</p>
                <div className="auth-includes">
                  <p>Access includes</p>
                  <ul>
                    <li>RBAC-aware workspace authorization</li>
                    <li>Agent, tool, policy, and audit visibility</li>
                    <li>LiteLLM gateway and governed model routing</li>
                  </ul>
                </div>
              </div>
            </aside>

            <div className="auth-form-pane">
              <div className="auth-mode-switch" aria-label="Authentication actions">
                <button
                  className={authMode === "signin" ? "selected" : ""}
                  type="button"
                  onClick={() => {
                    setAuthMode("signin");
                    setError("");
                  }}
                >
                  Login
                </button>
                <button
                  className={authMode === "signup" ? "selected" : ""}
                  type="button"
                  onClick={() => {
                    setAuthMode("signup");
                    setError("");
                  }}
                >
                  Sign Up
                </button>
              </div>

              <form className="auth-form-v2" onSubmit={submit}>
                {authMode === "signup" ? (
                  <label>
                    <span>Company</span>
                    <div className="auth-input-wrap">
                      <Building2 size={24} strokeWidth={2.1} aria-hidden="true" />
                      <input value={fullName} onChange={(event) => setFullName(event.target.value)} type="text" autoComplete="organization" />
                    </div>
                  </label>
                ) : null}
                <label>
                  <span>Work email</span>
                  <div className="auth-input-wrap">
                    <Mail size={24} strokeWidth={2.1} aria-hidden="true" />
                    <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" />
                  </div>
                </label>
                <label>
                  <span>Role</span>
                  <div className="auth-input-wrap">
                    <UserCog size={24} strokeWidth={2.1} aria-hidden="true" />
                    <select value={role} onChange={(event) => setRole(event.target.value)} disabled={authMode === "signup" && requiresInitialAdmin}>
                      {activeRoleOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>
                {showGovernanceLeadEnvironment ? (
                  <label>
                    <span>Environment to check</span>
                    <div className="auth-input-wrap">
                      <Network size={24} strokeWidth={2.1} aria-hidden="true" />
                      <select
                        value={governanceLeadEnvironment}
                        onChange={(event) => setGovernanceLeadEnvironment(event.target.value)}
                      >
                        {governanceLeadEnvironmentOptions.map((environment) => (
                          <option key={environment} value={environment}>
                            {environment === "all" ? "All environments" : environment}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                ) : null}
                <label>
                  <span>Password</span>
                  <div className="auth-input-wrap">
                    <LockKeyhole size={24} strokeWidth={2.1} aria-hidden="true" />
                    <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={authMode === "signup" ? "new-password" : "current-password"} />
                  </div>
                </label>
                {authMode === "signup" && requiresInitialAdmin ? (
                  <p className="auth-form-note">This first account will become the Governance Lead admin.</p>
                ) : null}
                {error ? <div className="auth-error">{error}</div> : null}
                <button className="auth-submit-v2" type="submit" disabled={submitting}>
                  <span>{submitting ? "Connecting..." : authCopy.button}</span>
                  <ArrowRight size={26} strokeWidth={2.1} aria-hidden="true" />
                </button>
              </form>
              <p className="auth-success-note">Successful authentication opens the IntelliGuard platform workspace.</p>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function ArchitectureLayer({ title, items, tone }) {
  return (
    <div className={`architecture-layer ${tone}`}>
      <div className="architecture-layer-header">
        <h3>{title}</h3>
        <span>{tone === "control" ? "governs" : "executes"}</span>
      </div>
      <div className="architecture-items">
        {items.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function IntroTransition({ active }) {
  if (!active) {
    return null;
  }

  return (
    <div className="intro-transition" aria-hidden="true">
      <div className="intro-paint" />
      <div className="intro-mark">
        <div className="brand-mark large">
          <Shield size={30} />
        </div>
        <span>IntelliGuard</span>
      </div>
    </div>
  );
}

function InteractiveParticles() {
  return (
    <div className="interactive-particles" aria-hidden="true">
      {particleSeeds.map((particle, index) => (
        <span
          className="particle"
          key={`${particle.x}-${particle.y}`}
          style={{
            "--x": particle.x,
            "--y": particle.y,
            "--size": `${particle.size}px`,
            "--delay": `${particle.delay}s`,
            "--depth": particle.depth,
          }}
        />
      ))}
    </div>
  );
}
