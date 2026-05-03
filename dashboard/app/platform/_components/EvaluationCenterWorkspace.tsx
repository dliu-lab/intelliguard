import type { ApiRecord, EvaluationRun, PlatformData } from "@/lib/api";
import { ComponentRow, MetricSurface, PlatformSurface, ResourceGrid } from "./shared";
import type { DataStatus } from "./types";
import { formatCount, formatTimestamp, joinParts, readText } from "./utils";

function certificationStatus(record: ApiRecord) {
  const certification = record.certification;
  if (!certification || typeof certification !== "object" || Array.isArray(certification)) {
    return "DRAFT";
  }

  return readText(certification as ApiRecord, ["status"]) || "DRAFT";
}

function countByStatus(records: ApiRecord[]) {
  return records.reduce<Record<string, number>>((counts, record) => {
    const status = certificationStatus(record);
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function coverage(records: ApiRecord[]) {
  if (!records.length) {
    return "0%";
  }

  const certified = records.filter((record) => certificationStatus(record) === "CERTIFIED").length;
  return `${Math.round((certified / records.length) * 100)}%`;
}

function certifiedCount(records: ApiRecord[]) {
  return records.filter((record) => certificationStatus(record) === "CERTIFIED").length;
}

function evaluatorMethod(record: ApiRecord) {
  return readText(record, ["llm_enabled"]) === "true" || record.llm_enabled === true
    ? "LLM-as-judge"
    : "deterministic";
}

function lookupLabel(records: ApiRecord[], idKey: string, id: string, labelKeys: string[]) {
  const record = records.find((item) => readText(item, [idKey]) === id);
  return record ? readText(record, labelKeys) : undefined;
}

function evaluationRunTargetLabel(run: EvaluationRun, data: PlatformData) {
  if (run.target_type === "tool") {
    return lookupLabel(data.tools, "tool_id", run.target_id, ["display_name", "tool_name"]);
  }
  if (run.target_type === "agent") {
    return lookupLabel(data.agents, "agent_id", run.target_id, ["display_name", "agent_id"]);
  }
  if (run.target_type === "workflow") {
    return lookupLabel(data.workflowDefinitions, "workflow_definition_id", run.target_id, [
      "name",
      "workflow_definition_id",
    ]);
  }
  return undefined;
}

export function EvaluationCenterWorkspace({
  data,
  dataStatus,
}: {
  data: PlatformData;
  dataStatus: DataStatus;
}) {
  const loading = dataStatus === "loading";
  const toolStatusCounts = countByStatus(data.tools);
  const agentStatusCounts = countByStatus(data.agents);
  const latestEvaluationRows = data.evaluationRuns.map((run) => {
    const targetLabel = evaluationRunTargetLabel(run, data) || run.target_id;
    const result = run.overall_result || run.status;
    return {
      detail:
        joinParts([
          run.target_type,
          `result ${result}`,
          `${run.criteria_passed}/${run.criteria_total} criteria`,
          run.duration_ms === null ? undefined : `${run.duration_ms}ms`,
        ]) || "Evaluation run captured.",
      meta: joinParts([formatTimestamp(run.completed_at || run.created_at), run.run_id]),
      title: targetLabel,
    };
  });

  return (
    <section className="grid gap-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Evaluation coverage">
        <MetricSurface label="Evaluator Templates" loading={loading} tone="cyan" value={data.evaluatorTemplates.length} />
        <MetricSurface label="Certified Tools" loading={loading} tone="emerald" value={certifiedCount(data.tools)} />
        <MetricSurface label="Certified Agents" loading={loading} tone="indigo" value={certifiedCount(data.agents)} />
        <MetricSurface label="Open Reviews" loading={loading} tone="amber" value={data.reviewQueue.length} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(360px,0.55fr)]">
        <PlatformSurface tone="cyan">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Fleet evaluation
              </span>
              <h3 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Evaluator templates</h3>
              <p className="mt-2 text-sm leading-6 text-textSecondary">
                Cross-platform rubrics registered for build-time and runtime governance.
              </p>
            </div>
            <span className="rounded-full border border-line bg-ink/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              {formatCount(data.evaluatorTemplates.length, "template")}
            </span>
          </div>

          <div className="mt-5 grid gap-3">
            {data.evaluatorTemplates.length ? (
              data.evaluatorTemplates.map((template) => (
                <ComponentRow
                  key={readText(template, ["evaluator_id"]) || readText(template, ["display_name"])}
                  title={readText(template, ["display_name", "evaluator_id"]) || "Evaluator template"}
                  detail={readText(template, ["description"]) || "Registered evaluator template."}
                  meta={joinParts([
                    readText(template, ["scope"]),
                    readText(template, ["evaluator_type"]),
                    evaluatorMethod(template),
                  ])}
                />
              ))
            ) : (
              <ComponentRow title="No evaluator templates" detail="Register evaluator templates before certifying agents and workflows." />
            )}
          </div>
        </PlatformSurface>

        <PlatformSurface tone="emerald">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Certification coverage
          </span>
          <div className="mt-5 grid gap-3">
            <CoverageRow
              count={data.tools.length}
              coverage={coverage(data.tools)}
              label="Tools"
              statusCounts={toolStatusCounts}
            />
            <CoverageRow
              count={data.agents.length}
              coverage={coverage(data.agents)}
              label="Agents"
              statusCounts={agentStatusCounts}
            />
            <CoverageRow
              count={data.workflowDefinitions.length}
              coverage="0%"
              label="Workflows"
              statusCounts={{ DRAFT: data.workflowDefinitions.length }}
            />
          </div>
        </PlatformSurface>
      </div>

      <ResourceGrid
        emptyText="Run tool or agent evaluations to create certification evidence."
        label="Latest evaluation runs"
        rows={latestEvaluationRows}
      />
    </section>
  );
}

function CoverageRow({
  count,
  coverage,
  label,
  statusCounts,
}: {
  count: number;
  coverage: string;
  label: string;
  statusCounts: Record<string, number>;
}) {
  const statusText = Object.entries(statusCounts)
    .filter(([, value]) => value > 0)
    .map(([status, value]) => `${status}: ${value}`)
    .join(" / ");

  return (
    <div className="rounded-2xl border border-line bg-ink/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-textPrimary">{label}</p>
          <p className="mt-1 text-sm text-textSecondary">{formatCount(count, "record")}</p>
        </div>
        <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-sm font-semibold text-accent">
          {coverage}
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-textSecondary">{statusText || "No certification records yet"}</p>
    </div>
  );
}
