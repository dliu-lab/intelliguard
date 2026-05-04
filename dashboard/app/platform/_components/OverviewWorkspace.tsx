import type { PlatformData } from "@/lib/api";
import {
  Activity,
  Bot,
  ClipboardList,
  FileCheck2,
  Gauge,
  GitBranch,
  Library,
  ListChecks,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ComponentRow, MetricSurface, PlatformSurface, platformTones, type PlatformToneName } from "./shared";
import type { BackendComponentKey, DataStatus, WorkspaceView } from "./types";
import { formatCount, formatTimestamp, joinParts, readText, workspaceViewForComponent } from "./utils";

type OverviewModule = {
  componentKey?: BackendComponentKey;
  cta: string;
  description: string;
  detail: (data: PlatformData) => string;
  icon: LucideIcon;
  metric: (data: PlatformData) => string;
  plane: "Control" | "Runtime";
  title: string;
  tone: PlatformToneName;
  view: WorkspaceView;
};

const moduleDefinitions: OverviewModule[] = [
  {
    componentKey: "agents",
    cta: "Open registry",
    description: "Register governed agents and inspect assigned tools, guardrails, evaluators, knowledge, and certification.",
    detail: (data: PlatformData) => `${formatCount(agentsWithAssignments(data), "agent")} with controls attached`,
    icon: Bot,
    metric: (data: PlatformData) => formatCount(data.agents.length, "agent"),
    plane: "Control",
    title: "Agent Registry",
    tone: "emerald",
    view: "agent-registry",
  },
  {
    componentKey: "tools",
    cta: "Open registry",
    description: "Register and certify tool contracts.",
    detail: (data: PlatformData) =>
      `${formatCount(certifiedCount(data.tools), "certified tool")}, ${formatCount(restrictedTools(data), "restricted")}`,
    icon: Wrench,
    metric: (data: PlatformData) => formatCount(data.tools.length, "tool"),
    plane: "Control",
    title: "Tool Registry",
    tone: "cyan",
    view: "tool-registry",
  },
  {
    componentKey: "workflows",
    cta: "Open builder",
    description: "Build governed multi-agent graphs from registered agents and tool contracts.",
    detail: (data: PlatformData) =>
      `${formatCount(data.workflows.length, "execution")}, ${formatCount(data.sessions.length, "session")}`,
    icon: GitBranch,
    metric: (data: PlatformData) => formatCount(data.workflowDefinitions.length, "workflow"),
    plane: "Control",
    title: "Workflow Designer",
    tone: "sky",
    view: "workflow-designer",
  },
  {
    componentKey: "knowledge",
    cta: "Open sources",
    description: "Register retrieval sources and attach governed knowledge to agents.",
    detail: (data: PlatformData) => `${formatCount(attachedKnowledgeAssignments(data), "agent link")} active`,
    icon: Library,
    metric: (data: PlatformData) => formatCount(data.knowledgeBases.length, "source"),
    plane: "Control",
    title: "Knowledge Bases",
    tone: "fuchsia",
    view: "knowledge-bases",
  },
  {
    componentKey: "guardrails",
    cta: "Open policies",
    description: "Configure runtime policies for tool access, side effects, review routing, and response safety.",
    detail: (data: PlatformData) => `${formatCount(attachedGuardrailAssignments(data), "agent assignment")} active`,
    icon: ShieldCheck,
    metric: (data: PlatformData) => formatCount(data.guardrailPolicies.length, "policy"),
    plane: "Control",
    title: "Guardrail Policies",
    tone: "indigo",
    view: "guardrail-policies",
  },
  {
    componentKey: "evaluators",
    cta: "Open center",
    description: "Review evaluator templates, certification coverage, and recent evaluation evidence.",
    detail: (data: PlatformData) => `${formatCount(data.evaluationRuns.length, "evaluation run")} recorded`,
    icon: FileCheck2,
    metric: (data: PlatformData) => formatCount(data.evaluatorTemplates.length, "evaluator"),
    plane: "Control",
    title: "Evaluation Center",
    tone: "amber",
    view: "evaluation-center",
  },
  {
    cta: "Inspect runs",
    description: "Run and inspect governed workflow executions across agent sessions.",
    detail: (data: PlatformData) =>
      `${formatCount(activeWorkflowRuns(data), "active or recent run")}, ${formatCount(pendingReviews(data), "pending review")}`,
    icon: Activity,
    metric: (data: PlatformData) => formatCount(data.sessions.length, "session"),
    plane: "Runtime",
    title: "Agentic Workflows",
    tone: "rose",
    view: "agentic-workflows",
  },
  {
    componentKey: "reviews",
    cta: "Open queue",
    description: "Resolve human review items created by runtime policy decisions.",
    detail: (data: PlatformData) => `${formatCount(resolvedReviews(data), "resolved item")} in loaded data`,
    icon: ListChecks,
    metric: (data: PlatformData) => formatCount(pendingReviews(data), "pending review"),
    plane: "Runtime",
    title: "Review Queue",
    tone: "amber",
    view: "reviews",
  },
  {
    componentKey: "audit",
    cta: "Search evidence",
    description: "Trace governed decisions, risk signals, and policy evidence.",
    detail: (data: PlatformData) => `${averageRisk(data)} average risk score`,
    icon: ClipboardList,
    metric: (data: PlatformData) => formatCount(data.auditEvents.length, "event"),
    plane: "Runtime",
    title: "Audit Evidence",
    tone: "fuchsia",
    view: "audit",
  },
  {
    componentKey: "monitoring",
    cta: "Open monitoring",
    description: "Track decision rates, review pressure, certification coverage, and fleet risk.",
    detail: (data: PlatformData) =>
      `${formatCount(blockedDecisions(data), "blocked decision")}, ${formatCount(data.environments.length, "environment")}`,
    icon: Gauge,
    metric: (data: PlatformData) => healthLabel(data),
    plane: "Runtime",
    title: "Monitoring",
    tone: "emerald",
    view: "monitoring",
  },
];

function certificationStatus(record: Record<string, unknown>) {
  const certification = record.certification;
  if (!certification || typeof certification !== "object" || Array.isArray(certification)) {
    return "DRAFT";
  }

  return readText(certification as Record<string, unknown>, ["status"]) || "DRAFT";
}

function certifiedCount(records: Array<Record<string, unknown>>) {
  return records.filter((record) => certificationStatus(record) === "CERTIFIED").length;
}

function restrictedTools(data: PlatformData) {
  return data.tools.filter((tool) => {
    const permissions = tool.permissions;
    const sideEffects = tool.side_effect_level || tool.side_effects;
    return (
      readText(tool, ["requires_review"]) === "true" ||
      tool.requires_review === true ||
      (typeof sideEffects === "string" && sideEffects !== "read_only") ||
      (permissions && typeof permissions === "object" && !Array.isArray(permissions))
    );
  }).length;
}

function agentsWithAssignments(data: PlatformData) {
  return Object.values(data.agentAssignmentCounts).filter(
    (counts) => counts.guardrails + counts.evaluators + counts.knowledge > 0,
  ).length;
}

function attachedGuardrailAssignments(data: PlatformData) {
  return Object.values(data.agentAssignmentCounts).reduce((total, counts) => total + counts.guardrails, 0);
}

function attachedKnowledgeAssignments(data: PlatformData) {
  return Object.values(data.agentAssignmentCounts).reduce((total, counts) => total + counts.knowledge, 0);
}

function pendingReviews(data: PlatformData) {
  return data.reviewQueue.filter((review) => (readText(review, ["status"]) || "PENDING") === "PENDING").length;
}

function resolvedReviews(data: PlatformData) {
  return data.reviewQueue.filter((review) => (readText(review, ["status"]) || "PENDING") !== "PENDING").length;
}

function activeWorkflowRuns(data: PlatformData) {
  return data.workflows.length || data.sessions.length;
}

function averageRisk(data: PlatformData) {
  if (!data.auditEvents.length) {
    return 0;
  }

  const total = data.auditEvents.reduce((sum, event) => {
    const value = Number(readText(event, ["risk_score"]));
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  return Math.round(total / data.auditEvents.length);
}

function blockedDecisions(data: PlatformData) {
  return data.auditEvents.filter((event) => String(readText(event, ["decision"]) || "").toUpperCase() === "BLOCK").length;
}

function healthLabel(data: PlatformData) {
  if (blockedDecisions(data) > 0) {
    return "Action needed";
  }

  if (pendingReviews(data) > 0) {
    return "Reviewing";
  }

  return "Stable";
}

function latestEvaluationRun(data: PlatformData) {
  return [...data.evaluationRuns].sort((left, right) => {
    const leftTime = new Date(left.completed_at || left.created_at).getTime();
    const rightTime = new Date(right.completed_at || right.created_at).getTime();
    return rightTime - leftTime;
  })[0];
}

export function OverviewWorkspace({
  data,
  dataStatus,
  onComponentSelect,
  onViewSelect,
}: {
  data: PlatformData;
  dataStatus: DataStatus;
  onComponentSelect: (component: BackendComponentKey) => void;
  onViewSelect: (view: WorkspaceView) => void;
}) {
  const loading = dataStatus === "loading";
  const latestRun = latestEvaluationRun(data);
  const metrics = [
    {
      label: "Agents",
      tone: "emerald",
      value: data.agents.length,
    },
    {
      label: "Tools",
      tone: "cyan",
      value: data.tools.length,
    },
    {
      label: "Guardrails",
      tone: "indigo",
      value: data.guardrailPolicies.length,
    },
    {
      label: "Evaluators",
      tone: "amber",
      value: data.evaluatorTemplates.length,
    },
    {
      label: "Knowledge",
      tone: "fuchsia",
      value: data.knowledgeBases.length,
    },
    {
      label: "Workflows",
      tone: "sky",
      value: data.workflowDefinitions.length,
    },
    {
      label: "Reviews",
      tone: "rose",
      value: pendingReviews(data),
    },
    {
      label: "Audit Events",
      tone: "fuchsia",
      value: data.auditEvents.length,
    },
  ] satisfies Array<{ label: string; tone: PlatformToneName; value: number }>;

  return (
    <section className="grid gap-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8" aria-label="Platform metrics">
        {metrics.map((metric) => (
          <MetricSurface key={metric.label} {...metric} loading={loading} />
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.42fr)]">
        <PlatformSurface tone="sky">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Operating model
              </span>
              <h2 className="mt-2 text-2xl font-semibold">Platform coverage</h2>
              <p className="mt-2 text-sm leading-6 text-textSecondary">
                Registry coverage, runtime health, and evidence surfaces are grouped by operating plane.
              </p>
            </div>
            <span className="rounded-full border border-line bg-ink/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              {formatCount(moduleDefinitions.length, "section")}
            </span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <OverviewSignal label="Control sections" value="6" detail="Agents, tools, workflows, knowledge, guardrails, evaluation" />
            <OverviewSignal label="Runtime sections" value="4" detail="Workflow runs, reviews, audit evidence, monitoring" />
            <OverviewSignal label="Environments" value={String(data.environments.length || 1)} detail={data.environments.join(", ") || "all"} />
            <OverviewSignal label="Health" value={loading ? "..." : healthLabel(data)} detail={formatCount(blockedDecisions(data), "blocked decision")} />
          </div>
        </PlatformSurface>

        <PlatformSurface tone="amber">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Current attention
          </span>
          <div className="mt-5 grid gap-3">
            <ComponentRow
              title="Review pressure"
              detail={`${formatCount(pendingReviews(data), "pending review")} across ${formatCount(data.sessions.length, "session")}.`}
              meta={pendingReviews(data) ? "needs review" : "clear"}
            />
            <ComponentRow
              title="Certification coverage"
              detail={joinParts([
                `${certifiedCount(data.tools)}/${data.tools.length} tools certified`,
                `${certifiedCount(data.agents)}/${data.agents.length} agents certified`,
              ]) || "No certified assets yet."}
              meta={`${data.evaluationRuns.length} runs`}
            />
            <ComponentRow
              title={latestRun ? "Latest evaluation" : "No evaluation runs"}
              detail={
                latestRun
                  ? joinParts([
                      latestRun.target_type,
                      latestRun.overall_result || latestRun.status,
                      `${latestRun.criteria_passed}/${latestRun.criteria_total} criteria`,
                    ]) || "Evaluation evidence captured."
                  : "Run tool, agent, or workflow evaluations to populate freshness evidence."
              }
              meta={latestRun ? formatTimestamp(latestRun.completed_at || latestRun.created_at) : "empty"}
            />
          </div>
        </PlatformSurface>
      </div>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-5">
        {moduleDefinitions.map((module) => {
          const Icon = module.icon;
          return (
            <PlatformSurface
              ariaLabel={`Open ${module.title}`}
              key={module.title}
              className="min-h-[250px]"
              href={
                module.componentKey
                  ? `/platform/?view=${workspaceViewForComponent(module.componentKey)}&component=${module.componentKey}`
                  : `/platform/?view=${module.view}`
              }
              interactive
              onClick={(event) => {
                event.preventDefault();
                if (module.componentKey) {
                  onComponentSelect(module.componentKey);
                  return;
                }

                onViewSelect(module.view);
              }}
              tone={module.tone}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="grid h-11 w-11 place-items-center rounded-2xl border border-line bg-ink/55 text-accent">
                  <Icon size={20} aria-hidden="true" />
                </div>
                <span className="rounded-full border border-line bg-ink/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-textSecondary">
                  {module.plane}
                </span>
              </div>
              <h2 className="mt-5 text-xl font-semibold">{module.title}</h2>
              <p className="mt-2 text-sm leading-6 text-textSecondary">{module.description}</p>
              <div className="mt-5 rounded-2xl border border-line bg-ink/42 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <div>
                  <p className="text-xl font-semibold text-textPrimary">{loading ? "..." : module.metric(data)}</p>
                  <p className="mt-1 text-sm text-textSecondary">{loading ? "Reading from backend" : module.detail(data)}</p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                  {module.cta}
                </span>
                <span className="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-ink/45">
                  <span className={`block h-full w-2/5 rounded-full bg-gradient-to-r transition-all group-hover:w-3/5 ${platformTones[module.tone].edge}`} />
                </span>
              </div>
            </PlatformSurface>
          );
        })}
      </div>
    </section>
  );
}

function OverviewSignal({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-ink/45 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-textPrimary">{value}</p>
      <p className="mt-1 truncate text-xs text-textSecondary">{detail}</p>
    </div>
  );
}
