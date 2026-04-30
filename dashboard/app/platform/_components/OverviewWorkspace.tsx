import { Activity, GitBranch, Scale, ShieldCheck } from "lucide-react";
import type { PlatformData } from "@/lib/api";
import { MetricCard } from "./shared";
import type { BackendComponentKey, DataStatus } from "./types";
import { formatCount, workspaceViewForComponent } from "./utils";

const moduleDefinitions = [
  {
    title: "Control Plane",
    description: "Register platform resources.",
    icon: ShieldCheck,
    componentKey: "agents" as const,
    metric: (data: PlatformData) => formatCount(data.agents.length, "agent"),
    detail: (data: PlatformData) =>
      `${formatCount(data.tools.length, "tool")}, ${formatCount(data.guardrailPolicies.length, "guardrail")}`,
  },
  {
    title: "Agentic Workflows",
    description: "Build and run multi-agent flows.",
    icon: GitBranch,
    componentKey: "workflows" as const,
    metric: (data: PlatformData) => formatCount(data.workflowDefinitions.length, "workflow"),
    detail: (data: PlatformData) =>
      `${formatCount(data.workflows.length, "execution")}, ${formatCount(data.sessions.length, "session")}`,
  },
  {
    title: "Runtime Policies",
    description: "Evaluate runtime actions.",
    icon: Scale,
    componentKey: "guardrails" as const,
    metric: (data: PlatformData) => formatCount(data.reviewQueue.length, "review"),
    detail: (data: PlatformData) => `${formatCount(data.guardrailPolicies.length, "policy")} available`,
  },
  {
    title: "Audit Evidence",
    description: "Trace decisions and outcomes.",
    icon: Activity,
    componentKey: "audit" as const,
    metric: (data: PlatformData) => formatCount(data.auditEvents.length, "event"),
    detail: () => "Evidence captured",
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
