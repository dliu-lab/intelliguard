import type { PlatformData } from "@/lib/api";
import type { BackendComponentKey, DataStatus } from "./types";
import { formatCount, workspaceViewForComponent } from "./utils";

const moduleDefinitions = [
  {
    title: "Control Plane",
    description: "Register platform resources.",
    componentKey: "agents" as const,
    metric: (data: PlatformData) => formatCount(data.agents.length, "agent"),
    detail: (data: PlatformData) =>
      `${formatCount(data.tools.length, "tool")}, ${formatCount(data.guardrailPolicies.length, "guardrail")}`,
    tone: "border-emerald-300/28 bg-[radial-gradient(circle_at_14%_0%,rgba(16,185,129,0.24),transparent_34%),linear-gradient(135deg,rgba(16,185,129,0.11),rgba(255,255,255,0.035)_46%,rgba(20,184,166,0.08))]",
    edge: "from-emerald-300/80 via-teal-300/50 to-transparent",
    metricTone: "bg-emerald-300/10 text-emerald-100",
  },
  {
    title: "Agentic Workflows",
    description: "Build and run multi-agent flows.",
    componentKey: "workflows" as const,
    metric: (data: PlatformData) => formatCount(data.workflowDefinitions.length, "workflow"),
    detail: (data: PlatformData) =>
      `${formatCount(data.workflows.length, "execution")}, ${formatCount(data.sessions.length, "session")}`,
    tone: "border-sky-300/26 bg-[radial-gradient(circle_at_82%_0%,rgba(56,189,248,0.22),transparent_32%),linear-gradient(135deg,rgba(56,189,248,0.09),rgba(255,255,255,0.035)_48%,rgba(34,211,238,0.08))]",
    edge: "from-sky-300/75 via-cyan-300/45 to-transparent",
    metricTone: "bg-sky-300/10 text-sky-100",
  },
  {
    title: "Runtime Policies",
    description: "Evaluate runtime actions.",
    componentKey: "guardrails" as const,
    metric: (data: PlatformData) => formatCount(data.reviewQueue.length, "review"),
    detail: (data: PlatformData) => `${formatCount(data.guardrailPolicies.length, "policy")} available`,
    tone: "border-amber-300/28 bg-[radial-gradient(circle_at_14%_0%,rgba(251,191,36,0.2),transparent_34%),linear-gradient(135deg,rgba(251,191,36,0.09),rgba(255,255,255,0.035)_50%,rgba(245,158,11,0.08))]",
    edge: "from-amber-300/75 via-orange-300/40 to-transparent",
    metricTone: "bg-amber-300/10 text-amber-100",
  },
  {
    title: "Audit Evidence",
    description: "Trace decisions and outcomes.",
    componentKey: "audit" as const,
    metric: (data: PlatformData) => formatCount(data.auditEvents.length, "event"),
    detail: () => "Evidence captured",
    tone: "border-fuchsia-300/24 bg-[radial-gradient(circle_at_82%_0%,rgba(217,70,239,0.18),transparent_33%),linear-gradient(135deg,rgba(217,70,239,0.075),rgba(255,255,255,0.035)_48%,rgba(168,85,247,0.075))]",
    edge: "from-fuchsia-300/65 via-violet-300/40 to-transparent",
    metricTone: "bg-fuchsia-300/10 text-fuchsia-100",
  },
];

export function OverviewWorkspace({
  data,
  dataStatus,
  onComponentSelect,
}: {
  data: PlatformData;
  dataStatus: DataStatus;
  onComponentSelect: (component: BackendComponentKey) => void;
}) {
  const loading = dataStatus === "loading";
  const metrics = [
    {
      label: "Workflow Sessions",
      value: data.sessions.length,
      tone: "border-cyan-300/24 bg-[linear-gradient(145deg,rgba(34,211,238,0.16),rgba(255,255,255,0.035)_55%,rgba(14,165,233,0.08))]",
    },
    {
      label: "Agents",
      value: data.agents.length,
      tone: "border-emerald-300/24 bg-[linear-gradient(145deg,rgba(16,185,129,0.16),rgba(255,255,255,0.035)_55%,rgba(20,184,166,0.08))]",
    },
    {
      label: "Tools",
      value: data.tools.length,
      tone: "border-indigo-300/24 bg-[linear-gradient(145deg,rgba(129,140,248,0.14),rgba(255,255,255,0.035)_55%,rgba(99,102,241,0.08))]",
    },
    {
      label: "Open Reviews",
      value: data.reviewQueue.length,
      tone: "border-amber-300/26 bg-[linear-gradient(145deg,rgba(251,191,36,0.15),rgba(255,255,255,0.035)_55%,rgba(245,158,11,0.08))]",
    },
    {
      label: "Audit Events",
      value: data.auditEvents.length,
      tone: "border-fuchsia-300/22 bg-[linear-gradient(145deg,rgba(217,70,239,0.13),rgba(255,255,255,0.035)_55%,rgba(168,85,247,0.075))]",
    },
    {
      label: "Workflows",
      value: data.workflowDefinitions.length,
      tone: "border-rose-300/22 bg-[linear-gradient(145deg,rgba(251,113,133,0.13),rgba(255,255,255,0.035)_55%,rgba(244,63,94,0.075))]",
    },
  ];

  return (
    <section className="grid gap-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="Platform metrics">
        {metrics.map((metric) => (
          <OverviewMetricCard key={metric.label} {...metric} loading={loading} />
        ))}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {moduleDefinitions.map((module) => {
          return (
            <a
              key={module.title}
              href={`/platform/?view=${workspaceViewForComponent(module.componentKey)}&component=${module.componentKey}`}
              onClick={(event) => {
                event.preventDefault();
                onComponentSelect(module.componentKey);
              }}
              className={`group relative overflow-hidden rounded-3xl border p-5 text-left shadow-[0_18px_60px_rgba(0,0,0,0.16)] transition hover:-translate-y-0.5 hover:border-accent/45 focus:outline-none focus:ring-2 focus:ring-accent/40 ${module.tone}`}
            >
              <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${module.edge}`} />
              <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-white/[0.055] blur-2xl transition group-hover:scale-110" />
              <div className="pointer-events-none absolute -bottom-24 left-10 h-44 w-44 rounded-full bg-ink/20 blur-3xl" />
              <div className="relative">
                <div className="flex items-start justify-between gap-4">
                  <span className="rounded-full border border-line bg-ink/35 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
                    Workspace
                  </span>
                  <span className="rounded-full border border-line bg-white/[0.055] px-3 py-1 text-xs font-semibold text-textSecondary transition group-hover:border-accent/35 group-hover:text-textPrimary">
                    Open
                  </span>
                </div>
                <h2 className="mt-5 text-2xl font-semibold tracking-[-0.02em]">{module.title}</h2>
                <p className="mt-2 text-sm leading-6 text-textSecondary">{module.description}</p>
                <div className="mt-5 grid gap-3 rounded-2xl border border-line bg-ink/42 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div>
                    <p className="text-2xl font-semibold text-textPrimary">{loading ? "..." : module.metric(data)}</p>
                    <p className="mt-1 text-sm text-textSecondary">{loading ? "Reading from backend" : module.detail(data)}</p>
                  </div>
                  <span className={`w-fit rounded-full border border-line px-3 py-1 text-xs font-semibold ${module.metricTone}`}>
                    {loading ? "Loading" : "Ready"}
                  </span>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink/45">
                  <div className={`h-full w-2/5 rounded-full bg-gradient-to-r ${module.edge}`} />
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function OverviewMetricCard({
  label,
  loading,
  tone,
  value,
}: {
  label: string;
  loading: boolean;
  tone: string;
  value: number;
}) {
  return (
    <div className={`relative overflow-hidden rounded-3xl border p-4 shadow-[0_14px_42px_rgba(0,0,0,0.12)] backdrop-blur ${tone}`}>
      <div className="pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full bg-white/[0.075] blur-xl" />
      <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="relative">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">{label}</p>
        <div className="mt-4 flex items-end justify-between gap-3">
          <p className="text-3xl font-semibold tracking-[-0.03em] text-textPrimary">{loading ? "..." : value}</p>
          <span className="h-1.5 w-10 rounded-full bg-white/20">
            <span className="block h-full w-2/3 rounded-full bg-accent/70" />
          </span>
        </div>
      </div>
    </div>
  );
}
