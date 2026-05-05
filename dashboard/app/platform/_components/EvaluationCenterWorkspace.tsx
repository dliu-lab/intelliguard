"use client";

import { useEffect, useMemo, useState } from "react";
import { PlayCircle } from "lucide-react";
import {
  evaluateAgent,
  evaluateTool,
  evaluateWorkflowDefinition,
  getSession,
  type ApiRecord,
  type EvaluationRun,
  type PlatformData,
} from "@/lib/api";
import { ComponentRow, MetricSurface, PlatformSurface, ResourceGrid } from "./shared";
import type { DataStatus } from "./types";
import { formatCount, formatTimestamp, isErrorMessage, joinParts, readText } from "./utils";

type EvaluationTargetType = "tool" | "agent" | "workflow";

const TARGET_TYPES: Array<{ label: string; value: EvaluationTargetType }> = [
  { label: "Tool", value: "tool" },
  { label: "Agent", value: "agent" },
  { label: "Workflow", value: "workflow" },
];

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

function targetId(record: ApiRecord, type: EvaluationTargetType) {
  if (type === "tool") {
    return readText(record, ["tool_id"]) || "";
  }
  if (type === "agent") {
    return readText(record, ["agent_id"]) || "";
  }
  return readText(record, ["workflow_definition_id"]) || "";
}

function targetLabel(record: ApiRecord, type: EvaluationTargetType) {
  if (type === "tool") {
    return readText(record, ["display_name", "tool_name"]) || targetId(record, type);
  }
  if (type === "agent") {
    return readText(record, ["display_name", "agent_id"]) || targetId(record, type);
  }
  return readText(record, ["name", "workflow_definition_id"]) || targetId(record, type);
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

function rulesFor(group: ApiRecord) {
  return Array.isArray(group.rules) ? (group.rules.filter((rule) => typeof rule === "object" && rule !== null) as ApiRecord[]) : [];
}

function compactJson(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) && !value.length) {
    return undefined;
  }
  const text = JSON.stringify(value);
  return text === "{}" || text === "[]" ? undefined : text;
}

export function EvaluationCenterWorkspace({
  data,
  dataStatus,
  onRefresh,
}: {
  data: PlatformData;
  dataStatus: DataStatus;
  onRefresh: () => void | Promise<void>;
}) {
  const loading = dataStatus === "loading";
  const [targetType, setTargetType] = useState<EvaluationTargetType>("tool");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [runningTarget, setRunningTarget] = useState("");
  const [message, setMessage] = useState("");
  const toolStatusCounts = countByStatus(data.tools);
  const agentStatusCounts = countByStatus(data.agents);
  const workflowStatusCounts = countByStatus(data.workflowDefinitions);
  const evaluationTargets = useMemo(() => {
    if (targetType === "tool") {
      return data.tools;
    }
    if (targetType === "agent") {
      return data.agents;
    }
    return data.workflowDefinitions;
  }, [data.agents, data.tools, data.workflowDefinitions, targetType]);
  const latestEvaluationRows = [...data.evaluationRuns].map((run) => {
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
  const selectedTarget = evaluationTargets.find((record) => targetId(record, targetType) === selectedTargetId);
  const running = Boolean(runningTarget);

  useEffect(() => {
    if (!evaluationTargets.some((record) => targetId(record, targetType) === selectedTargetId)) {
      setSelectedTargetId(targetId(evaluationTargets[0] || {}, targetType));
    }
  }, [evaluationTargets, selectedTargetId, targetType]);

  async function runEvaluation() {
    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before running evaluation.");
      return;
    }
    if (!selectedTargetId) {
      setMessage("Select a target before running evaluation.");
      return;
    }

    const runKey = `${targetType}:${selectedTargetId}`;
    setRunningTarget(runKey);
    setMessage("");
    try {
      if (targetType === "tool") {
        await evaluateTool(session.token, selectedTargetId);
      } else if (targetType === "agent") {
        await evaluateAgent(session.token, selectedTargetId);
      } else {
        await evaluateWorkflowDefinition(session.token, selectedTargetId);
      }
      setMessage(`Evaluation completed for ${selectedTarget ? targetLabel(selectedTarget, targetType) : selectedTargetId}.`);
      await Promise.resolve(onRefresh());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to run evaluation.");
    } finally {
      setRunningTarget("");
    }
  }

  return (
    <section className="grid gap-6">
      {message ? (
        <div
          className={`rounded-2xl border p-4 text-sm ${
            isErrorMessage(message)
              ? "border-red-400/45 bg-red-500/10 text-red-200"
              : "border-line bg-white/[0.04] text-textSecondary"
          }`}
        >
          {message}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Evaluation coverage">
        <MetricSurface label="Evaluator Templates" loading={loading} tone="cyan" value={data.evaluatorTemplates.length} />
        <MetricSurface label="Certified Tools" loading={loading} tone="emerald" value={certifiedCount(data.tools)} />
        <MetricSurface label="Certified Agents" loading={loading} tone="indigo" value={certifiedCount(data.agents)} />
        <MetricSurface label="Open Reviews" loading={loading} tone="amber" value={data.reviewQueue.length} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(360px,0.55fr)]">
        <PlatformSurface tone="indigo">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Run evaluation
              </span>
              <h3 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Certification target</h3>
              <p className="mt-2 text-sm leading-6 text-textSecondary">
                Run deterministic certification checks against registered tools, agents, and workflow definitions.
              </p>
            </div>
            <span className="rounded-full border border-line bg-ink/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              {formatCount(evaluationTargets.length, "target")}
            </span>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)_auto]">
            <select
              className="field-input"
              value={targetType}
              onChange={(event) => setTargetType(event.target.value as EvaluationTargetType)}
            >
              {TARGET_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <select
              className="field-input"
              value={selectedTargetId}
              onChange={(event) => setSelectedTargetId(event.target.value)}
            >
              {evaluationTargets.map((record) => {
                const id = targetId(record, targetType);
                return (
                  <option key={id} value={id}>
                    {targetLabel(record, targetType)} ({certificationStatus(record)})
                  </option>
                );
              })}
              {!evaluationTargets.length ? <option value="">No targets available</option> : null}
            </select>
            <button
              type="button"
              disabled={running || !selectedTargetId}
              onClick={runEvaluation}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-accent/35 bg-accent/10 px-5 text-sm font-semibold text-textPrimary transition hover:border-accent/55 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <PlayCircle size={16} aria-hidden="true" />
              {running ? "Evaluating" : "Run"}
            </button>
          </div>
        </PlatformSurface>

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
              coverage={coverage(data.workflowDefinitions)}
              label="Workflows"
              statusCounts={workflowStatusCounts}
            />
          </div>
        </PlatformSurface>
      </div>

      <ResourceGrid
        emptyText="Run tool or agent evaluations to create certification evidence."
        label="Latest evaluation runs"
        rows={latestEvaluationRows}
      />

      <PlatformSurface tone="cyan">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Evaluation rules
            </span>
            <h3 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Rule catalog</h3>
            <p className="mt-2 text-sm leading-6 text-textSecondary">
              Certification checks and assigned evaluator templates currently available to the platform.
            </p>
          </div>
          <span className="rounded-full border border-line bg-ink/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
            {formatCount(data.evaluationRules.reduce((total, group) => total + rulesFor(group).length, 0), "rule")}
          </span>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {data.evaluationRules.length ? (
            data.evaluationRules.map((group) => (
              <section key={readText(group, ["group_id", "label"])} className="rounded-2xl border border-line bg-ink/45 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-textPrimary">{readText(group, ["label", "group_id"])}</p>
                    <p className="mt-1 text-sm leading-6 text-textSecondary">{readText(group, ["description"])}</p>
                  </div>
                  <span className="rounded-full border border-line bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-textSecondary">
                    {readText(group, ["scope"])}
                  </span>
                </div>
                <div className="mt-4 grid gap-2">
                  {rulesFor(group).map((rule) => (
                    <ComponentRow
                      key={readText(rule, ["rule_id", "label"])}
                      title={readText(rule, ["label", "rule_id"]) || "Evaluation rule"}
                      detail={readText(rule, ["description"]) || "Rule details are not configured."}
                      meta={joinParts([
                        readText(rule, ["engine"]),
                        readText(rule, ["evaluator_type"]),
                        compactJson(rule.default_config),
                      ])}
                    />
                  ))}
                  {!rulesFor(group).length ? (
                    <ComponentRow title="No rules configured" detail="This rule group has no entries yet." />
                  ) : null}
                </div>
              </section>
            ))
          ) : (
            <ComponentRow title="No evaluation rules loaded" detail="Refresh the workspace to load the evaluation rule catalog." />
          )}
        </div>
      </PlatformSurface>
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
