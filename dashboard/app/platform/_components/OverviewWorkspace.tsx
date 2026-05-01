import type { PlatformData } from "@/lib/api";
import { MetricSurface, PlatformSurface, platformTones, type PlatformToneName } from "./shared";
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
    tone: "emerald" as const,
  },
  {
    title: "Agentic Workflows",
    description: "Build and run multi-agent flows.",
    componentKey: "workflows" as const,
    metric: (data: PlatformData) => formatCount(data.workflowDefinitions.length, "workflow"),
    detail: (data: PlatformData) =>
      `${formatCount(data.workflows.length, "execution")}, ${formatCount(data.sessions.length, "session")}`,
    tone: "sky" as const,
  },
  {
    title: "Runtime Policies",
    description: "Evaluate runtime actions.",
    componentKey: "guardrails" as const,
    metric: (data: PlatformData) => formatCount(data.reviewQueue.length, "review"),
    detail: (data: PlatformData) => `${formatCount(data.guardrailPolicies.length, "policy")} available`,
    tone: "amber" as const,
  },
  {
    title: "Audit Evidence",
    description: "Trace decisions and outcomes.",
    componentKey: "audit" as const,
    metric: (data: PlatformData) => formatCount(data.auditEvents.length, "event"),
    detail: () => "Evidence captured",
    tone: "fuchsia" as const,
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
      tone: "cyan" as const,
    },
    {
      label: "Agents",
      value: data.agents.length,
      tone: "emerald" as const,
    },
    {
      label: "Tools",
      value: data.tools.length,
      tone: "indigo" as const,
    },
    {
      label: "Open Reviews",
      value: data.reviewQueue.length,
      tone: "amber" as const,
    },
    {
      label: "Audit Events",
      value: data.auditEvents.length,
      tone: "fuchsia" as const,
    },
    {
      label: "Workflows",
      value: data.workflowDefinitions.length,
      tone: "rose" as const,
    },
  ] satisfies Array<{ label: string; tone: PlatformToneName; value: number }>;

  return (
    <section className="grid gap-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="Platform metrics">
        {metrics.map((metric) => (
          <MetricSurface key={metric.label} {...metric} loading={loading} />
        ))}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {moduleDefinitions.map((module) => {
          return (
            <PlatformSurface
              ariaLabel={`Open ${module.title}`}
              key={module.title}
              href={`/platform/?view=${workspaceViewForComponent(module.componentKey)}&component=${module.componentKey}`}
              interactive
              onClick={(event) => {
                event.preventDefault();
                onComponentSelect(module.componentKey);
              }}
              tone={module.tone}
            >
              <h2 className="text-2xl font-semibold tracking-[-0.02em]">{module.title}</h2>
              <p className="mt-2 text-sm leading-6 text-textSecondary">{module.description}</p>
              <div className="mt-5 rounded-2xl border border-line bg-ink/42 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <div>
                  <p className="text-2xl font-semibold text-textPrimary">{loading ? "..." : module.metric(data)}</p>
                  <p className="mt-1 text-sm text-textSecondary">{loading ? "Reading from backend" : module.detail(data)}</p>
                </div>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink/45">
                <div className={`h-full w-2/5 rounded-full bg-gradient-to-r transition-all group-hover:w-3/5 ${platformTones[module.tone].edge}`} />
              </div>
            </PlatformSurface>
          );
        })}
      </div>
    </section>
  );
}
