import React, { useEffect, useMemo, useState } from "react";
import MouseTrail from "./components/MouseTrail.jsx";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  GitBranch,
  KeyRound,
  Layers3,
  LogIn,
  LogOut,
  Mail,
  Network,
  OctagonAlert,
  PauseCircle,
  RefreshCw,
  Shield,
  ShieldCheck,
} from "lucide-react";
import { Background, Controls, MarkerType, ReactFlow } from "@xyflow/react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "./lib/api";
import WorkflowTrace from "./components/WorkflowTrace";

const demoQueries = [
  "Show recent transactions for customer C123",
  "Dump all customer data",
  "Find all customers in Melbourne and show their emails",
  "Show me C123's full profile including email and phone",
];

const particleSeeds = [
  { x: 8, y: 18, size: 9, drift: 0.6, delay: 0 },
  { x: 18, y: 72, size: 6, drift: -0.4, delay: 0.8 },
  { x: 29, y: 28, size: 5, drift: 0.3, delay: 1.2 },
  { x: 43, y: 14, size: 8, drift: -0.5, delay: 0.4 },
  { x: 58, y: 76, size: 7, drift: 0.5, delay: 1.6 },
  { x: 70, y: 22, size: 5, drift: -0.3, delay: 0.2 },
  { x: 84, y: 62, size: 10, drift: 0.4, delay: 1 },
  { x: 92, y: 34, size: 6, drift: -0.6, delay: 1.4 },
  { x: 12, y: 48, size: 4, drift: 0.7, delay: 1.8 },
  { x: 38, y: 88, size: 8, drift: -0.2, delay: 0.6 },
  { x: 63, y: 46, size: 4, drift: 0.6, delay: 2 },
  { x: 78, y: 86, size: 5, drift: -0.7, delay: 1.1 },
];

const navItems = [
  { id: "overview", label: "Overview", title: "Overview" },
  { id: "workflows", label: "Workflows", title: "Workflows" },
  { id: "workflow", label: "Workflow Trace", title: "Workflow Trace" },
  { id: "agents", label: "Marketplaces", title: "Marketplaces" },
  { id: "policies", label: "Policies", title: "Policies" },
  { id: "review", label: "Review Queue", title: "Review Queue" },
  { id: "audit", label: "Audit Events", title: "Audit Events" },
];

const loginRoles = [
  "Governance Lead",
  "Governance Reviewer",
  "Support Operations Manager",
  "Agent Developer",
];

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

function userCan(user, environment, permission) {
  if (!user) {
    return false;
  }
  if (user.is_super_admin) {
    return true;
  }
  if (!environment || environment === "all") {
    return false;
  }
  const permissions = user.permissions_by_environment?.[environment] || [];
  return permissions.includes("*") || permissions.includes(permission) || (permission === "read" && permissions.includes("read"));
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
  const [environments, setEnvironments] = useState([]);
  const [policies, setPolicies] = useState(null);
  const [selectedEnvironment, setSelectedEnvironment] = useState("all");
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState("customer-support-agent");
  const [selectedToolGrant, setSelectedToolGrant] = useState("get_customer_profile");
  const [activeMarketplaceTab, setActiveMarketplaceTab] = useState("agents");
  const [activeWorkflowTab, setActiveWorkflowTab] = useState("runs");
  const [agentJson, setAgentJson] = useState(() => JSON.stringify(agentTemplateFor("all"), null, 2));
  const [toolJson, setToolJson] = useState(() => JSON.stringify(toolTemplate, null, 2));
  const [workflowDefinitionJson, setWorkflowDefinitionJson] = useState(() => JSON.stringify(workflowTemplateFor("all"), null, 2));
  const [selectedWorkflowBuilderStepId, setSelectedWorkflowBuilderStepId] = useState("identity");
  const [activeView, setActiveView] = useState(viewFromHash);
  const [query, setQuery] = useState(demoQueries[0]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowIntro(false), 2300);
    return () => window.clearTimeout(timer);
  }, []);

  async function login(payload, mode) {
    const authSession = mode === "signup" ? await api.register(payload) : await api.login(payload);
    setCurrentUser(authSession.user);
    try {
      localStorage.setItem("governance-session", JSON.stringify(authSession));
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
  const canGrantTool = userCan(currentUser, selectedEnvironment, "tool:grant");
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
    const effectiveEnvironment = allowedOptions.includes(environment)
      ? environment
      : userContext.default_environment || allowedOptions[0] || "all";
    if (effectiveEnvironment !== selectedEnvironment) {
      setSelectedEnvironment(effectiveEnvironment);
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
      api.toolMarketplace(),
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
    setSelectedAgentId((current) =>
      agentRows.some((agent) => agent.agent_id === current)
        ? current
        : agentRows[0]?.agent_id || "",
    );
    setSelectedToolGrant((current) => current || toolRows[0] || "get_customer_profile");
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
      setError("Create or select a workflow definition before running a workflow.");
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

  async function grantSelectedTool(event) {
    event?.preventDefault();
    if (!canGrantTool) {
      setError("Your current role cannot change tool grants in this environment.");
      return;
    }
    if (!selectedAgentId) {
      setError("Create or select an agent in this environment before attaching tools.");
      return;
    }
    await api.grantTool(selectedAgentId, selectedToolGrant);
    await refresh();
  }

  async function createAgentFromJson(event) {
    event?.preventDefault();
    setError("");
    try {
      const payload = JSON.parse(agentJson);
      if (!canCreateAgent) {
        setError("Your current role cannot create or update agents in this environment.");
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

  async function createToolFromJson(event) {
    event?.preventDefault();
    setError("");
    try {
      const payload = JSON.parse(toolJson);
      if (!canCreateTool) {
        setError("Your current role cannot create marketplace tools in this environment.");
        return;
      }
      payload.environment = selectedEnvironment === "all" ? "demo" : selectedEnvironment;
      const tool = await api.createTool(payload);
      setSelectedToolGrant(tool.tool_name);
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
        setError("Your current role cannot create workflow definitions in this environment.");
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
    if (!canGrantTool) {
      setError("Your current role cannot revoke tool grants in this environment.");
      return;
    }
    await api.revokeTool(agentId, toolName);
    await refresh();
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
        <MouseTrail />
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
            <span>Agent governance control plane</span>
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
            <span className="eyebrow">Live governance console</span>
            <h1>{activeNavItem.title}</h1>
            <p>Tool calls, permissions, reviews, and blocked actions as workflow traces.</p>
          </div>
          <div className="topbar-actions">
            <label className="environment-switcher">
              <span>Environment</span>
              <select value={selectedEnvironment} onChange={(event) => setSelectedEnvironment(event.target.value)}>
                {environmentOptions.map((environment) => (
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
                <span>{activeWorkflowTab === "runs" ? "Workflow Runs" : "Workflow Marketplace"}</span>
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
                        <strong>{item.decision || item.status}</strong>
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
                      <span className="eyebrow">Workflow Builder</span>
                      <h2>Design runnable workflow.</h2>
                      {!canCreateWorkflow ? (
                        <p>This role cannot create workflow definitions in the selected environment.</p>
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
                        Upload JSON
                        <input
                          accept="application/json,.json"
                          type="file"
                          onChange={(event) => loadJsonFile(event, setWorkflowDefinitionJson)}
                        />
                      </label>
                      <button className="builder-submit" type="submit" disabled={!canCreateWorkflow}>
                        Create Workflow
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
              <span>Marketplaces</span>
              <div className="marketplace-tabs" role="tablist" aria-label="Marketplace views">
                <button
                  className={activeMarketplaceTab === "agents" ? "selected" : ""}
                  type="button"
                  role="tab"
                  aria-selected={activeMarketplaceTab === "agents"}
                  onClick={() => setActiveMarketplaceTab("agents")}
                >
                  Agent
                </button>
                <button
                  className={activeMarketplaceTab === "tools" ? "selected" : ""}
                  type="button"
                  role="tab"
                  aria-selected={activeMarketplaceTab === "tools"}
                  onClick={() => setActiveMarketplaceTab("tools")}
                >
                  Tool
                </button>
              </div>
            </div>

            {activeMarketplaceTab === "agents" ? (
              <div className="marketplace-view">
                <div className="marketplace-builder">
                  <form className="json-builder" onSubmit={createAgentFromJson}>
                    <div className="builder-header">
                      <div>
                        <span className="eyebrow">Agent Template</span>
                        <h2>Create governed agent identity.</h2>
                        {!canCreateAgent ? (
                          <p>This role cannot create agents in the selected environment.</p>
                        ) : null}
                      </div>
                      <div className="builder-actions">
                        <button type="button" onClick={() => setAgentJson(JSON.stringify(agentTemplateFor(selectedEnvironment), null, 2))}>
                          Use Template
                        </button>
                        <label className="file-action">
                          Upload JSON
                          <input accept="application/json,.json" type="file" onChange={(event) => loadJsonFile(event, setAgentJson)} />
                        </label>
                      </div>
                    </div>
                    <textarea value={agentJson} onChange={(event) => setAgentJson(event.target.value)} spellCheck="false" />
                    <button className="builder-submit" type="submit" disabled={!canCreateAgent}>Create Agent</button>
                  </form>

                  <form className="grant-bar" onSubmit={grantSelectedTool}>
                    <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>
                      {agents.map((agent) => (
                        <option key={agent.agent_id} value={agent.agent_id}>
                          {agent.display_name}
                        </option>
                      ))}
                    </select>
                    <select value={selectedToolGrant} onChange={(event) => setSelectedToolGrant(event.target.value)}>
                      {tools.map((tool) => (
                        <option key={tool} value={tool}>
                          {tool}
                        </option>
                      ))}
                    </select>
                    <button type="submit" disabled={!canGrantTool || !selectedAgentId}>Attach Tool</button>
                  </form>
                </div>

                <div className="agent-grid">
                  {agents.map((agent) => {
                    const grantedTools = agent.permissions?.tools || [];
                    return (
                      <div className="agent-card" key={agent.agent_id}>
                        <div>
                          <strong>{agent.display_name}</strong>
                          <span>{agent.agent_id}</span>
                        </div>
                        <p>{agent.purpose}</p>
                        <div className="agent-meta">
                          <span>Marketplace Agent</span>
                          <span>{agent.owner}</span>
                          <span>{agent.environment}</span>
                          <span>{agent.agent_type}</span>
                        </div>
                        <div className="grant-list">
                          {grantedTools.map((tool) => (
                            <button
                              key={tool}
                              disabled={!canGrantTool}
                              onClick={() => revokeTool(agent.agent_id, tool)}
                              title={`Revoke ${tool}`}
                            >
                              {tool}
                            </button>
                          ))}
                          {!grantedTools.length ? <span>No tools attached</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {activeMarketplaceTab === "tools" ? (
              <div className="marketplace-view">
                <form className="json-builder" onSubmit={createToolFromJson}>
                  <div className="builder-header">
                    <div>
                      <span className="eyebrow">Tool Template</span>
                      <h2>Create marketplace tool.</h2>
                      {!canCreateTool ? (
                        <p>This role cannot create tools in the selected environment.</p>
                      ) : null}
                    </div>
                    <div className="builder-actions">
                      <button type="button" onClick={() => setToolJson(JSON.stringify(toolTemplate, null, 2))}>
                        Use Template
                      </button>
                      <label className="file-action">
                        Upload JSON
                        <input accept="application/json,.json" type="file" onChange={(event) => loadJsonFile(event, setToolJson)} />
                      </label>
                    </div>
                  </div>
                  <textarea value={toolJson} onChange={(event) => setToolJson(event.target.value)} spellCheck="false" />
                  <button className="builder-submit" type="submit" disabled={!canCreateTool}>Create Tool</button>
                </form>

                <div className="tool-marketplace-grid">
                  {toolMarketplace.map((tool) => (
                    <div className="tool-marketplace-card" key={tool.tool_name}>
                      <strong>{tool.display_name || tool.tool_name}</strong>
                      <span>{tool.tool_name}</span>
                      <small>{tool.description || "Grant-gated marketplace tool"}</small>
                    </div>
                  ))}
                </div>
              </div>
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
                  <div className="panel-title">Raw Policy</div>
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
      {React.cloneElement(icon, { size: 20 })}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("Governance Lead");
  const [authMode, setAuthMode] = useState(null);
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requiresInitialAdmin, setRequiresInitialAdmin] = useState(true);
  const [signupRoles, setSignupRoles] = useState(loginRoles);

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
    if (authMode === "signup" && !signupRoles.includes(role)) {
      setRole(signupRoles[0] || "Agent Developer");
    }
  }, [authMode, role, signupRoles]);

  const activeRoleOptions = authMode === "signup" ? signupRoles : loginRoles;

  async function submit(event) {
    event?.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Enter an email and password to continue.");
      return;
    }
    if (authMode === "signup" && !fullName.trim()) {
      setError("Enter a full name for the first administrator.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onLogin(
        {
          email: email.trim(),
          password,
          display_name: fullName.trim(),
          role,
        },
        authMode,
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

  return (
    <main className="login-shell particle-stage" onPointerMove={moveParticles}>
      <div className="login-atmosphere" aria-hidden="true">
        <span className="atmosphere-ring ring-one" />
        <span className="atmosphere-ring ring-two" />
        <span className="atmosphere-scan" />
      </div>
      <InteractiveParticles />

      <div className="onboarding-auth-actions" aria-label="Authentication actions">
        <button
          type="button"
              onClick={() => {
                setAuthMode("signin");
                setError("");
              }}
        >
          Log in
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
          Sign up
        </button>
      </div>

      <section className="login-hero">
        <div className="login-hero-brand">
          <LoginLottiePanel className="hero-lottie" />
        </div>
        <h1>Control every agent action before it happens.</h1>
        <p>
          Monitor multi-agent workflows, enforce tool permissions, route risky actions to review, and keep a
          complete audit trail for enterprise AI systems.
        </p>
        <div className="login-proof-strip" aria-label="Product capabilities">
          <span>SDK</span>
          <span>API</span>
          <span>Agent Marketplace</span>
          <span>Tool Marketplace</span>
        </div>
      </section>

      <section className="login-signal" aria-label="Live workflow preview">
        <div className="signal-header">
          <div>
            <span className="eyebrow">Live workflow preview</span>
            <h2>Policy sits between the agent and the tool.</h2>
          </div>
          <div className="signal-live">
            <span />
            Enforcing
          </div>
        </div>

        <div className="runtime-map">
          <div className="runtime-scan" aria-hidden="true" />
          <div className="runtime-lane lane-one" aria-hidden="true">
            <span className="flow-packet packet-one" />
            <span className="flow-packet packet-two" />
          </div>
          <div className="runtime-lane lane-two" aria-hidden="true">
            <span className="flow-packet packet-three" />
          </div>
          <div className="runtime-lane lane-three" aria-hidden="true">
            <span className="flow-packet packet-four" />
          </div>

          <div className="runtime-node node-user">
            <Mail size={18} />
            <span>User Prompt</span>
            <strong>Customer request</strong>
          </div>
          <div className="runtime-node node-lead">
            <Network size={18} />
            <span>Lead Agent</span>
            <strong>Routes workflow</strong>
          </div>
          <div className="runtime-node node-sub node-identity">
            <Layers3 size={17} />
            <span>Identity Agent</span>
            <strong>Verify scope</strong>
          </div>
          <div className="runtime-node node-sub node-transactions">
            <Activity size={17} />
            <span>Transaction Agent</span>
            <strong>Request tool</strong>
          </div>
          <div className="runtime-node node-policy">
            <ShieldCheck size={18} />
            <span>Policy Engine</span>
            <strong>Score + enforce</strong>
          </div>
          <div className="runtime-node node-audit">
            <GitBranch size={18} />
            <span>Audit Trail</span>
            <strong>Postgres log</strong>
          </div>
        </div>

        <div className="decision-stack">
          <div className="decision-row allow">
            <CheckCircle2 size={18} />
            <div>
              <strong>ALLOW</strong>
              <span>Granted tool access, low risk</span>
            </div>
          </div>
          <div className="decision-row review">
            <PauseCircle size={18} />
            <div>
              <strong>REVIEW</strong>
              <span>Human checkpoint for elevated risk</span>
            </div>
          </div>
          <div className="decision-row block">
            <OctagonAlert size={18} />
            <div>
              <strong>BLOCK</strong>
              <span>Denied before sensitive data leaves</span>
            </div>
          </div>
        </div>
      </section>

      <footer className="onboarding-footer" aria-label="Company copyright">
        <span>Intellidata Consulting</span>
        <small>Copyright 2026 Intellidata Consulting. All rights reserved.</small>
      </footer>

      {authMode ? (
        <div className="auth-modal-backdrop" role="dialog" aria-modal="true" aria-label="IntelliGuard access form">
          <section className={`login-panel auth-modal form-open ${authMode === "signup" ? "signup-modal" : "signin-modal"}`}>
            <div className="auth-actions" aria-label="Authentication actions">
              <button
                className={authMode === "signin" ? "selected" : ""}
                type="button"
                onClick={() => {
                  setAuthMode("signin");
                  setError("");
                }}
              >
                Log in
              </button>
              <button
                className={authMode === "signup" ? "selected" : ""}
                type="button"
                onClick={() => {
                  setAuthMode("signup");
                  setError("");
                }}
              >
                Sign up
              </button>
              <button className="auth-close" type="button" onClick={() => setAuthMode(null)} aria-label="Close access form">
                Close
              </button>
            </div>
            <div className="signin-header">
              <span className="eyebrow">Secure access</span>
              <h2>
                {authMode === "signup"
                  ? requiresInitialAdmin
                    ? "Create your IntelliGuard admin"
                    : "Create your IntelliGuard account"
                  : "Log in to IntelliGuard"}
              </h2>
              <p>Open the governance console to review agents, permissions, decisions, and audit trails.</p>
            </div>

          <form className={`login-form ${authMode === "signup" ? "signup-form" : "signin-form"}`} onSubmit={submit}>
            {error ? <div className="error-banner">{error}</div> : null}
            {authMode === "signup" ? (
              <label>
                <span>Full name</span>
                <div className="input-wrap">
                  <ShieldCheck size={17} />
                  <input value={fullName} onChange={(event) => setFullName(event.target.value)} type="text" />
                </div>
              </label>
            ) : null}
            <label>
              <span>Email</span>
              <div className="input-wrap">
                <Mail size={17} />
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
              </div>
            </label>
            <label>
              <span>Password</span>
              <div className="input-wrap">
                <KeyRound size={17} />
                <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
              </div>
            </label>
            <label>
              <span>Role</span>
              <div className="input-wrap">
                <ShieldCheck size={17} />
                <select value={role} onChange={(event) => setRole(event.target.value)}>
                  {activeRoleOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <button className="primary-action" type="submit" disabled={submitting}>
              <LogIn size={18} />
              {submitting
                ? "Checking..."
                : authMode === "signup"
                  ? requiresInitialAdmin
                    ? "Create Admin"
                    : "Create Account"
                  : "Enter Console"}
            </button>
          </form>
            <div className="login-footer">
              <span>IntelliGuard</span>
              <small>Copyright 2026 Intellidata Consulting. All rights reserved.</small>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function LoginLottiePanel({ className = "" }) {
  return (
    <div className={`lottie-panel ${className}`.trim()} aria-label="IntelliGuard animation container">
      <div className="lottie-player-shell" data-lottie-slot="intelliguard-flow">
        <div className="lottie-orbit orbit-a" />
        <div className="lottie-orbit orbit-b" />
        <div className="lottie-core">
          <ShieldCheck size={22} />
          <strong>IntelliGuard</strong>
          <span>Protected workflow</span>
        </div>
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
            "--drift": particle.drift,
            "--delay": `${particle.delay}s`,
            "--depth": `${Math.abs(particle.drift) + 0.35}`,
          }}
        />
      ))}
    </div>
  );
}
