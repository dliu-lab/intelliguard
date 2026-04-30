"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Database,
  FileJson,
  GitBranch,
  KeyRound,
  LockKeyhole,
  LogOut,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  TerminalSquare,
  UploadCloud,
  Wrench,
  X,
} from "lucide-react";
import {
  assignAgentEvaluator,
  assignAgentGuardrail,
  assignAgentKnowledgeBase,
  clearSession,
  createAgent,
  createEvaluatorTemplate,
  createGuardrailPolicy,
  createKnowledgeBase,
  createTool,
  deleteAgentEvaluator,
  deleteAgentGuardrail,
  deleteAgentKnowledgeBase,
  getSession,
  grantAgentTool,
  listAgentEvaluators,
  listAgentGuardrails,
  listAgentKnowledgeBases,
  me,
  platformOverview,
  revokeAgentTool,
  type ApiRecord,
  type AuthUser,
  type PlatformData,
} from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";

type BackendComponentKey =
  | "agents"
  | "tools"
  | "workflows"
  | "guardrails"
  | "evaluators"
  | "knowledge"
  | "reviews"
  | "audit"
  | "environments";

type WorkspaceView = "overview" | "workflows" | "trace" | "control" | "policies" | "reviews" | "audit";

const workspaceViews: Array<{
  id: WorkspaceView;
  label: string;
  title: string;
  description: string;
}> = [
  {
    id: "overview",
    label: "Overview",
    title: "Overview",
    description: "Governed agentic workflow health, runtime decisions, and risk signals.",
  },
  {
    id: "workflows",
    label: "Agentic Workflows",
    title: "Agentic Workflows",
    description: "Build, deploy, and run governed multi-agent workflows across environments.",
  },
  {
    id: "trace",
    label: "Workflow Trace",
    title: "Workflow Trace",
    description: "Inspect agent sessions, delegated steps, tool calls, and policy events.",
  },
  {
    id: "control",
    label: "Control Plane",
    title: "Control Plane",
    description: "Onboard agents, tools, guardrails, evaluators, knowledge bases, and model routing.",
  },
  {
    id: "policies",
    label: "Runtime Policies",
    title: "Runtime Policies",
    description: "Review active runtime rules, thresholds, and enforcement outcomes.",
  },
  {
    id: "reviews",
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

const moduleDefinitions = [
  {
    title: "Control Plane",
    description: "Onboard agents, tools, guardrails, evaluators, knowledge bases, and model routing.",
    icon: ShieldCheck,
    componentKey: "agents" as const,
    metric: (data: PlatformData) => formatCount(data.agents.length, "agent"),
    detail: (data: PlatformData) =>
      `${formatCount(data.tools.length, "tool")}, ${formatCount(data.guardrailPolicies.length, "guardrail")}`,
  },
  {
    title: "Agentic Workflows",
    description: "Build and run governed multi-agent execution flows with runtime evidence.",
    icon: GitBranch,
    componentKey: "workflows" as const,
    metric: (data: PlatformData) => formatCount(data.workflowDefinitions.length, "workflow"),
    detail: (data: PlatformData) =>
      `${formatCount(data.workflows.length, "execution")} and ${formatCount(data.sessions.length, "runtime session")} captured`,
  },
  {
    title: "Runtime Policies",
    description: "Evaluate actions against policy, business rules, thresholds, and approvals.",
    icon: Scale,
    componentKey: "guardrails" as const,
    metric: (data: PlatformData) => formatCount(data.reviewQueue.length, "review"),
    detail: (data: PlatformData) => `${formatCount(data.guardrailPolicies.length, "policy")} available`,
  },
  {
    title: "Audit Evidence",
    description: "Trace prompts, outputs, tool calls, policy decisions, and review outcomes.",
    icon: Activity,
    componentKey: "audit" as const,
    metric: (data: PlatformData) => formatCount(data.auditEvents.length, "event"),
    detail: () => "Live evidence from the audit event stream",
  },
];

const emptyPlatformData: PlatformData = {
  agents: [],
  workflowDefinitions: [],
  workflows: [],
  sessions: [],
  reviewQueue: [],
  auditEvents: [],
  guardrailPolicies: [],
  evaluatorTemplates: [],
  knowledgeBases: [],
  tools: [],
  environments: [],
};

const controlTemplates: Record<"agent" | "tool" | "guardrail" | "evaluator" | "knowledge", ApiRecord> = {
  agent: {
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
      llm: {
        gateway: "litellm",
        endpoint: "/llm/v1",
        model: "ollama/qwen3.5:9b",
        temperature: 0.2,
      },
    },
  },
  tool: {
    tool_name: "summarize_support_case",
    display_name: "Summarize Support Case",
    category: "support_operations",
    description: "Creates a governed summary of a support case for an approved agent.",
    access_model: "grant_required",
    environment: "demo",
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
  },
  guardrail: {
    policy_id: "pol_custom_001",
    display_name: "Custom Policy",
    description: "Policy for governed runtime actions.",
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
  },
  evaluator: {
    evaluator_id: "response-safety-check",
    display_name: "Response Safety Check",
    evaluator_type: "llm_judge",
    scope: "agent",
    description: "Scores responses for safety, grounding, and policy fit.",
    default_config: { pass_threshold: 80 },
    llm_enabled: true,
  },
  knowledge: {
    kb_id: "policy-docs",
    display_name: "Policy Documents",
    description: "Governance policy and operating procedure knowledge base.",
    source_type: "vector_store",
    source_config: {},
    environment: "demo",
  },
};

export default function PlatformPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [data, setData] = useState<PlatformData>(emptyPlatformData);
  const [status, setStatus] = useState<"loading" | "ready" | "public">("loading");
  const [dataStatus, setDataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [dataError, setDataError] = useState<string | null>(null);
  const [activeComponent, setActiveComponent] = useState<BackendComponentKey>("agents");
  const [activeView, setActiveView] = useState<WorkspaceView>("overview");

  useEffect(() => {
    const requestedComponent = new URLSearchParams(window.location.search).get("component");
    if (isBackendComponentKey(requestedComponent)) {
      setActiveComponent(requestedComponent);
      setActiveView(workspaceViewForComponent(requestedComponent));
    } else {
      setActiveView(workspaceViewFromUrl());
    }

    const session = getSession();

    if (!session?.token) {
      setStatus("public");
      return;
    }

    const token = session.token;

    async function loadWorkspace() {
      try {
        const nextUser = await me(token);
        setUser(nextUser);
        setStatus("ready");
        setDataStatus("loading");

        try {
          const nextData = await platformOverview(token);
          setData(nextData);
          setDataError(null);
          setDataStatus("ready");
        } catch (error) {
          setDataError(error instanceof Error ? error.message : "Unable to load platform data");
          setDataStatus("error");
        }
      } catch {
        clearSession();
        setStatus("public");
      }
    }

    loadWorkspace();
  }, []);

  function logout() {
    clearSession();
    window.location.assign("/");
  }

  async function refreshWorkspace() {
    const session = getSession();

    if (!session?.token) {
      setStatus("public");
      return;
    }

    setDataStatus("loading");
    try {
      const nextData = await platformOverview(session.token);
      setData(nextData);
      setDataError(null);
      setDataStatus("ready");
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Unable to load platform data");
      setDataStatus("error");
    }
  }

  function switchWorkspaceView(view: WorkspaceView) {
    setActiveView(view);
    window.history.replaceState(null, "", `/platform/?view=${view}`);
  }

  function openBackendComponent(component: BackendComponentKey) {
    setActiveComponent(component);
    setActiveView(workspaceViewForComponent(component));
    window.history.replaceState(null, "", `/platform/?view=${workspaceViewForComponent(component)}&component=${component}`);
  }

  if (status === "loading") {
    return <PlatformFrame message="Validating workspace session..." />;
  }

  if (status === "public") {
    return <PlatformTransition />;
  }

  return (
    <WorkspaceShell
      activeComponent={activeComponent}
      activeView={activeView}
      data={data}
      dataError={dataError}
      dataStatus={dataStatus}
      onComponentSelect={openBackendComponent}
      onLogout={logout}
      onRefresh={refreshWorkspace}
      onViewSelect={switchWorkspaceView}
      user={user}
    />
  );
}

function WorkspaceShell({
  activeComponent,
  activeView,
  data,
  dataError,
  dataStatus,
  onComponentSelect,
  onLogout,
  onRefresh,
  onViewSelect,
  user,
}: {
  activeComponent: BackendComponentKey;
  activeView: WorkspaceView;
  data: PlatformData;
  dataError: string | null;
  dataStatus: "loading" | "ready" | "error";
  onComponentSelect: (component: BackendComponentKey) => void;
  onLogout: () => void;
  onRefresh: () => void;
  onViewSelect: (view: WorkspaceView) => void;
  user: AuthUser | null;
}) {
  const active = workspaceViews.find((view) => view.id === activeView) || workspaceViews[0];

  return (
    <main className="min-h-screen bg-ink text-textPrimary">
      <div className="app-backdrop pointer-events-none fixed inset-0 -z-20" />
      <div className="grid-overlay pointer-events-none fixed inset-0 -z-10 opacity-60" />

      <div className="grid min-h-screen lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-line bg-ink/82 p-5 backdrop-blur-xl lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col gap-6">
            <a href="/" className="flex items-center gap-3" aria-label="IntelliGuard home">
              <span className="grid h-11 w-11 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent teal-glow">
                <ShieldCheck size={22} aria-hidden="true" />
              </span>
              <span>
                <strong className="block text-base tracking-tight">IntelliGuard</strong>
                <span className="text-xs text-textSecondary">AI governance control plane</span>
              </span>
            </a>

            <nav className="grid gap-2" aria-label="Platform sections">
              {workspaceViews.map((view) => (
                <a
                  key={view.id}
                  href={`/platform/?view=${view.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onViewSelect(view.id);
                  }}
                  className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                    activeView === view.id
                      ? "border-accent/45 bg-accent/10 text-textPrimary shadow-[inset_4px_0_0_var(--color-accent)]"
                      : "border-transparent text-textSecondary hover:border-line hover:bg-white/[0.04] hover:text-textPrimary"
                  }`}
                >
                  {view.label}
                </a>
              ))}
            </nav>

            <div className="mt-auto grid gap-3">
              <div className="rounded-2xl border border-line bg-white/[0.04] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <KeyRound className="text-accent" size={16} aria-hidden="true" />
                  {user?.name || user?.email}
                </div>
                <p className="mt-1 text-xs text-textSecondary">{user?.role}</p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-line bg-white/[0.04] px-4 py-3 text-sm font-semibold transition hover:border-accent/45 hover:bg-accent/10"
              >
                <LogOut size={16} aria-hidden="true" />
                Logout
              </button>
            </div>
          </div>
        </aside>

        <section className="min-w-0 p-5 sm:p-8 lg:p-10">
          <header className="mb-8 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-start">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.28em] text-accent">
                IntelliGuard Platform
              </span>
              <h1 className="mt-2 text-5xl font-semibold leading-none tracking-[-0.04em] text-textPrimary">
                {active.title}
              </h1>
              <p className="mt-3 max-w-3xl text-base leading-7 text-textSecondary">{active.description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-2xl border border-line bg-white/[0.04] px-4 py-3 text-sm">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-textSecondary">
                  Environment
                </span>
                <strong>{data.environments.length ? "All environments" : "Assigned environments"}</strong>
              </div>
              <ThemeToggle />
              <button
                type="button"
                onClick={onRefresh}
                className="grid h-12 w-12 place-items-center rounded-2xl border border-line bg-white/[0.04] transition hover:border-accent/45 hover:bg-accent/10"
                aria-label="Refresh workspace"
              >
                <RefreshCw size={18} aria-hidden="true" />
              </button>
            </div>
          </header>

          {dataStatus === "error" ? (
            <div className="mb-6 rounded-3xl border border-amber-300/30 bg-amber-300/10 p-5 text-sm leading-6 text-amber-100">
              Platform shell is authenticated, but live workspace data could not be loaded: {dataError}
            </div>
          ) : null}

          <WorkspaceViewContent
            activeComponent={activeComponent}
            activeView={activeView}
            data={data}
            dataStatus={dataStatus}
            onComponentSelect={onComponentSelect}
            onRefresh={onRefresh}
            onViewSelect={onViewSelect}
          />
        </section>
      </div>
    </main>
  );
}

function WorkspaceViewContent({
  activeComponent,
  activeView,
  data,
  dataStatus,
  onComponentSelect,
  onRefresh,
  onViewSelect,
}: {
  activeComponent: BackendComponentKey;
  activeView: WorkspaceView;
  data: PlatformData;
  dataStatus: "loading" | "ready" | "error";
  onComponentSelect: (component: BackendComponentKey) => void;
  onRefresh: () => void;
  onViewSelect: (view: WorkspaceView) => void;
}) {
  if (activeView === "overview") {
    return (
      <section className="grid gap-6">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="Live platform metrics">
          <MetricCard label="Workflow Sessions" value={data.sessions.length} loading={dataStatus === "loading"} />
          <MetricCard label="Agents" value={data.agents.length} loading={dataStatus === "loading"} />
          <MetricCard label="Tools" value={data.tools.length} loading={dataStatus === "loading"} />
          <MetricCard label="Open Reviews" value={data.reviewQueue.length} loading={dataStatus === "loading"} />
          <MetricCard label="Audit Events" value={data.auditEvents.length} loading={dataStatus === "loading"} />
          <MetricCard label="Workflows" value={data.workflowDefinitions.length} loading={dataStatus === "loading"} />
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          {moduleDefinitions.map((module) => {
            const Icon = module.icon;

            return (
              <a
                key={module.title}
                href={`/platform/?view=${workspaceViewForComponent(module.componentKey)}&component=${module.componentKey}`}
                onClick={(event) => {
                  event.preventDefault();
                  onComponentSelect(module.componentKey);
                }}
                className="glass-card rounded-3xl p-6 text-left transition hover:border-accent/45 hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
                    <Icon size={22} aria-hidden="true" />
                  </div>
                  <span className="rounded-full border border-line bg-ink/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-accent">
                    {dataStatus === "loading" ? "loading" : "live"}
                  </span>
                </div>
                <h2 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">{module.title}</h2>
                <p className="mt-3 leading-7 text-textSecondary">{module.description}</p>
                <div className="mt-6 rounded-2xl border border-line bg-ink/60 p-4">
                  <p className="text-2xl font-semibold text-textPrimary">
                    {dataStatus === "loading" ? "..." : module.metric(data)}
                  </p>
                  <p className="mt-1 text-sm text-textSecondary">
                    {dataStatus === "loading" ? "Reading from backend" : module.detail(data)}
                  </p>
                </div>
              </a>
            );
          })}
        </div>
      </section>
    );
  }

  if (activeView === "control") {
    return (
      <ControlPlaneWorkspace
        activeComponent={activeComponent}
        data={data}
        dataStatus={dataStatus}
        onRefresh={onRefresh}
        onSelect={onComponentSelect}
      />
    );
  }

  if (activeView === "workflows") {
    return (
      <SectionPanel
        endpoint="/v1/workflow-marketplace + /v1/workflows"
        title="Workflow runs and definitions"
        rows={[
          ...data.workflowDefinitions.map((workflow) => ({
            title: readText(workflow, ["name", "workflow_definition_id"]) || "Workflow definition",
            detail: readText(workflow, ["description", "lead_agent_id"]) || "Saved workflow definition.",
            meta: joinParts([readText(workflow, ["environment"]), readText(workflow, ["owner"])]),
          })),
          ...data.workflows.map((workflow) => ({
            title: readText(workflow, ["workflow_id", "session_id"]) || "Workflow run",
            detail: readText(workflow, ["status", "name", "created_at"]) || "Runtime workflow execution.",
            meta: joinParts([readText(workflow, ["decision"]), readText(workflow, ["session_count"])]),
          })),
        ]}
        emptyText="Build or run a workflow to populate this section."
      />
    );
  }

  if (activeView === "trace") {
    return (
      <SectionPanel
        endpoint="/v1/sessions + /v1/audit-events"
        title="Workflow trace"
        rows={data.sessions.map((session) => ({
          title: readText(session, ["session_id", "agent_id"]) || "Session",
          detail: readText(session, ["user_query", "status", "created_at"]) || "Runtime session from backend.",
          meta: joinParts([readText(session, ["environment"]), readText(session, ["status"])]),
        }))}
        emptyText="Run a governed agent or workflow to create traceable sessions."
      />
    );
  }

  if (activeView === "policies") {
    return (
      <SectionPanel
        endpoint="/v1/guardrail-policies"
        title="Runtime policies"
        rows={data.guardrailPolicies.map((policy) => ({
          title: readText(policy, ["display_name", "policy_id", "name"]) || "Guardrail policy",
          detail: readText(policy, ["description", "mode"]) || "Policy returned by backend.",
          meta: readText(policy, ["environment"]),
        }))}
        emptyText="Create a guardrail policy to populate this section."
      />
    );
  }

  if (activeView === "reviews") {
    return (
      <SectionPanel
        endpoint="/v1/review-queue"
        title="Review queue"
        rows={data.reviewQueue.map((review) => ({
          title: readText(review, ["review_id", "action", "tool_name"]) || "Review item",
          detail: readText(review, ["reason", "agent_id", "session_id"]) || "Human review queue item.",
          meta: readText(review, ["status", "environment"]),
        }))}
        emptyText="No items currently require review."
      />
    );
  }

  return (
    <SectionPanel
      endpoint="/v1/audit-events"
      title="Audit events"
      rows={data.auditEvents.map((event) => ({
        title: readText(event, ["decision", "action", "tool_name", "event_type"]) || "Audit event",
        detail: readText(event, ["reason", "agent_id", "session_id"]) || "Runtime evidence from backend.",
        meta: joinParts([readText(event, ["environment"]), readText(event, ["risk_score"])]),
      }))}
      emptyText="Run governed agents or workflows to populate audit evidence."
    />
  );
}

function SectionPanel({
  emptyText,
  endpoint,
  rows,
  title,
}: {
  emptyText: string;
  endpoint: string;
  rows: Array<{ title: string; detail: string; meta?: string }>;
  title: string;
}) {
  return (
    <section className="glass-card rounded-3xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Backend section</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em]">{title}</h2>
        </div>
        <span className="rounded-full border border-line bg-ink/60 px-4 py-2 text-sm text-textSecondary">
          {endpoint}
        </span>
      </div>

      <div className="mt-6 grid gap-3">
        {rows.length ? (
          rows.slice(0, 12).map((row, index) => (
            <ComponentRow key={`${row.title}-${index}`} title={row.title} detail={row.detail} meta={row.meta} />
          ))
        ) : (
          <ComponentRow title="No records" detail={emptyText} />
        )}
      </div>
    </section>
  );
}

function ControlPlaneWorkspace({
  activeComponent,
  data,
  dataStatus,
  onRefresh,
  onSelect,
}: {
  activeComponent: BackendComponentKey;
  data: PlatformData;
  dataStatus: "loading" | "ready" | "error";
  onRefresh: () => void;
  onSelect: (component: BackendComponentKey) => void;
}) {
  type ControlTab = "agents" | "tools" | "guardrails" | "evaluators" | "knowledge";
  type AgentModalTab = "profile" | "tools" | "guardrails" | "evaluators" | "knowledge";

  const initialTab: ControlTab =
    activeComponent === "tools" ||
    activeComponent === "guardrails" ||
    activeComponent === "evaluators" ||
    activeComponent === "knowledge"
      ? activeComponent
      : "agents";
  const [tab, setTab] = useState<ControlTab>(initialTab);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [modalAgentId, setModalAgentId] = useState<string | null>(null);
  const [modalTab, setModalTab] = useState<AgentModalTab>("profile");
  const [agentSearch, setAgentSearch] = useState("");
  const [showAgentBuilder, setShowAgentBuilder] = useState(false);
  const [message, setMessage] = useState("");
  const [agentJson, setAgentJson] = useState(templateJson("agent"));
  const [toolJson, setToolJson] = useState(templateJson("tool"));
  const [guardrailJson, setGuardrailJson] = useState(templateJson("guardrail"));
  const [evaluatorJson, setEvaluatorJson] = useState(templateJson("evaluator"));
  const [knowledgeJson, setKnowledgeJson] = useState(templateJson("knowledge"));

  useEffect(() => {
    if (!selectedAgentId && data.agents[0]) {
      setSelectedAgentId(String(data.agents[0].agent_id || ""));
    }
  }, [data.agents, selectedAgentId]);

  function selectTab(nextTab: ControlTab) {
    setTab(nextTab);
    onSelect(nextTab);
  }

  async function submitJson(
    event: FormEvent<HTMLFormElement>,
    label: string,
    json: string,
    create: (token: string, payload: ApiRecord) => Promise<ApiRecord>,
  ) {
    event.preventDefault();
    setMessage("");

    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before changing control plane resources.");
      return;
    }

    try {
      const payload = JSON.parse(json) as ApiRecord;
      await create(session.token, payload);
      setMessage(`${label} saved to backend.`);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Unable to save ${label.toLowerCase()}.`);
    }
  }

  const modalAgent = data.agents.find((agent) => String(agent.agent_id || "") === modalAgentId) || null;
  const filteredAgents = data.agents.filter((agent) => {
    const query = agentSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return [
      readText(agent, ["display_name", "agent_id"]),
      readText(agent, ["purpose"]),
      readText(agent, ["owner"]),
      readText(agent, ["environment"]),
      readText(agent, ["agent_type"]),
      ...getAgentTools(agent),
    ].some((item) => item?.toLowerCase().includes(query));
  });

  const controlTabs: Array<{ id: ControlTab; label: string; count?: number }> = [
    { id: "agents", label: "Agents", count: data.agents.length },
    { id: "tools", label: "Tools", count: data.tools.length },
    { id: "guardrails", label: "Guardrails", count: data.guardrailPolicies.length },
    { id: "evaluators", label: "Evaluators", count: data.evaluatorTemplates.length },
    { id: "knowledge", label: "Knowledge", count: data.knowledgeBases.length },
  ];

  return (
    <section className="grid gap-5" data-testid="control-plane-workspace">
      {message ? (
        <div className="rounded-3xl border border-line bg-white/[0.04] p-4 text-sm text-textSecondary">{message}</div>
      ) : null}

      <div className="glass-card overflow-hidden rounded-3xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.01em]">Control Plane</h2>
            <p className="mt-1 text-sm text-textSecondary">
              Onboard agents, tools, guardrails, evaluators, and knowledge bases into governed runtime control.
            </p>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {controlTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                  tab === item.id
                    ? "border-accent/45 bg-accent text-ink"
                    : "border-line bg-white/[0.04] text-textPrimary hover:border-accent/40 hover:bg-accent/10"
                }`}
              >
                {item.label}
                {typeof item.count === "number" ? (
                  <span className={tab === item.id ? "text-ink/70" : "text-textSecondary"}>{item.count}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">
          {tab === "agents" ? (
            <div className="grid gap-5">
              <section>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                      Agent Onboarding
                    </span>
                    <p className="mt-2 text-sm leading-6 text-textSecondary">
                      Register governed agent identities from a template or checked-in JSON contract.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAgentJson(templateJson("agent"));
                      setShowAgentBuilder(true);
                    }}
                    className={`rounded-2xl border p-4 text-left transition hover:border-accent/45 hover:bg-accent/10 ${
                      showAgentBuilder ? "border-accent/45 bg-accent/10" : "border-line bg-white/[0.035]"
                    }`}
                  >
                    <span className="inline-grid h-10 w-10 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                      <FileJson size={18} aria-hidden="true" />
                    </span>
                    <strong className="ml-3 align-middle">Register from Template</strong>
                    <p className="mt-2 text-sm text-textSecondary">Start from a governed agent identity contract.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowAgentBuilder(true)}
                    className="rounded-2xl border border-line bg-white/[0.035] p-4 text-left transition hover:border-accent/45 hover:bg-accent/10"
                  >
                    <span className="inline-grid h-10 w-10 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                      <UploadCloud size={18} aria-hidden="true" />
                    </span>
                    <strong className="ml-3 align-middle">Import JSON</strong>
                    <p className="mt-2 text-sm text-textSecondary">Paste an existing agent contract into the editor.</p>
                  </button>
                </div>

                {showAgentBuilder ? (
                  <div className="mt-5">
                    <JsonBuilder
                      endpoint="/v1/agents"
                      json={agentJson}
                      onChange={setAgentJson}
                      onReset={() => setAgentJson(templateJson("agent"))}
                      onSubmit={(event) => submitJson(event, "Agent", agentJson, createAgent)}
                      submitLabel="Register Agent"
                      title="Agent registration"
                    />
                  </div>
                ) : null}
              </section>

              <section className="border-t border-line pt-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                      Agent Harness
                    </span>
                    <p className="mt-2 text-sm leading-6 text-textSecondary">
                      Select an identity, then govern tool access, guardrails, evaluators, and knowledge access.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm text-textSecondary">
                    <span className="rounded-xl border border-line bg-ink/60 px-3 py-2">
                      <strong className="text-textPrimary">{data.agents.length}</strong> agents
                    </span>
                    <span className="rounded-xl border border-line bg-ink/60 px-3 py-2">
                      <strong className="text-textPrimary">{countUnique(data.agents, "environment")}</strong>{" "}
                      environments
                    </span>
                    <span className="rounded-xl border border-line bg-ink/60 px-3 py-2">
                      <strong className="text-textPrimary">{sumAgentToolGrants(data.agents)}</strong> tool grants
                    </span>
                  </div>
                </div>

                <label className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-ink/65 px-4 py-3 text-sm text-textSecondary">
                  <Search size={17} aria-hidden="true" />
                  <input
                    className="w-full bg-transparent text-textPrimary outline-none placeholder:text-textSecondary"
                    placeholder="Search agents..."
                    value={agentSearch}
                    onChange={(event) => setAgentSearch(event.target.value)}
                  />
                </label>

                <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {filteredAgents.map((agent) => {
                    const toolCount = getAgentTools(agent).length;

                    return (
                      <article
                        key={String(agent.agent_id)}
                        className={`rounded-2xl border bg-white/[0.035] p-4 transition ${
                          selectedAgentId === String(agent.agent_id)
                            ? "border-accent/55 bg-accent/10"
                            : "border-line hover:border-accent/35"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            aria-label={`Open ${readText(agent, ["display_name", "agent_id"]) || "agent"} profile`}
                            onClick={() => {
                              setSelectedAgentId(String(agent.agent_id || ""));
                              setModalAgentId(String(agent.agent_id || ""));
                              setModalTab("profile");
                            }}
                          >
                            <div className="flex items-start gap-3">
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
                                <Bot size={17} aria-hidden="true" />
                              </span>
                              <span className="min-w-0">
                                <strong className="block truncate text-textPrimary">
                                  {readText(agent, ["display_name", "agent_id"])}
                                </strong>
                                <span className="block truncate text-xs text-textSecondary">
                                  {readText(agent, ["agent_id"])}
                                </span>
                              </span>
                            </div>
                            <p className="mt-4 line-clamp-2 text-sm leading-6 text-textSecondary">
                              {readText(agent, ["purpose"]) || "Governed agent identity."}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAgentId(String(agent.agent_id || ""));
                              setModalAgentId(String(agent.agent_id || ""));
                              setModalTab("profile");
                            }}
                            className="grid h-8 w-8 place-items-center rounded-xl border border-line bg-ink/60 text-textSecondary transition hover:border-accent/45 hover:text-textPrimary"
                            aria-label={`Open ${readText(agent, ["display_name", "agent_id"]) || "agent"}`}
                          >
                            <MoreHorizontal size={17} aria-hidden="true" />
                          </button>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2 text-xs text-textSecondary">
                          <span className="rounded-full border border-line bg-ink/60 px-2.5 py-1">Registered</span>
                          {readText(agent, ["owner"]) ? (
                            <span className="rounded-full border border-line bg-ink/60 px-2.5 py-1">
                              {readText(agent, ["owner"])}
                            </span>
                          ) : null}
                          {readText(agent, ["environment"]) ? (
                            <span className="rounded-full border border-line bg-ink/60 px-2.5 py-1">
                              {readText(agent, ["environment"])}
                            </span>
                          ) : null}
                          {readText(agent, ["agent_type"]) ? (
                            <span className="rounded-full border border-line bg-ink/60 px-2.5 py-1">
                              {readText(agent, ["agent_type"])}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-3 w-fit rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                          {formatCount(toolCount, "tool")}
                        </div>
                      </article>
                    );
                  })}
                  {!filteredAgents.length ? (
                    <ComponentRow title="No agents found" detail="Adjust the search or register a new agent." />
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}

          {tab === "tools" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <JsonBuilder
                endpoint="/v1/tool-marketplace"
                json={toolJson}
                onChange={setToolJson}
                onReset={() => setToolJson(templateJson("tool"))}
                onSubmit={(event) => submitJson(event, "Tool", toolJson, createTool)}
                submitLabel="Register Tool"
                title="Tool contract"
              />
              <ResourceGrid
                emptyText="No tools registered."
                rows={data.tools.map((tool) => ({
                  title: readText(tool, ["display_name", "tool_name", "name"]) || "Unnamed tool",
                  detail: readText(tool, ["description", "category"]) || "Tool marketplace record.",
                  meta: joinParts([readText(tool, ["category"]), readText(tool, ["environment"])]),
                }))}
              />
            </div>
          ) : null}

          {tab === "guardrails" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <JsonBuilder
                endpoint="/v1/guardrail-policies"
                json={guardrailJson}
                onChange={setGuardrailJson}
                onReset={() => setGuardrailJson(templateJson("guardrail"))}
                onSubmit={(event) => submitJson(event, "Guardrail", guardrailJson, createGuardrailPolicy)}
                submitLabel="Register Guardrail"
                title="Guardrail contract"
              />
              <ResourceGrid
                emptyText="No guardrails registered."
                rows={data.guardrailPolicies.map((policy) => ({
                  title: readText(policy, ["display_name", "policy_id", "name"]) || "Unnamed guardrail",
                  detail: readText(policy, ["description", "mode"]) || "Guardrail policy from backend.",
                  meta: readText(policy, ["environment"]),
                }))}
              />
            </div>
          ) : null}

          {tab === "evaluators" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <JsonBuilder
                endpoint="/v1/evaluator-templates"
                json={evaluatorJson}
                onChange={setEvaluatorJson}
                onReset={() => setEvaluatorJson(templateJson("evaluator"))}
                onSubmit={(event) => submitJson(event, "Evaluator", evaluatorJson, createEvaluatorTemplate)}
                submitLabel="Register Evaluator"
                title="Evaluator template"
              />
              <ResourceGrid
                emptyText="No evaluators registered."
                rows={data.evaluatorTemplates.map((evaluator) => ({
                  title: readText(evaluator, ["display_name", "evaluator_id"]) || "Unnamed evaluator",
                  detail: readText(evaluator, ["description", "evaluator_type"]) || "Evaluator template from backend.",
                  meta: joinParts([readText(evaluator, ["scope"]), readText(evaluator, ["evaluator_type"])]),
                }))}
              />
            </div>
          ) : null}

          {tab === "knowledge" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <JsonBuilder
                endpoint="/v1/knowledge-bases"
                json={knowledgeJson}
                onChange={setKnowledgeJson}
                onReset={() => setKnowledgeJson(templateJson("knowledge"))}
                onSubmit={(event) => submitJson(event, "Knowledge base", knowledgeJson, createKnowledgeBase)}
                submitLabel="Onboard KB"
                title="Knowledge base"
              />
              <ResourceGrid
                emptyText="No knowledge bases registered."
                rows={data.knowledgeBases.map((kb) => ({
                  title: readText(kb, ["display_name", "kb_id"]) || "Unnamed knowledge base",
                  detail: readText(kb, ["description", "source_type"]) || "Knowledge base from backend.",
                  meta: joinParts([readText(kb, ["environment"]), readText(kb, ["source_type"])]),
                }))}
              />
            </div>
          ) : null}
        </div>
      </div>

      {modalAgent ? (
        <SelectedAgentModal
          agent={modalAgent}
          guardrailPolicies={data.guardrailPolicies}
          knowledgeBases={data.knowledgeBases}
          evaluatorTemplates={data.evaluatorTemplates}
          modalTab={modalTab}
          onClose={() => setModalAgentId(null)}
          onRefresh={onRefresh}
          onTabChange={setModalTab}
          tools={data.tools}
        />
      ) : null}
    </section>
  );
}

function SelectedAgentModal({
  agent,
  evaluatorTemplates,
  guardrailPolicies,
  knowledgeBases,
  modalTab,
  onClose,
  onRefresh,
  onTabChange,
  tools,
}: {
  agent: ApiRecord;
  evaluatorTemplates: ApiRecord[];
  guardrailPolicies: ApiRecord[];
  knowledgeBases: ApiRecord[];
  modalTab: "profile" | "tools" | "guardrails" | "evaluators" | "knowledge";
  onClose: () => void;
  onRefresh: () => void;
  onTabChange: (tab: "profile" | "tools" | "guardrails" | "evaluators" | "knowledge") => void;
  tools: ApiRecord[];
}) {
  const [form, setForm] = useState(() => agentProfileForm(agent));
  const [message, setMessage] = useState("");
  const agentTools = getAgentTools(agent);

  useEffect(() => {
    setForm(agentProfileForm(agent));
    setMessage("");
  }, [agent]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before saving.");
      return;
    }

    try {
      await createAgent(session.token, {
        ...agent,
        display_name: form.display_name,
        owner: form.owner,
        environment: form.environment,
        agent_type: form.agent_type,
        purpose: form.purpose,
      });
      setMessage("Profile saved.");
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save profile.");
    }
  }

  const tabs = [
    { id: "profile" as const, label: "Profile", icon: Bot, count: undefined },
    { id: "tools" as const, label: "Tools", icon: Wrench, count: agentTools.length },
    { id: "guardrails" as const, label: "Guardrails", icon: ShieldCheck, count: guardrailPolicies.length },
    { id: "evaluators" as const, label: "Evaluators", icon: CheckCircle2, count: evaluatorTemplates.length },
    { id: "knowledge" as const, label: "Knowledge", icon: Database, count: knowledgeBases.length },
  ];

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      data-testid="selected-agent-modal"
    >
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-line bg-ink text-textPrimary shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">Selected Agent</span>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
              {readText(agent, ["display_name", "agent_id"])}
            </h2>
            <p className="text-sm text-textSecondary">{readText(agent, ["agent_id"])}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1 text-xs text-textSecondary">
              {readText(agent, ["environment"])}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-white/[0.04] transition hover:border-accent/45 hover:bg-accent/10"
              aria-label="Close selected agent"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="grid max-h-[calc(92vh-92px)] overflow-auto p-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="border-b border-line pb-5 lg:border-b-0 lg:border-r lg:pr-5">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onTabChange(tab.id)}
                    className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                      modalTab === tab.id
                        ? "border-accent/45 bg-accent text-ink"
                        : "border-line bg-white/[0.04] text-textPrimary hover:border-accent/45 hover:bg-accent/10"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Icon size={15} aria-hidden="true" />
                      {tab.label}
                    </span>
                    {typeof tab.count === "number" ? (
                      <span className={modalTab === tab.id ? "text-ink/70" : "text-textSecondary"}>{tab.count}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="pt-5 lg:pl-5 lg:pt-0">
            {modalTab === "profile" ? (
              <form className="grid gap-4" onSubmit={saveProfile}>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
                    Agent ID
                    <input className="rounded-2xl border border-line bg-white/[0.04] px-4 py-3 text-sm normal-case tracking-normal text-textPrimary" value={form.agent_id} readOnly />
                  </label>
                  <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
                    Display Name
                    <input className="rounded-2xl border border-line bg-white/[0.04] px-4 py-3 text-sm normal-case tracking-normal text-textPrimary" value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} />
                  </label>
                  <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
                    Owner
                    <input className="rounded-2xl border border-line bg-white/[0.04] px-4 py-3 text-sm normal-case tracking-normal text-textPrimary" value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} />
                  </label>
                  <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
                    Environment
                    <input className="rounded-2xl border border-line bg-white/[0.04] px-4 py-3 text-sm normal-case tracking-normal text-textPrimary" value={form.environment} onChange={(event) => setForm({ ...form, environment: event.target.value })} />
                  </label>
                  <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
                    Agent Type
                    <input className="rounded-2xl border border-line bg-white/[0.04] px-4 py-3 text-sm normal-case tracking-normal text-textPrimary" value={form.agent_type} onChange={(event) => setForm({ ...form, agent_type: event.target.value })} />
                  </label>
                  <InfoTile label="Model" value={readNestedText(agent, ["metadata", "llm", "model"]) || "ollama/qwen3.5:9b"} />
                </div>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
                  Purpose
                  <textarea className="min-h-28 rounded-2xl border border-line bg-white/[0.04] px-4 py-3 text-sm normal-case tracking-normal text-textPrimary" value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="submit" className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90">
                    Save Profile
                  </button>
                  {message ? <span className="text-sm text-textSecondary">{message}</span> : null}
                </div>
              </form>
            ) : null}

            {modalTab === "tools" ? (
              <ResourceGrid
                emptyText="No tools are attached to this agent."
                rows={(agentTools.length ? agentTools : tools.map((tool) => readText(tool, ["display_name", "tool_name"]) || "Tool")).map((tool) => ({
                  title: tool,
                  detail: agentTools.includes(tool) ? "Attached to this agent." : "Available in the tool marketplace.",
                  meta: agentTools.includes(tool) ? "attached" : "available",
                }))}
              />
            ) : null}

            {modalTab === "guardrails" ? (
              <ResourceGrid
                emptyText="No guardrails are available."
                rows={guardrailPolicies.map((policy) => ({
                  title: readText(policy, ["display_name", "policy_id"]) || "Guardrail",
                  detail: readText(policy, ["description"]) || "Available runtime guardrail.",
                  meta: readText(policy, ["environment"]),
                }))}
              />
            ) : null}

            {modalTab === "evaluators" ? (
              <ResourceGrid
                emptyText="No evaluator templates are available."
                rows={evaluatorTemplates.map((evaluator) => ({
                  title: readText(evaluator, ["display_name", "evaluator_id"]) || "Evaluator",
                  detail: readText(evaluator, ["description", "evaluator_type"]) || "Available evaluator template.",
                  meta: joinParts([readText(evaluator, ["scope"]), readText(evaluator, ["evaluator_type"])]),
                }))}
              />
            ) : null}

            {modalTab === "knowledge" ? (
              <ResourceGrid
                emptyText="No knowledge bases are available."
                rows={knowledgeBases.map((kb) => ({
                  title: readText(kb, ["display_name", "kb_id"]) || "Knowledge base",
                  detail: readText(kb, ["description", "source_type"]) || "Available knowledge base.",
                  meta: joinParts([readText(kb, ["environment"]), readText(kb, ["source_type"])]),
                }))}
              />
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function JsonBuilder({
  endpoint,
  json,
  onChange,
  onReset,
  onSubmit,
  submitLabel,
  title,
}: {
  endpoint: string;
  json: string;
  onChange: (value: string) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  title: string;
}) {
  return (
    <form className="glass-card rounded-3xl p-5" onSubmit={onSubmit}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{endpoint}</span>
          <h3 className="mt-3 text-xl font-semibold">{title}</h3>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-line bg-white/[0.04] px-4 py-2 text-sm font-semibold transition hover:border-accent/40 hover:bg-accent/10"
        >
          Use Template
        </button>
      </div>
      <textarea
        className="mt-5 min-h-[360px] w-full resize-y rounded-2xl border border-line bg-ink/80 p-4 font-mono text-xs leading-6 text-textPrimary outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
        spellCheck={false}
        value={json}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="submit"
        className="mt-4 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90"
      >
        {submitLabel}
      </button>
    </form>
  );
}

function ResourceGrid({
  emptyText,
  rows,
}: {
  emptyText: string;
  rows: Array<{ title: string; detail: string; meta?: string }>;
}) {
  return (
    <section className="glass-card rounded-3xl p-5">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Registered resources</span>
      <div className="mt-5 grid gap-3">
        {rows.length ? (
          rows.map((row, index) => (
            <ComponentRow key={`${row.title}-${index}`} title={row.title} detail={row.detail} meta={row.meta} />
          ))
        ) : (
          <ComponentRow title="No records" detail={emptyText} />
        )}
      </div>
    </section>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
      <p className="text-xs text-textSecondary">{label}</p>
      <p className="mt-1 font-semibold text-textPrimary">{value}</p>
    </div>
  );
}

function BackendComponentExplorer({
  activeComponent,
  data,
  dataStatus,
  onSelect,
}: {
  activeComponent: BackendComponentKey;
  data: PlatformData;
  dataStatus: "loading" | "ready" | "error";
  onSelect: (component: BackendComponentKey) => void;
}) {
  const components = buildBackendComponents(data);
  const active = components.find((component) => component.key === activeComponent) || components[0];
  const Icon = active.icon;

  return (
    <section id="backend-components" className="glass-card mt-12 rounded-3xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Backend components</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em]">Open the live platform surface.</h2>
          <p className="mt-3 max-w-3xl leading-7 text-textSecondary">
            These views are populated from the authenticated FastAPI endpoints, so clicking a component switches to the
            corresponding backend-backed surface.
          </p>
        </div>
        <div className="rounded-full border border-line bg-ink/60 px-4 py-2 text-sm text-textSecondary">
          {dataStatus === "loading" ? "Syncing backend" : active.endpoint}
        </div>
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-2">
        {components.map((component) => {
          const ComponentIcon = component.icon;
          const selected = component.key === active.key;

          return (
            <a
              key={component.key}
              href={`/platform/?view=${workspaceViewForComponent(component.key)}&component=${component.key}`}
              onClick={(event) => {
                event.preventDefault();
                onSelect(component.key);
              }}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                selected
                  ? "border-accent/45 bg-accent text-ink"
                  : "border-line bg-white/[0.04] text-textPrimary hover:border-accent/40 hover:bg-accent/10"
              }`}
            >
              <ComponentIcon size={15} aria-hidden="true" />
              {component.label}
              <span className={selected ? "text-ink/70" : "text-textSecondary"}>{component.rows.length}</span>
            </a>
          );
        })}
      </div>

      <div className="mt-6 rounded-3xl border border-line bg-ink/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
              <Icon size={21} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-xl font-semibold">{active.label}</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-textSecondary">{active.description}</p>
            </div>
          </div>
          <span className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            {dataStatus === "loading" ? "loading" : "backend linked"}
          </span>
        </div>

        <div className="mt-5 grid gap-3">
          {dataStatus === "loading" ? (
            <ComponentRow title="Loading backend component" detail="Reading live records from FastAPI." />
          ) : active.rows.length ? (
            active.rows.slice(0, 8).map((row, index) => (
              <ComponentRow
                key={`${active.key}-${row.title}-${index}`}
                title={row.title}
                detail={row.detail}
                meta={row.meta}
              />
            ))
          ) : (
            <ComponentRow title={`No ${active.label.toLowerCase()} yet`} detail={active.emptyText} />
          )}
        </div>
      </div>
    </section>
  );
}

function ComponentRow({ title, detail, meta }: { title: string; detail: string; meta?: string }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-white/[0.035] p-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <p className="font-semibold text-textPrimary">{title}</p>
        <p className="mt-1 text-sm leading-6 text-textSecondary">{detail}</p>
      </div>
      {meta ? (
        <span className="w-fit rounded-full border border-line bg-ink/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
          {meta}
        </span>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <div className="rounded-3xl border border-line bg-white/[0.04] p-5 backdrop-blur">
      <p className="text-sm text-textSecondary">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-textPrimary">
        {loading ? "..." : value}
      </p>
    </div>
  );
}

function ActivityRow({ title, detail, meta }: { title: string; detail: string; meta?: string }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-ink/60 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <p className="font-semibold text-textPrimary">{title}</p>
        <p className="mt-1 text-sm leading-6 text-textSecondary">{detail}</p>
      </div>
      {meta ? (
        <span className="w-fit rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          {meta}
        </span>
      ) : null}
    </div>
  );
}

function readText(record: ApiRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }

  return undefined;
}

function buildBackendComponents(data: PlatformData) {
  return [
    {
      key: "agents" as const,
      label: "Agents",
      endpoint: "/v1/agents",
      description: "Agent identities, owners, environments, permissions, and attached runtime context.",
      emptyText: "Create or onboard an agent and it will appear from /v1/agents.",
      icon: Bot,
      rows: data.agents.map((agent) => ({
        title: readText(agent, ["display_name", "agent_id", "name"]) || "Unnamed agent",
        detail: readText(agent, ["purpose", "agent_type", "description"]) || "Agent identity from backend.",
        meta: joinParts([readText(agent, ["environment"]), readText(agent, ["owner"])]),
      })),
    },
    {
      key: "tools" as const,
      label: "Tools",
      endpoint: "/v1/tool-marketplace",
      description: "Tool marketplace entries exposed to agents through grants and RBAC.",
      emptyText: "Register a tool and it will appear from /v1/tool-marketplace.",
      icon: TerminalSquare,
      rows: data.tools.map((tool) => ({
        title: readText(tool, ["display_name", "tool_name", "name"]) || "Unnamed tool",
        detail: readText(tool, ["description", "category", "access_model"]) || "Tool record from backend.",
        meta: joinParts([readText(tool, ["category"]), readText(tool, ["environment"])]),
      })),
    },
    {
      key: "workflows" as const,
      label: "Workflows",
      endpoint: "/v1/workflow-marketplace + /v1/workflows",
      description: "Workflow definitions and captured executions across the agentic execution plane.",
      emptyText: "Create a workflow definition or run a workflow to populate this component.",
      icon: GitBranch,
      rows: [
        ...data.workflowDefinitions.map((workflow) => ({
          title: readText(workflow, ["name", "workflow_definition_id", "workflow_id"]) || "Unnamed workflow",
          detail: readText(workflow, ["description", "trigger_type", "lead_agent_id"]) || "Workflow definition.",
          meta: joinParts([readText(workflow, ["environment"]), readText(workflow, ["owner"])]),
        })),
        ...data.workflows.map((workflow) => ({
          title: readText(workflow, ["workflow_id", "session_id", "name"]) || "Workflow execution",
          detail: readText(workflow, ["status", "lead_agent_id", "created_at"]) || "Runtime workflow execution.",
          meta: joinParts([readText(workflow, ["environment"]), readText(workflow, ["status"])]),
        })),
      ],
    },
    {
      key: "guardrails" as const,
      label: "Guardrails",
      endpoint: "/v1/guardrail-policies",
      description: "Runtime policy controls available for attachment to agents and workflows.",
      emptyText: "Add a guardrail policy and it will appear from /v1/guardrail-policies.",
      icon: Scale,
      rows: data.guardrailPolicies.map((policy) => ({
        title: readText(policy, ["display_name", "policy_id", "name"]) || "Unnamed guardrail",
        detail: readText(policy, ["description", "mode"]) || "Guardrail policy from backend.",
        meta: readText(policy, ["environment"]),
      })),
    },
    {
      key: "reviews" as const,
      label: "Reviews",
      endpoint: "/v1/review-queue",
      description: "Human approval and escalation queue for actions that require review.",
      emptyText: "Blocked or review-only actions will appear from /v1/review-queue.",
      icon: CheckCircle2,
      rows: data.reviewQueue.map((review) => ({
        title: readText(review, ["review_id", "action", "tool_name"]) || "Review item",
        detail: readText(review, ["reason", "agent_id", "session_id"]) || "Review queue item from backend.",
        meta: readText(review, ["status", "environment"]),
      })),
    },
    {
      key: "audit" as const,
      label: "Audit",
      endpoint: "/v1/audit-events",
      description: "Immutable runtime evidence across prompts, outputs, tools, decisions, and approvals.",
      emptyText: "Run governed agents or workflows to populate /v1/audit-events.",
      icon: Activity,
      rows: data.auditEvents.map((event) => ({
        title: readText(event, ["decision", "action", "tool_name", "event_type"]) || "Audit event",
        detail: readText(event, ["reason", "agent_id", "session_id"]) || "Audit evidence from backend.",
        meta: joinParts([readText(event, ["environment"]), readText(event, ["risk_score"])]),
      })),
    },
    {
      key: "environments" as const,
      label: "Environments",
      endpoint: "/v1/environments",
      description: "RBAC-scoped environments available to the current workspace session.",
      emptyText: "No environments are assigned to this session.",
      icon: Database,
      rows: data.environments.map((environment) => ({
        title: environment,
        detail: "Environment returned by the backend for this user session.",
        meta: "RBAC scope",
      })),
    },
  ];
}

function joinParts(parts: Array<string | undefined>) {
  const value = parts.filter(Boolean).join(" / ");
  return value || undefined;
}

function templateJson(kind: keyof typeof controlTemplates) {
  return JSON.stringify(controlTemplates[kind], null, 2);
}

function agentProfileForm(agent: ApiRecord) {
  return {
    agent_id: readText(agent, ["agent_id"]) || "",
    display_name: readText(agent, ["display_name"]) || "",
    owner: readText(agent, ["owner"]) || "",
    environment: readText(agent, ["environment"]) || "",
    agent_type: readText(agent, ["agent_type"]) || "",
    purpose: readText(agent, ["purpose"]) || "",
  };
}

function getAgentTools(agent: ApiRecord) {
  const permissions = agent.permissions;

  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
    return [];
  }

  const tools = (permissions as Record<string, unknown>).tools;
  return Array.isArray(tools) ? tools.map(String) : [];
}

function sumAgentToolGrants(agents: ApiRecord[]) {
  return agents.reduce((total, agent) => total + getAgentTools(agent).length, 0);
}

function countUnique(records: ApiRecord[], key: string) {
  return new Set(records.map((record) => readText(record, [key])).filter(Boolean)).size;
}

function readNestedText(record: ApiRecord, path: string[]) {
  let current: unknown = record;

  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") {
    return String(current);
  }

  return undefined;
}

function isBackendComponentKey(value: string | null): value is BackendComponentKey {
  return (
    value === "agents" ||
    value === "tools" ||
    value === "workflows" ||
    value === "guardrails" ||
    value === "evaluators" ||
    value === "knowledge" ||
    value === "reviews" ||
    value === "audit" ||
    value === "environments"
  );
}

function isWorkspaceView(value: string | null): value is WorkspaceView {
  return (
    value === "overview" ||
    value === "workflows" ||
    value === "trace" ||
    value === "control" ||
    value === "policies" ||
    value === "reviews" ||
    value === "audit"
  );
}

function workspaceViewFromUrl(): WorkspaceView {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (isWorkspaceView(view)) {
    return view;
  }

  const hash = window.location.hash.replace("#", "");
  if (isWorkspaceView(hash)) {
    return hash;
  }

  return "overview";
}

function workspaceViewForComponent(component: BackendComponentKey): WorkspaceView {
  if (component === "workflows") {
    return "workflows";
  }

  if (component === "guardrails") {
    return "policies";
  }

  if (component === "evaluators" || component === "knowledge") {
    return "control";
  }

  if (component === "reviews") {
    return "reviews";
  }

  if (component === "audit") {
    return "audit";
  }

  return "control";
}

function formatCount(value: number, label: string) {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

function PlatformTransition() {
  const platformLayers = [
    {
      title: "Control Plane",
      description: "Policy, RBAC, risk scoring, approval paths, and audit evidence.",
      icon: ShieldCheck,
    },
    {
      title: "Execution Plane",
      description: "Agentic workflows, tools, APIs, LLM gateway, and deployment paths.",
      icon: GitBranch,
    },
    {
      title: "Runtime Evidence",
      description: "Traces across prompts, tool calls, model decisions, reviews, and outcomes.",
      icon: Activity,
    },
  ];

  const orbitNodes = [
    { label: "Agents", icon: Bot, className: "left-[6%] top-[18%]" },
    { label: "Tools", icon: TerminalSquare, className: "right-[8%] top-[20%]" },
    { label: "RBAC", icon: LockKeyhole, className: "left-[12%] bottom-[17%]" },
    { label: "LLM Gateway", icon: Network, className: "right-[4%] bottom-[22%]" },
    { label: "Data Sources", icon: Database, className: "left-1/2 top-[4%] -translate-x-1/2" },
  ];

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-ink text-textPrimary">
      <div className="app-backdrop pointer-events-none fixed inset-0 -z-30" />
      <div className="grid-overlay pointer-events-none fixed inset-0 -z-20 opacity-60" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_28%,rgba(0,200,150,0.24),transparent_34%),radial-gradient(circle_at_16%_10%,rgba(0,200,150,0.16),transparent_28%)]" />

      <header className="border-b border-line bg-ink/75 backdrop-blur-xl">
        <nav className="section-shell flex min-h-16 flex-wrap items-center justify-between gap-4 py-4">
          <a href="/" className="flex items-center gap-3" aria-label="IntelliGuard home">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent teal-glow">
              <ShieldCheck size={19} aria-hidden="true" />
            </span>
            <span className="text-base font-semibold tracking-tight">IntelliGuard</span>
          </a>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <a
              href="/?auth=login"
              className="hidden rounded-full border border-line bg-white/[0.04] px-4 py-2 text-sm font-semibold text-textPrimary transition hover:border-accent/45 hover:bg-accent/10 sm:inline-flex"
            >
              Login
            </a>
            <a
              href="/?auth=signup"
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90"
            >
              Try IntelliGuard
            </a>
          </div>
        </nav>
      </header>

      <section className="section-shell grid min-h-[calc(100vh-4rem)] items-center gap-12 py-16 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.28em] text-accent">Platform transition</span>
          <h1 className="mt-5 text-5xl font-semibold leading-[0.95] tracking-[-0.04em] text-textPrimary sm:text-6xl">
            From AI idea to governed runtime.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-textSecondary">
            IntelliGuard brings the public product story into the actual platform: design agents, connect tools and
            models, deploy workflows, and govern every runtime action through one control plane.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a
              href="/?auth=signup"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/60"
            >
              Enter workspace
              <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a
              href="/#governance"
              className="inline-flex items-center justify-center rounded-full border border-line bg-white/[0.04] px-6 py-3 text-sm font-semibold text-textPrimary transition hover:border-accent/50 hover:bg-accent/10"
            >
              View architecture
            </a>
          </div>
        </div>

        <div className="glass-card relative min-h-[560px] overflow-hidden rounded-[32px] p-5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(0,200,150,0.22),transparent_34%)]" />
          <div className="absolute left-1/2 top-1/2 h-[68%] w-[68%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/20" />
          <div className="absolute left-1/2 top-1/2 h-[48%] w-[48%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line" />

          {orbitNodes.map((node) => {
            const Icon = node.icon;

            return (
              <div
                key={node.label}
                className={`absolute z-10 flex items-center gap-2 rounded-full border border-line bg-ink/75 px-3 py-2 text-xs font-semibold text-textPrimary backdrop-blur ${node.className}`}
              >
                <Icon className="text-accent" size={15} aria-hidden="true" />
                {node.label}
              </div>
            );
          })}

          <div className="relative z-20 grid h-full min-h-[520px] place-items-center">
            <div className="w-full max-w-sm rounded-[28px] border border-accent/25 bg-ink/80 p-5 text-center shadow-[0_0_80px_rgba(0,200,150,0.18)] backdrop-blur-xl">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-accent/35 bg-accent/10 text-accent teal-glow">
                <ShieldCheck size={30} aria-hidden="true" />
              </div>
              <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">IntelliGuard Platform</h2>
              <p className="mt-3 text-sm leading-6 text-textSecondary">
                Control plane, workflow builder, deployment surface, and runtime evidence layer.
              </p>
              <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-2/5 animate-[pulse_2.6s_ease-in-out_infinite] rounded-full bg-accent shadow-[0_0_24px_rgba(0,200,150,0.7)]" />
              </div>
            </div>
          </div>

          <div className="relative z-20 grid gap-3 md:grid-cols-3">
            {platformLayers.map((layer) => {
              const Icon = layer.icon;

              return (
                <article key={layer.title} className="rounded-2xl border border-line bg-ink/70 p-4 backdrop-blur">
                  <Icon className="text-accent" size={20} aria-hidden="true" />
                  <h3 className="mt-3 font-semibold text-textPrimary">{layer.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-textSecondary">{layer.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}

function PlatformFrame({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-ink px-4 text-textPrimary">
      <div className="glass-card grid w-full max-w-xl place-items-center rounded-3xl p-8 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent teal-glow">
          <ShieldCheck size={24} aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-[-0.03em]">{message}</h1>
        {children}
      </div>
    </main>
  );
}
