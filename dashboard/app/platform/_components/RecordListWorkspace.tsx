"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, FileJson, PlayCircle, RotateCw, Search, SlidersHorizontal, XCircle } from "lucide-react";
import { getSession, resolveReview, runMultiAgentWorkflow, type ApiRecord, type PlatformData } from "@/lib/api";
import { ComponentRow, PlatformSurface } from "./shared";
import { formatCount, formatTimestamp, isErrorMessage, joinParts, readNestedText, readText } from "./utils";

function workflowRunId(workflow: ApiRecord) {
  return readText(workflow, ["workflow_id", "id", "session_id"]) || "";
}

function recordMatchesWorkflow(record: ApiRecord, selectedWorkflowId: string) {
  if (!selectedWorkflowId) {
    return true;
  }

  return [
    "workflow_id",
    "workflow_definition_id",
    "session_id",
    "parent_workflow_id",
    "agent_workflow_id",
  ].some((key) => readText(record, [key]) === selectedWorkflowId);
}

function workflowRunSearchText(workflow: ApiRecord) {
  return [
    readText(workflow, ["name", "workflow_id", "id", "session_id"]),
    readText(workflow, ["summary", "user_goal"]),
    readText(workflow, ["decision", "status"]),
    readNestedText(workflow, ["metadata", "workflow_definition_id"]),
    readNestedText(workflow, ["metadata", "domain"]),
    readText(workflow, ["created_at", "updated_at"]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function workflowDefinitionId(workflow: ApiRecord, detail?: ApiRecord) {
  return (
    readText(workflow, ["workflow_definition_id"])
    || readNestedText(workflow, ["metadata", "workflow_definition_id"])
    || (detail ? readText(detail, ["workflow_definition_id"]) : undefined)
    || readNestedText(detail || {}, ["metadata", "workflow_definition_id"])
    || ""
  );
}

function workflowDomain(workflow: ApiRecord, detail?: ApiRecord) {
  return (
    readText(workflow, ["domain"])
    || readNestedText(workflow, ["metadata", "domain"])
    || (detail ? readText(detail, ["domain"]) : undefined)
    || readNestedText(detail || {}, ["metadata", "domain"])
    || "general"
  );
}

function workflowPendingReviews(workflow: ApiRecord, detail: ApiRecord, reviewQueue: ApiRecord[]) {
  const workflowId = workflowRunId(workflow) || readText(detail, ["workflow_id"]);
  const sessions = asRecords(detail.sessions);
  const sessionIds = new Set(sessions.map((session) => readText(session, ["session_id"])).filter(Boolean));

  return reviewQueue.filter((review) => {
    if ((readText(review, ["status"]) || "PENDING") !== "PENDING") {
      return false;
    }
    return (
      Boolean(workflowId && readText(review, ["workflow_id"]) === workflowId)
      || Boolean(readText(review, ["session_id"]) && sessionIds.has(readText(review, ["session_id"]) || ""))
    );
  });
}

type WorkflowRunBucket = "running" | "successful" | "failed" | "pending_human";
type WorkflowRunView = "all" | WorkflowRunBucket;

function workflowRunBucket(workflow: ApiRecord, detail: ApiRecord, reviewQueue: ApiRecord[]): WorkflowRunBucket {
  const value = (joinParts([
    readText(workflow, ["status", "decision"]),
    readText(detail, ["status", "decision"]),
  ]) || "").toUpperCase();

  if (workflowPendingReviews(workflow, detail, reviewQueue).length || value.includes("REVIEW")) {
    return "pending_human";
  }
  if (value.includes("FAIL") || value.includes("ERROR") || value.includes("BLOCK") || value.includes("DENIED")) {
    return "failed";
  }
  if (value.includes("SUCCESS") || value.includes("COMPLETE") || value.includes("ALLOW") || value.includes("APPROVED")) {
    return "successful";
  }
  return "running";
}

const WORKFLOW_BUCKETS: Array<{ id: WorkflowRunBucket; label: string; detail: string }> = [
  { id: "running", label: "Running", detail: "Active or recently started workflow executions." },
  { id: "pending_human", label: "Pending on Human", detail: "Workflow executions waiting for reviewer action." },
  { id: "successful", label: "Successful", detail: "Workflow executions completed without a blocking decision." },
  { id: "failed", label: "Failed", detail: "Workflow executions blocked, failed, or denied." },
];

const WORKFLOW_RUN_VIEWS: Array<{ id: WorkflowRunView; label: string; detail: string }> = [
  { id: "all", label: "All", detail: "Every workflow run available in the current environment." },
  ...WORKFLOW_BUCKETS,
];

export function WorkflowTraceWorkspace({
  data,
  onAuditEventsSelect,
  onRefresh,
  selectedWorkflowId,
}: {
  data: PlatformData;
  onAuditEventsSelect: (workflowIdOrSessionId: string) => void;
  onRefresh: () => void;
  selectedWorkflowId: string;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkflowDefinitionId, setSelectedWorkflowDefinitionId] = useState("");
  const [runQuery, setRunQuery] = useState("I need to check my bank account.");
  const [message, setMessage] = useState("");
  const [runningWorkflowDefinitionId, setRunningWorkflowDefinitionId] = useState("");
  const [expandedWorkflowIds, setExpandedWorkflowIds] = useState<Record<string, boolean>>({});
  const [runView, setRunView] = useState<WorkflowRunView>("all");

  useEffect(() => {
    const workflowIds = data.workflowDefinitions
      .map((workflow) => readText(workflow, ["workflow_definition_id"]))
      .filter(Boolean) as string[];

    if (!workflowIds.length) {
      setSelectedWorkflowDefinitionId("");
      return;
    }

    if (!selectedWorkflowDefinitionId || !workflowIds.includes(selectedWorkflowDefinitionId)) {
      setSelectedWorkflowDefinitionId(workflowIds[0]);
    }
  }, [data.workflowDefinitions, selectedWorkflowDefinitionId]);

  useEffect(() => {
    if (!selectedWorkflowId) {
      return;
    }
    setExpandedWorkflowIds((current) => ({ ...current, [selectedWorkflowId]: true }));
  }, [selectedWorkflowId]);

  const workflowRows = useMemo(() => {
    const visibleWorkflows = selectedWorkflowId
      ? data.workflows.filter((workflow) => recordMatchesWorkflow(workflow, selectedWorkflowId))
      : data.workflows;

    return visibleWorkflows.map((workflow) => {
      const detail = data.workflowDetails.find((item) => readText(item, ["workflow_id"]) === readText(workflow, ["workflow_id"])) || workflow;
      return {
        bucket: workflowRunBucket(workflow, detail, data.reviewQueue),
        detail,
        workflow,
      };
    });
  }, [data.workflowDetails, data.reviewQueue, data.workflows, selectedWorkflowId]);

  const searchedWorkflowRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return workflowRows;
    }

    return workflowRows.filter(({ workflow }) => workflowRunSearchText(workflow).includes(query));
  }, [searchQuery, workflowRows]);

  const visibleWorkflowRows = useMemo(() => {
    if (runView === "all") {
      return searchedWorkflowRows;
    }

    return searchedWorkflowRows.filter((row) => row.bucket === runView);
  }, [runView, searchedWorkflowRows]);

  const workflowRunCounts = useMemo(() => {
    return WORKFLOW_RUN_VIEWS.reduce<Record<WorkflowRunView, number>>(
      (counts, view) => {
        counts[view.id] = view.id === "all" ? workflowRows.length : workflowRows.filter((row) => row.bucket === view.id).length;
        return counts;
      },
      {
        all: 0,
        failed: 0,
        pending_human: 0,
        running: 0,
        successful: 0,
      },
    );
  }, [workflowRows]);

  const activeRunView = WORKFLOW_RUN_VIEWS.find((view) => view.id === runView) || WORKFLOW_RUN_VIEWS[0];

  async function executeWorkflow(workflowDefinitionId: string, query: string) {
    setMessage("");

    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before running a workflow.");
      return;
    }
    if (!workflowDefinitionId) {
      setMessage("Select a workflow definition before running.");
      return;
    }

    try {
      setRunningWorkflowDefinitionId(workflowDefinitionId);
      await runMultiAgentWorkflow(session.token, {
        query,
        workflow_definition_id: workflowDefinitionId,
      });
      setMessage("Workflow run started.");
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to run workflow.");
    } finally {
      setRunningWorkflowDefinitionId("");
    }
  }

  async function runWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await executeWorkflow(selectedWorkflowDefinitionId, runQuery);
  }

  function rerunWorkflow(workflow: ApiRecord, detail: ApiRecord) {
    const definitionId = workflowDefinitionId(workflow, detail);
    void executeWorkflow(definitionId, readText(workflow, ["user_goal"]) || readText(detail, ["user_goal"]) || runQuery);
  }

  function toggleWorkflow(workflowId: string) {
    setExpandedWorkflowIds((current) => ({ ...current, [workflowId]: !current[workflowId] }));
  }

  return (
    <section className="grid gap-5">
      {message ? (
        <div
          className={`rounded-3xl border p-4 text-sm ${
            isErrorMessage(message)
              ? "border-red-400/45 bg-red-500/10 text-red-200"
              : "border-line bg-white/[0.04] text-textSecondary"
          }`}
        >
          {message}
        </div>
      ) : null}

      <PlatformSurface tone="sky">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(420px,1.2fr)] xl:items-end">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Workflow Runner</span>
            <h4 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-textPrimary">
              Run and inspect workflows
            </h4>
            <p className="mt-2 text-sm leading-6 text-textSecondary">
              Start a workflow definition, then filter runtime traces by execution state.
            </p>
          </div>

          <form className="grid gap-3 lg:grid-cols-[minmax(220px,0.42fr)_minmax(0,1fr)_auto]" onSubmit={runWorkflow}>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              Definition
              <select
                value={selectedWorkflowDefinitionId}
                onChange={(event) => setSelectedWorkflowDefinitionId(event.target.value)}
                className="field-input"
              >
                {data.workflowDefinitions.map((workflow) => (
                  <option key={String(workflow.workflow_definition_id)} value={String(workflow.workflow_definition_id)}>
                    {joinParts([
                      readText(workflow, ["name", "workflow_definition_id"]) || "Workflow definition",
                      readText(workflow, ["environment"]),
                    ])}
                  </option>
                ))}
                {!data.workflowDefinitions.length ? <option value="">No workflow definitions</option> : null}
              </select>
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              Goal
              <input value={runQuery} onChange={(event) => setRunQuery(event.target.value)} className="field-input" />
            </label>
            <button
              type="submit"
              disabled={Boolean(runningWorkflowDefinitionId)}
              className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-full border border-accent/35 bg-accent/10 px-5 text-sm font-semibold text-textPrimary transition hover:border-accent/55 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <PlayCircle size={16} aria-hidden="true" />
              {runningWorkflowDefinitionId ? "Running" : "Run"}
            </button>
          </form>
        </div>
      </PlatformSurface>

      <section className="grid gap-5 xl:grid-cols-[minmax(290px,0.34fr)_minmax(0,1fr)]">
        <PlatformSurface tone="sky">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Runtime traces</span>
            <h4 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-textPrimary">
              Filter workflow runs
            </h4>
            <p className="mt-2 text-sm leading-6 text-textSecondary">
              Review workflow executions by runtime state before opening trace detail.
            </p>
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-textSecondary">
              Runs
            </p>
            <div className="mt-3 grid gap-2">
              {WORKFLOW_RUN_VIEWS.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => setRunView(view.id)}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-semibold transition hover:border-accent/45 hover:bg-accent/10 ${
                    runView === view.id ? "border-accent/45 bg-accent/10 text-textPrimary" : "border-line bg-ink/45 text-textSecondary"
                  }`}
                >
                  <span>{view.label}</span>
                  <span>{workflowRunCounts[view.id]}</span>
                </button>
              ))}
            </div>
          </div>
        </PlatformSurface>

        <section className="rounded-3xl border border-line bg-white/[0.035] p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)] lg:items-end">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Agentic workflows</span>
              <h3 className="mt-2 text-xl font-semibold text-textPrimary">{activeRunView.label} runs</h3>
              <p className="mt-1 text-sm leading-6 text-textSecondary">
                {selectedWorkflowId
                  ? `Showing audit-linked trace ${selectedWorkflowId}.`
                  : activeRunView.detail}
              </p>
            </div>
            <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-line bg-ink/65 px-4 py-3 text-sm text-textSecondary">
              <Search size={17} aria-hidden="true" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search workflow runs, definitions, domains, or goals..."
                className="w-full bg-transparent text-textPrimary outline-none placeholder:text-textSecondary"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-3">
            {visibleWorkflowRows.length ? (
              visibleWorkflowRows.map(({ detail, workflow }) => {
                const id = workflowRunId(workflow) || readText(detail, ["workflow_id"]);
                return (
                  <WorkflowTraceGroup
                    key={id || readText(workflow, ["session_id"])}
                    auditEvents={data.auditEvents}
                    detail={detail}
                    expanded={Boolean(id && expandedWorkflowIds[id])}
                    onAuditEventsSelect={onAuditEventsSelect}
                    onRerun={() => rerunWorkflow(workflow, detail)}
                    onToggle={() => id && toggleWorkflow(id)}
                    reviewQueue={data.reviewQueue}
                    running={runningWorkflowDefinitionId === workflowDefinitionId(workflow, detail)}
                    workflow={workflow}
                    workflowDefinitions={data.workflowDefinitions}
                  />
                );
              })
            ) : (
              <ComponentRow
                title={workflowRows.length ? "No matching workflow runs" : "No workflow runs"}
                detail={workflowRows.length ? "Adjust the search or status filter." : "Run a workflow to create the first runtime trace."}
              />
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm text-textSecondary">
            <span>
              Showing {visibleWorkflowRows.length} of {workflowRows.length}
            </span>
            {searchQuery ? <span>Search results filtered by "{searchQuery}"</span> : null}
          </div>
        </section>
      </section>
    </section>
  );
}

function asRecords(value: unknown): ApiRecord[] {
  return Array.isArray(value) ? (value.filter((item) => item && typeof item === "object") as ApiRecord[]) : [];
}

function numberValue(record: ApiRecord, keys: string[]) {
  const value = keys.map((key) => record[key]).find((item) => typeof item === "number" || typeof item === "string");
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boolValue(record: ApiRecord, keys: string[]) {
  const value = keys.map((key) => record[key]).find((item) => typeof item === "boolean" || typeof item === "string");
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return false;
}

function objectValue(record: ApiRecord, key: string): ApiRecord {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ApiRecord) : {};
}

function stringArrayValue(record: ApiRecord, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function riskTypes(record: ApiRecord) {
  return stringArrayValue(record, "risk_types").length
    ? stringArrayValue(record, "risk_types")
    : [readText(record, ["risk_type"])].filter(Boolean) as string[];
}

function objectEntries(record: ApiRecord): Array<[string, ApiRecord]> {
  return Object.entries(record).flatMap(([key, value]) => (
    value && typeof value === "object" && !Array.isArray(value) ? [[key, value as ApiRecord]] : []
  ));
}

function argumentRuleSummary(toolName: string, rule: ApiRecord) {
  const required = stringArrayValue(rule, "required");
  const maxLimit = readText(rule, ["max_limit"]);
  return joinParts([
    toolName,
    required.length ? `requires ${required.join(", ")}` : undefined,
    boolValue(rule, ["customer_id_must_match_query"]) ? "customer scope-bound" : undefined,
    boolValue(rule, ["require_filter"]) ? "filter required" : undefined,
    maxLimit ? `limit <= ${maxLimit}` : undefined,
  ]) || toolName;
}

function sideEffectSummary(toolName: string, control: ApiRecord) {
  const level = readText(control, ["level"]) || "read_only";
  const review = boolValue(control, ["requires_review"]) ? "review required" : "no review";
  return `${toolName}: ${level}, ${review}`;
}

function decisionTone(decision: string | undefined, riskScore: number) {
  const value = String(decision || "").toUpperCase();
  if (value.includes("BLOCK") || riskScore >= 80) {
    return "border-rose-300/45 bg-rose-300/15 text-textPrimary";
  }
  if (value.includes("REVIEW") || riskScore >= 50) {
    return "border-amber-300/45 bg-amber-300/15 text-textPrimary";
  }
  if (value.includes("ALLOW") || value.includes("COMPLETE")) {
    return "border-accent/30 bg-accent/10 text-accent";
  }
  return "border-line bg-white/[0.04] text-textSecondary";
}

function compactJson(value: unknown) {
  if (!value || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length)) {
    return "No captured metadata.";
  }
  return JSON.stringify(value, null, 2);
}

function eventStage(record: ApiRecord) {
  return readText(record, ["stage"]) || readNestedText(record, ["metadata", "stage"]) || "runtime";
}

function evidenceText(record: ApiRecord) {
  return [
    readText(record, ["event_id", "review_id", "policy_id"]),
    readText(record, ["decision", "status"]),
    readText(record, ["risk_type"]),
    readText(record, ["agent_id"]),
    readText(record, ["tool_name"]),
    eventStage(record),
    readText(record, ["session_id"]),
    readText(record, ["workflow_id"]),
    readText(record, ["reason"]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function uniqueTextOptions(records: ApiRecord[], keys: string[]) {
  return [
    "ALL",
    ...Array.from(new Set(records.map((record) => readText(record, keys)).filter(Boolean) as string[])).sort(),
  ];
}

function eventWorkflowKey(event: ApiRecord) {
  return readText(event, ["workflow_id"]) || readText(event, ["session_id"]) || "unlinked";
}

function eventCreatedAtMs(event: ApiRecord) {
  const value = readText(event, ["created_at"]);
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function dateRangeMatches(event: ApiRecord, range: string) {
  if (range === "ALL") {
    return true;
  }
  const createdAt = eventCreatedAtMs(event);
  if (!createdAt) {
    return false;
  }
  const ageMs = Date.now() - createdAt;
  if (range === "24H") {
    return ageMs <= 24 * 60 * 60 * 1000;
  }
  if (range === "7D") {
    return ageMs <= 7 * 24 * 60 * 60 * 1000;
  }
  return true;
}

function EvidenceBadge({
  children,
  tone = "neutral",
}: {
  children: string;
  tone?: "allow" | "block" | "review" | "neutral";
}) {
  const toneClass = {
    allow: "border-accent/35 bg-accent/10 text-accent",
    block: "border-rose-300/45 bg-rose-300/15 text-textPrimary",
    neutral: "border-line bg-white/[0.04] text-textSecondary",
    review: "border-amber-300/45 bg-amber-300/15 text-textPrimary",
  }[tone];

  return (
    <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${toneClass}`}>
      {children}
    </span>
  );
}

function decisionBadgeTone(decision: string | undefined, riskScore = 0): "allow" | "block" | "review" | "neutral" {
  const value = String(decision || "").toUpperCase();
  if (value.includes("BLOCK") || riskScore >= 80) {
    return "block";
  }
  if (value.includes("REVIEW") || riskScore >= 50) {
    return "review";
  }
  if (value.includes("ALLOW") || value.includes("APPROVED")) {
    return "allow";
  }
  return "neutral";
}

type RuntimeGraphStatus = "pending" | "running" | "success" | "failed" | "review";

type RuntimeGraphNode = {
  agentId: string;
  id: string;
  label: string;
  nodeType: string;
  status: RuntimeGraphStatus;
};

type RuntimeGraphEdge = {
  from: string;
  status: RuntimeGraphStatus;
  to: string;
};

function runtimeStatusTone(status: RuntimeGraphStatus) {
  return {
    failed: "border-rose-300/60 bg-rose-300/15 text-rose-100",
    pending: "border-line bg-white/[0.04] text-textSecondary",
    review: "border-amber-300/60 bg-amber-300/15 text-amber-100",
    running: "border-sky-300/60 bg-sky-300/15 text-sky-100",
    success: "border-accent/50 bg-accent/12 text-accent",
  }[status];
}

function runtimeStatusStroke(status: RuntimeGraphStatus) {
  return {
    failed: "#fb7185",
    pending: "rgba(255,255,255,0.24)",
    review: "#fbbf24",
    running: "#38bdf8",
    success: "#2bd4aa",
  }[status];
}

function runtimeStatusLabel(status: RuntimeGraphStatus) {
  return {
    failed: "Failed",
    pending: "Pending",
    review: "Review",
    running: "Running",
    success: "Done",
  }[status];
}

function sessionStepId(session: ApiRecord, index: number) {
  return readNestedText(session, ["metadata", "step_id"])
    || readText(session, ["role", "agent_id"])
    || `step-${index + 1}`;
}

function sessionRuntimeStatus(session: ApiRecord, auditEvents: ApiRecord[], reviewItems: ApiRecord[]): RuntimeGraphStatus {
  const value = (joinParts([
    readNestedText(session, ["session", "status"]),
    ...auditEvents.map((event) => readText(event, ["decision"])),
    ...reviewItems.map((review) => readText(review, ["status"])),
    ...asRecords(session.events).map((event) => readText(event, ["status", "event_type"])),
  ]) || "").toUpperCase();

  if (reviewItems.some((review) => (readText(review, ["status"]) || "PENDING") === "PENDING") || value.includes("REVIEW")) {
    return "review";
  }
  if (value.includes("BLOCK") || value.includes("FAIL") || value.includes("ERROR") || value.includes("DENIED")) {
    return "failed";
  }
  if (value.includes("RUNNING") || value.includes("STARTED") || value.includes("IN_PROGRESS")) {
    return "running";
  }
  if (value.includes("COMPLETE") || value.includes("ALLOW") || value.includes("APPROVED")) {
    return "success";
  }
  return "pending";
}

function workflowGraphDefinitionNodes(workflow: ApiRecord, workflowDefinition: ApiRecord | undefined, sessions: ApiRecord[]) {
  const definitionNodes = asRecords(workflowDefinition?.nodes);
  if (definitionNodes.length) {
    return definitionNodes.map((node) => ({
      agentId: readText(node, ["agent_id"]) || "",
      id: readText(node, ["node_id", "step_id"]) || "",
      label: readText(node, ["label", "node_id", "step_id"]) || "Workflow node",
      nodeType: readText(node, ["node_type"]) || "task_agent",
    })).filter((node) => node.id);
  }

  const definitionSteps = asRecords(workflowDefinition?.steps);
  if (definitionSteps.length) {
    return [
      {
        agentId: readText(workflow, ["lead_agent_id"]) || readText(workflowDefinition || {}, ["lead_agent_id"]) || "",
        id: "lead",
        label: "Lead routing",
        nodeType: "lead_agent",
      },
      ...definitionSteps.map((step) => ({
        agentId: readText(step, ["agent_id"]) || "",
        id: readText(step, ["step_id"]) || "",
        label: readText(step, ["label", "step_id"]) || "Workflow step",
        nodeType: readText(step, ["node_type"]) || "task_agent",
      })).filter((node) => node.id),
    ];
  }

  return sessions.map((session, index) => ({
    agentId: readText(session, ["agent_id"]) || "",
    id: sessionStepId(session, index),
    label: readText(session, ["role"]) || sessionStepId(session, index),
    nodeType: readNestedText(session, ["agent_identity", "agent_type"]) || "agent",
  }));
}

function workflowGraphDefinitionEdges(nodes: RuntimeGraphNode[], workflowDefinition: ApiRecord | undefined, workflow: ApiRecord) {
  const definitionEdges = asRecords(workflowDefinition?.edges);
  const metadata = objectValue(workflow, "metadata");
  const metadataEdges = asRecords(metadata.workflow_connections);
  const edges = definitionEdges.length ? definitionEdges : metadataEdges;

  if (edges.length) {
    return edges.map((edge) => ({
      from: readText(edge, ["from_node_id", "from"]) || "",
      to: readText(edge, ["to_node_id", "to"]) || "",
    })).filter((edge) => edge.from && edge.to);
  }

  return nodes.slice(1).map((node, index) => ({
    from: nodes[index].id,
    to: node.id,
  }));
}

function runtimeGraphModel({
  auditEvents,
  detail,
  reviewItems,
  workflow,
  workflowDefinition,
}: {
  auditEvents: ApiRecord[];
  detail: ApiRecord;
  reviewItems: ApiRecord[];
  workflow: ApiRecord;
  workflowDefinition: ApiRecord | undefined;
}) {
  const sessions = asRecords(detail.sessions);
  const sessionStatuses = new Map<string, RuntimeGraphStatus>();
  sessions.forEach((session, index) => {
    const sessionId = readText(session, ["session_id"]);
    const stepId = sessionStepId(session, index);
    const sessionAudits = auditEvents.filter((event) => readText(event, ["session_id"]) === sessionId);
    const sessionReviews = reviewItems.filter((review) => readText(review, ["session_id"]) === sessionId);
    sessionStatuses.set(stepId, sessionRuntimeStatus(session, sessionAudits, sessionReviews));
  });

  const nodes: RuntimeGraphNode[] = workflowGraphDefinitionNodes(workflow, workflowDefinition, sessions).map((node, index) => {
    const status = sessionStatuses.get(node.id)
      || (index === 0 && !sessions.length && String(readText(workflow, ["status"]) || "").toUpperCase().includes("RUNNING") ? "running" : "pending");
    return { ...node, status };
  });

  const runningWorkflow = String(readText(workflow, ["status"]) || "").toUpperCase().includes("RUNNING");
  if (runningWorkflow && nodes.length && !nodes.some((node) => node.status === "running" || node.status === "failed" || node.status === "review")) {
    const firstPending = nodes.find((node) => node.status === "pending");
    if (firstPending) {
      firstPending.status = "running";
    }
  }

  const edgeSpecs = workflowGraphDefinitionEdges(nodes, workflowDefinition, workflow);
  const edges: RuntimeGraphEdge[] = edgeSpecs.map((edge) => {
    const target = nodes.find((node) => node.id === edge.to);
    const source = nodes.find((node) => node.id === edge.from);
    const status = target?.status === "failed" || source?.status === "failed"
      ? "failed"
      : target?.status === "review" || source?.status === "review"
        ? "review"
        : target?.status === "running" || source?.status === "running"
          ? "running"
          : target?.status === "success" && source?.status === "success"
            ? "success"
            : "pending";
    return { ...edge, status };
  });

  return { edges, nodes };
}

function WorkflowRuntimeGraph({
  auditEvents,
  detail,
  reviewItems,
  workflow,
  workflowDefinition,
}: {
  auditEvents: ApiRecord[];
  detail: ApiRecord;
  reviewItems: ApiRecord[];
  workflow: ApiRecord;
  workflowDefinition: ApiRecord | undefined;
}) {
  const { edges, nodes } = runtimeGraphModel({ auditEvents, detail, reviewItems, workflow, workflowDefinition });
  const width = Math.max(760, nodes.length * 210);
  const height = 260;
  const positions = new Map(
    nodes.map((node, index) => [
      node.id,
      {
        x: 90 + index * Math.max(160, (width - 180) / Math.max(1, nodes.length - 1)),
        y: index % 2 ? 152 : 88,
      },
    ]),
  );

  if (!nodes.length) {
    return (
      <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
        <ComponentRow title="No runtime graph" detail="This run does not have a registered graph or linked step sessions yet." />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-textPrimary">Runtime graph</p>
          <p className="mt-1 text-xs text-textSecondary">Node and edge state is derived from workflow sessions, review items, and audit events.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-textSecondary">
          {(["running", "success", "review", "failed", "pending"] as RuntimeGraphStatus[]).map((status) => (
            <span key={status} className={`rounded-full border px-2.5 py-1 ${runtimeStatusTone(status)}`}>
              {runtimeStatusLabel(status)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <div className="relative" style={{ width, height }}>
          <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`}>
            {edges.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) {
                return null;
              }
              return (
                <line
                  key={`${edge.from}->${edge.to}`}
                  x1={from.x + 72}
                  y1={from.y + 38}
                  x2={to.x - 72}
                  y2={to.y + 38}
                  stroke={runtimeStatusStroke(edge.status)}
                  strokeDasharray={edge.status === "pending" ? "6 6" : undefined}
                  strokeLinecap="round"
                  strokeWidth={3}
                />
              );
            })}
          </svg>
          {nodes.map((node) => {
            const position = positions.get(node.id) || { x: 0, y: 0 };
            return (
              <div
                key={node.id}
                className={`absolute w-40 rounded-2xl border p-3 shadow-lg ${runtimeStatusTone(node.status)}`}
                style={{ left: position.x - 80, top: position.y }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold uppercase tracking-[0.12em]">{runtimeStatusLabel(node.status)}</span>
                  <span className={`h-2.5 w-2.5 rounded-full ${node.status === "running" ? "animate-pulse bg-sky-300" : "bg-current"}`} />
                </div>
                <p className="mt-2 truncate text-sm font-semibold text-textPrimary">{node.label}</p>
                <p className="mt-1 truncate text-xs text-textSecondary">{joinParts([node.id, node.nodeType])}</p>
                {node.agentId ? <p className="mt-1 truncate text-xs text-textSecondary">{node.agentId}</p> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WorkflowTraceGroup({
  auditEvents,
  detail,
  expanded,
  onAuditEventsSelect,
  onRerun,
  onToggle,
  reviewQueue,
  running,
  workflow,
  workflowDefinitions,
}: {
  auditEvents: ApiRecord[];
  detail: ApiRecord;
  expanded: boolean;
  onAuditEventsSelect: (workflowIdOrSessionId: string) => void;
  onRerun: () => void;
  onToggle: () => void;
  reviewQueue: ApiRecord[];
  running: boolean;
  workflow: ApiRecord;
  workflowDefinitions: ApiRecord[];
}) {
  const workflowId = readText(workflow, ["workflow_id"]) || readText(detail, ["workflow_id"]) || "";
  const sessions = asRecords(detail.sessions);
  const workflowAudits = auditEvents.filter((event) => readText(event, ["workflow_id"]) === workflowId);
  const sessionIds = new Set(sessions.map((session) => readText(session, ["session_id"])).filter(Boolean));
  const workflowReviews = reviewQueue.filter((review) => {
    const sessionId = readText(review, ["session_id"]);
    return Boolean(sessionId && sessionIds.has(sessionId));
  });
  const maxRisk = Math.max(0, ...workflowAudits.map((event) => numberValue(event, ["risk_score"])));
  const decision = readText(workflow, ["decision", "status"]) || readText(detail, ["decision", "status"]);
  const createdAt = formatTimestamp(readText(workflow, ["created_at"]) || readText(detail, ["created_at"]));
  const updatedAt = formatTimestamp(readText(workflow, ["updated_at"]) || readText(detail, ["updated_at"]));
  const definitionId = workflowDefinitionId(workflow, detail);
  const workflowDefinition = workflowDefinitions.find(
    (definition) => readText(definition, ["workflow_definition_id"]) === definitionId,
  );
  const domain = workflowDomain(workflow, detail);
  const metadata = objectValue(workflow, "metadata");

  return (
    <article className="glass-card rounded-3xl p-5">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Workflow run</span>
          <h3 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
            {readText(workflow, ["name", "workflow_id"]) || "Workflow run"}
          </h3>
          <p className="mt-2 text-sm leading-6 text-textSecondary">
            {readText(workflow, ["user_goal", "summary"]) || readText(detail, ["user_goal", "summary"]) || "Grouped workflow trace."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-textSecondary">
            <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1">{workflowId || "workflow"}</span>
            <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1">{definitionId || "no definition"}</span>
            <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1">{domain}</span>
            <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1">{readText(workflow, ["lead_agent_id"]) || "lead unknown"}</span>
            {createdAt ? <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1">created {createdAt}</span> : null}
            {updatedAt ? <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1">updated {updatedAt}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${decisionTone(decision, maxRisk)}`}>
            {decision || "RUNNING"}
          </span>
          <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1 text-xs text-textSecondary">
            {sessions.length || readText(workflow, ["session_count"]) || 0} steps
          </span>
          <button
            type="button"
            disabled={!workflowId}
            onClick={() => onAuditEventsSelect(workflowId)}
            className="rounded-full border border-fuchsia-300/25 bg-fuchsia-300/10 px-3 py-1 text-xs font-semibold text-fuchsia-100 transition hover:border-fuchsia-300/45 hover:bg-fuchsia-300/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {formatCount(workflowAudits.length, "audit event")}
          </button>
          <span className={`rounded-full border px-3 py-1 text-xs text-textSecondary ${decisionTone(undefined, maxRisk)}`}>
            risk {maxRisk}
          </span>
          <button
            type="button"
            disabled={!definitionId || running}
            onClick={onRerun}
            className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent transition hover:border-accent/45 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCw size={13} aria-hidden="true" />
            {running ? "Running" : "Run again"}
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.04] px-3 py-1 text-xs font-semibold text-textPrimary transition hover:border-accent/35 hover:bg-accent/10"
            aria-expanded={expanded}
          >
            <ChevronDown size={13} className={`transition ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
            {expanded ? "Hide details" : "Details"}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-5 grid gap-4">
          <WorkflowRuntimeGraph
            auditEvents={workflowAudits}
            detail={detail}
            reviewItems={workflowReviews}
            workflow={workflow}
            workflowDefinition={workflowDefinition}
          />

          <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
              <FileJson size={15} className="text-accent" aria-hidden="true" />
              Workflow metadata
            </div>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink/70 p-3 font-mono text-xs leading-5 text-textPrimary">
              {compactJson({ workflow_id: workflowId, workflow_definition_id: definitionId, domain, ...metadata })}
            </pre>
          </div>

          <div className="grid gap-3">
            {sessions.length ? (
              sessions.map((session, index) => (
                <WorkflowStepTrace
                  key={readText(session, ["session_id"]) || index}
                  auditEvents={workflowAudits.filter((event) => readText(event, ["session_id"]) === readText(session, ["session_id"]))}
                  index={index}
                  onAuditEventsSelect={onAuditEventsSelect}
                  reviewItems={workflowReviews.filter((review) => readText(review, ["session_id"]) === readText(session, ["session_id"]))}
                  session={session}
                />
              ))
            ) : (
              <ComponentRow
                title="No step detail available"
                detail="This run has no linked step sessions yet. New workflow executions will appear here by step."
              />
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function WorkflowStepTrace({
  auditEvents,
  index,
  onAuditEventsSelect,
  reviewItems,
  session,
}: {
  auditEvents: ApiRecord[];
  index: number;
  onAuditEventsSelect: (workflowIdOrSessionId: string) => void;
  reviewItems: ApiRecord[];
  session: ApiRecord;
}) {
  const events = asRecords(session.events);
  const sessionId = readText(session, ["session_id"]) || "";
  const eventStatuses = events.map((event) => readText(event, ["status", "event_type"])).filter(Boolean);
  const decisions = [
    ...auditEvents.map((event) => readText(event, ["decision"])),
    ...reviewItems.map((item) => (readText(item, ["status"]) === "PENDING" ? "REVIEW" : readText(item, ["status"]))),
    ...eventStatuses,
  ].filter(Boolean);
  const maxRisk = Math.max(
    0,
    ...auditEvents.map((event) => numberValue(event, ["risk_score"])),
    ...reviewItems.map((item) => numberValue(item, ["risk_score"])),
    ...events.map((event) => {
      const payload = event.payload;
      return payload && typeof payload === "object" && !Array.isArray(payload)
        ? numberValue(payload as ApiRecord, ["risk_score"])
        : 0;
    }),
  );
  const decision = decisions.find((item) => String(item).toUpperCase().includes("BLOCK"))
    || decisions.find((item) => String(item).toUpperCase().includes("REVIEW"))
    || decisions.find((item) => String(item).toUpperCase().includes("ALLOW"))
    || readNestedText(session, ["session", "status"])
    || "RECORDED";
  const stepId = readNestedText(session, ["metadata", "step_id"]) || readText(session, ["role", "agent_id"]) || `step-${index + 1}`;
  const title = readText(session, ["agent_id"]) || readNestedText(session, ["agent_identity", "display_name"]) || stepId;
  const eventSummary = events
    .slice(0, 4)
    .map((event) => joinParts([readText(event, ["event_type"]), readText(event, ["status"])]))
    .filter(Boolean)
    .join(" -> ");
  const auditSummary = auditEvents
    .slice(0, 2)
    .map((event) => joinParts([readText(event, ["tool_name"]), readText(event, ["risk_type"]), readText(event, ["reason"])]))
    .filter(Boolean)
    .join(" | ");
  const createdAt = formatTimestamp(readText(session, ["created_at"]));

  return (
    <div className="grid gap-4 rounded-2xl border border-line bg-white/[0.035] p-4 lg:grid-cols-[auto_1fr_auto] lg:items-start">
      <div className={`grid h-12 w-12 place-items-center rounded-2xl border text-sm font-semibold ${decisionTone(decision, maxRisk)}`}>
        {index + 1}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-textPrimary">{stepId}</p>
          <span className="text-sm text-textSecondary">{title}</span>
          {createdAt ? <span className="text-xs text-textSecondary">{createdAt}</span> : null}
        </div>
        <p className="mt-2 text-sm leading-6 text-textSecondary">
          {readNestedText(session, ["session", "user_query"]) || readText(session, ["role"]) || "Workflow step."}
        </p>
        {eventSummary ? <p className="mt-2 text-xs text-textSecondary">{eventSummary}</p> : null}
        {auditSummary ? <p className="mt-2 text-xs text-textSecondary">{auditSummary}</p> : null}
        {reviewItems.length ? (
          <p className="mt-2 text-xs text-textPrimary">{formatCount(reviewItems.length, "review item")} pending or recorded.</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        <button
          type="button"
          disabled={!sessionId}
          onClick={() => onAuditEventsSelect(sessionId)}
          className="rounded-full border border-fuchsia-300/25 bg-fuchsia-300/10 px-3 py-1 text-xs font-semibold text-fuchsia-100 transition hover:border-fuchsia-300/45 hover:bg-fuchsia-300/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {formatCount(auditEvents.length, "audit event")}
        </button>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${decisionTone(decision, maxRisk)}`}>
          {decision}
        </span>
        <span className={`rounded-full border px-3 py-1 text-xs ${decisionTone(undefined, maxRisk)}`}>risk {maxRisk}</span>
      </div>
    </div>
  );
}

function PolicyControlCard({ policy }: { policy: ApiRecord }) {
  const config = objectValue(policy, "config");
  const thresholds = objectValue(config, "decision_thresholds");
  const reviewThreshold = numberValue(thresholds, ["review"]) || 50;
  const blockThreshold = numberValue(thresholds, ["block"]) || 80;
  const allowedTools = stringArrayValue(config, "allowed_tools");
  const blockedTools = stringArrayValue(config, "blocked_tools");
  const blockedPatterns = stringArrayValue(config, "blocked_patterns");
  const reviewRequiredFor = stringArrayValue(config, "review_required_for");
  const maxRecords = numberValue(config, ["max_records_returned"]) || 100;
  const policyName = readText(policy, ["display_name", "policy_id", "name"]) || "Guardrail policy";
  const argumentRules = objectEntries(objectValue(config, "tool_argument_rules"));
  const sideEffectControls = objectEntries(objectValue(config, "tool_side_effect_controls"));
  const reviewGatedSideEffects = sideEffectControls.filter(([, control]) => boolValue(control, ["requires_review"]));

  return (
    <article className="glass-card rounded-3xl p-5">
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <EvidenceBadge tone="allow">{readText(policy, ["environment"]) || "environment"}</EvidenceBadge>
            <EvidenceBadge>{readText(policy, ["policy_id"]) || "policy"}</EvidenceBadge>
          </div>
          <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em]">{policyName}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-textSecondary">
            {readText(policy, ["description"]) || "Runtime guardrail policy for tool access, data exposure, review routing, and response safety."}
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            <PolicyMetric label="Allowed tools" value={String(allowedTools.length)} detail={allowedTools.slice(0, 3).join(", ") || "No allowlist"} />
            <PolicyMetric label="Blocked tools" value={String(blockedTools.length)} detail={blockedTools.slice(0, 3).join(", ") || "No explicit blocklist"} />
            <PolicyMetric label="Max records" value={String(maxRecords)} detail="Post-tool result limit" />
            <PolicyMetric label="Arg rules" value={String(argumentRules.length)} detail="Pre-tool validation" />
            <PolicyMetric label="Side effects" value={String(reviewGatedSideEffects.length)} detail="Review-gated tools" />
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-textPrimary">
            <SlidersHorizontal size={16} className="text-accent" aria-hidden="true" />
            Decision thresholds
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-textSecondary">
              <span>Allow</span>
              <span>Review {reviewThreshold}</span>
              <span>Block {blockThreshold}</span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full border border-line bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent via-amber-300 to-rose-300"
                style={{ width: `${Math.min(100, Math.max(0, blockThreshold))}%` }}
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-textSecondary">
              Scores below {reviewThreshold} allow, {reviewThreshold}-{blockThreshold - 1} route to review, and {blockThreshold}+ block.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <PolicyControlSection
          title="Argument validation"
          detail="Pre-tool checks for required args, scope binding, filters, and limits."
          items={argumentRules.map(([toolName, rule]) => argumentRuleSummary(toolName, rule))}
          emptyText="No argument rules configured"
        />
        <PolicyControlSection
          title="Side-effect controls"
          detail="Write or external actions that require review before execution."
          items={sideEffectControls.map(([toolName, control]) => sideEffectSummary(toolName, control))}
          emptyText="No side-effect controls configured"
        />
        <PolicyControlSection
          title="Human review routing"
          detail="Risk types that pause execution for a reviewer."
          items={reviewRequiredFor}
          emptyText="No review-required risks configured"
        />
        <PolicyControlSection
          title="Response safety"
          detail="Final-response controls after tool execution."
          items={[
            boolValue(config, ["block_pii_in_response"]) ? "Block PII in final response" : "PII block disabled",
            boolValue(config, ["redact_pii_in_response"]) ? "Redact PII before return" : "PII redaction disabled",
          ]}
          emptyText="No response controls"
        />
        <PolicyControlSection
          title="Blocked patterns"
          detail="Prompt or output phrases that trigger governance."
          items={blockedPatterns.slice(0, 4)}
          emptyText="No blocked patterns"
        />
      </div>
    </article>
  );
}

function PolicyMetric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{value}</p>
      <p className="mt-1 truncate text-xs text-textSecondary">{detail}</p>
    </div>
  );
}

function PolicyControlSection({
  detail,
  emptyText,
  items,
  title,
}: {
  detail: string;
  emptyText: string;
  items: string[];
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
      <p className="font-semibold text-textPrimary">{title}</p>
      <p className="mt-1 text-xs leading-5 text-textSecondary">{detail}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length ? items.map((item) => <EvidenceBadge key={item}>{item}</EvidenceBadge>) : <span className="text-xs text-textSecondary">{emptyText}</span>}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="inline-flex min-h-11 items-center gap-3 rounded-2xl border border-line bg-white/[0.045] px-4">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-textSecondary">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 bg-transparent text-sm font-semibold text-textPrimary outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

type ReviewActionStatus = "APPROVED" | "DENIED";

function reviewSla(review: ApiRecord) {
  const createdAt = eventCreatedAtMs(review);
  const ageMinutes = createdAt ? Math.max(0, Math.floor((Date.now() - createdAt) / 60000)) : 0;
  const slaMinutes = numberValue(review, ["sla_minutes"]) || 60;
  const remaining = slaMinutes - ageMinutes;
  const status = remaining <= 0 ? "breached" : remaining <= Math.ceil(slaMinutes * 0.2) ? "approaching" : "within SLA";
  return {
    ageMinutes,
    escalationOwner: readText(review, ["escalation_owner"]) || "Governance Lead",
    remaining,
    slaMinutes,
    status,
  };
}

function ReviewEvidenceCard({
  onResolved,
  review,
}: {
  onResolved: () => void;
  review: ApiRecord;
}) {
  const riskScore = numberValue(review, ["risk_score"]);
  const status = readText(review, ["status"]) || "PENDING";
  const toolArgs = objectValue(review, "tool_args");
  const reviewId = readText(review, ["review_id"]) || "Review item";
  const isPending = status === "PENDING";
  const existingNote = readText(review, ["reviewer_note"]);
  const resolvedAt = readText(review, ["resolved_at"]);
  const sla = reviewSla(review);

  // PENDING items start expanded so the action is immediately visible
  const [isExpanded, setIsExpanded] = useState(isPending);
  const [reviewerNote, setReviewerNote] = useState("");
  const [activeAction, setActiveAction] = useState<ReviewActionStatus | "">("");
  const [message, setMessage] = useState("");
  const trimmedNote = reviewerNote.trim();
  const denyDisabled = !trimmedNote || Boolean(activeAction);
  const approveDisabled = Boolean(activeAction);

  async function submitReviewDecision(nextStatus: ReviewActionStatus) {
    setMessage("");
    if (nextStatus === "DENIED" && !trimmedNote) {
      setMessage("Add a reviewer note before denying this request.");
      return;
    }

    const session = getSession();
    if (!session?.token) {
      setMessage("Sign in again before resolving review items.");
      return;
    }

    try {
      setActiveAction(nextStatus);
      await resolveReview(session.token, reviewId, {
        status: nextStatus,
        reviewer_note: trimmedNote || undefined,
      });
      setMessage(`Review ${nextStatus.toLowerCase()}.`);
      onResolved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to resolve this review item.");
    } finally {
      setActiveAction("");
    }
  }

  return (
    <article className="glass-card rounded-3xl overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full p-5 text-left"
      >
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <EvidenceBadge tone={decisionBadgeTone(status, riskScore)}>{status}</EvidenceBadge>
              <EvidenceBadge tone="review">{`risk ${riskScore}`}</EvidenceBadge>
              <EvidenceBadge tone={sla.status === "breached" ? "block" : sla.status === "approaching" ? "review" : "neutral"}>
                {`waiting ${sla.ageMinutes}m`}
              </EvidenceBadge>
              {riskTypes(review).map((riskType) => <EvidenceBadge key={riskType}>{riskType}</EvidenceBadge>)}
            </div>
            <h3 className="mt-3 text-xl font-semibold tracking-[-0.02em]">
              {readText(review, ["tool_name"]) || "Tool request"} requires human review
            </h3>
            <p className="mt-1 text-sm leading-6 text-textSecondary">{readText(review, ["reason"]) || "Policy routed this action to review."}</p>
          </div>
          <div className="flex shrink-0 items-start gap-3">
            <div className="grid gap-1 text-right text-xs text-textSecondary">
              <span>{formatTimestamp(readText(review, ["created_at"]))}</span>
              <span>{readText(review, ["environment"]) || "—"}</span>
              <span className="font-mono">{reviewId}</span>
            </div>
            <ChevronDown
              size={18}
              aria-hidden="true"
              className={`mt-1 shrink-0 text-textSecondary transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
            />
          </div>
        </div>
      </button>

      {/* Expandable body */}
      {isExpanded && (
        <div className="border-t border-line px-5 pb-5 pt-4">
          <div className="grid gap-3 lg:grid-cols-3">
            <ReviewField label="Agent" value={readText(review, ["agent_id"]) || "Unknown agent"} />
            <ReviewField label="Workflow/session" value={joinParts([readText(review, ["workflow_id"]), readText(review, ["session_id"])]) || "No workflow link"} />
            <ReviewField label="Requested action" value={readText(review, ["tool_name"]) || "No tool recorded"} />
            <ReviewField
              label="SLA"
              value={
                sla.status === "breached"
                  ? `Breached ${Math.abs(sla.remaining)}m ago / escalate to ${sla.escalationOwner}`
                  : `${sla.status} / ${sla.remaining}m remaining`
              }
            />
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <ReviewEvidenceBlock label="User request" value={readText(review, ["user_query"]) || "No user request captured."} />
            <ReviewEvidenceBlock label="Tool arguments" value={compactJson(toolArgs)} monospace />
          </div>

          {/* Human review section */}
          <div className="mt-4 rounded-2xl border border-line bg-white/[0.035] p-4">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
              Human review
            </span>
            {isPending ? (
              <>
                <label className="mt-3 block">
                  <textarea
                    value={reviewerNote}
                    onChange={(event) => setReviewerNote(event.target.value)}
                    placeholder="Add decision context. Required for deny."
                    className="mt-1 min-h-24 w-full resize-y rounded-2xl border border-line bg-ink/70 p-3 text-sm leading-6 text-textPrimary outline-none placeholder:text-textSecondary focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
                  />
                </label>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => submitReviewDecision("APPROVED")}
                    disabled={approveDisabled}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-accent/45 bg-accent/12 px-5 py-2 text-sm font-semibold text-textPrimary transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <CheckCircle2 size={17} aria-hidden="true" />
                    {activeAction === "APPROVED" ? "Approving..." : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => submitReviewDecision("DENIED")}
                    disabled={denyDisabled}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-rose-300/45 bg-rose-300/12 px-5 py-2 text-sm font-semibold text-textPrimary transition hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <XCircle size={17} aria-hidden="true" />
                    {activeAction === "DENIED" ? "Denying..." : "Deny"}
                  </button>
                  {message ? <span className="text-sm text-textSecondary">{message}</span> : null}
                </div>
              </>
            ) : (
              <div className="mt-3 grid gap-2">
                <p className="text-sm text-textPrimary">
                  {existingNote || <span className="text-textSecondary italic">No reviewer note recorded.</span>}
                </p>
                {resolvedAt && (
                  <p className="text-xs text-textSecondary">{`Resolved ${formatTimestamp(resolvedAt)}`}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function ReviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">{label}</p>
      <p className="mt-2 break-words text-sm font-semibold text-textPrimary">{value}</p>
    </div>
  );
}

function ReviewEvidenceBlock({ label, monospace = false, value }: { label: string; monospace?: boolean; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">{label}</p>
      <p className={`mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-textPrimary ${monospace ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}

const STAGE_LABELS: Record<string, string> = {
  pre_tool: "Pre-tool",
  post_tool_result: "Post-tool",
  final_response: "Final",
  runtime: "Runtime",
};

function stageShort(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");
}

function AuditEventRow({
  event,
  expanded,
  onToggle,
}: {
  event: ApiRecord;
  expanded: boolean;
  onToggle: () => void;
}) {
  const riskScore = numberValue(event, ["risk_score"]);
  const decision = readText(event, ["decision"]) || "RECORDED";
  const metadata = objectValue(event, "metadata");
  const stage = eventStage(event);
  const toolName = readText(event, ["tool_name"]);
  const agentId = readText(event, ["agent_id"]);
  const riskType = readText(event, ["risk_type"]);
  const policyHash = readText(event, ["policy_snapshot_hash"]) || readNestedText(event, ["metadata", "policy_snapshot_hash"]);
  const policyId = readText(event, ["policy_id"]);
  const eventId = readText(event, ["event_id"]);
  const workflowId = readText(event, ["workflow_id"]);
  const sessionId = readText(event, ["session_id"]);
  const tone = decisionBadgeTone(decision, riskScore);
  const leftBorder =
    tone === "block" ? "border-l-[3px] border-l-rose-400"
    : tone === "review" ? "border-l-[3px] border-l-amber-400"
    : tone === "allow" ? "border-l-[3px] border-l-emerald-400"
    : "border-l-[3px] border-l-transparent";

  return (
    <div className={`border-b border-line last:border-b-0 ${leftBorder}`}>
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full gap-x-4 gap-y-2 px-5 py-4 text-left transition hover:bg-white/[0.035] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent/35 xl:grid-cols-[1fr_1.5fr_108px_96px_90px_1fr] xl:items-start"
      >
        {/* Col 1: agent */}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-textPrimary" title={agentId ?? undefined}>
            {agentId || "Unknown agent"}
          </p>
        </div>

        {/* Col 2: reason + chevron */}
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm leading-5 text-textSecondary">
                {readText(event, ["reason"]) || "Runtime evidence."}
              </p>
              <p className="mt-1 truncate text-xs text-textSecondary">
                {joinParts([workflowId ? `workflow ${workflowId}` : undefined, sessionId ? `session ${sessionId}` : undefined])}
              </p>
            </div>
            <ChevronDown
              className={`mt-0.5 shrink-0 text-textSecondary transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              size={18}
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Col 3: stage */}
        <div className="min-w-0">
          <EvidenceBadge>{stageShort(stage)}</EvidenceBadge>
          {toolName && (
            <p className="mt-1.5 truncate text-xs text-textSecondary" title={toolName}>{toolName}</p>
          )}
        </div>

        {/* Col 4: risk score + risk type */}
        <div className="min-w-0">
          <EvidenceBadge tone={decisionBadgeTone(undefined, riskScore)}>{`risk ${riskScore}`}</EvidenceBadge>
          {riskType && riskType !== "none" && (
            <p className="mt-1.5 truncate text-xs text-textSecondary" title={riskType}>{riskType.replace(/_/g, " ")}</p>
          )}
        </div>

        {/* Col 5: decision badge */}
        <div className="min-w-0">
          <EvidenceBadge tone={decisionBadgeTone(decision, riskScore)}>{decision}</EvidenceBadge>
        </div>

        {/* Col 6: timestamp as single line */}
        <div className="min-w-0">
          <p className="truncate text-sm text-textSecondary">
            {formatTimestamp(readText(event, ["created_at"])) || "—"}
          </p>
        </div>
      </button>

      {expanded && (
        <div className="grid gap-4 border-t border-line bg-ink/30 px-5 py-5 lg:grid-cols-[1fr_1fr]">
          <div className="grid gap-3">
            <ReviewField label="Agent" value={agentId || "Unknown agent"} />
            <ReviewField label="Tool" value={toolName || stage || "—"} />
            <ReviewField label="Workflow / session" value={joinParts([readText(event, ["workflow_id"]), readText(event, ["session_id"])]) || "No workflow link"} />
            <ReviewField label="Event ID" value={eventId || "—"} />
            <ReviewField label="Policy" value={policyId || "Not recorded"} />
            <ReviewField label="Policy snapshot hash" value={policyHash || "Not recorded"} />
          </div>
          <div className="rounded-2xl border border-line bg-white/[0.035] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-textSecondary">
              <FileJson size={15} className="text-accent" aria-hidden="true" />
              Raw JSON evidence
            </div>
            <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink/70 p-3 font-mono text-xs leading-5 text-textPrimary">
              {compactJson({ ...event, metadata })}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function RuntimePoliciesWorkspace({ data }: { data: PlatformData }) {
  if (!data.guardrailPolicies.length) {
    return (
      <section className="glass-card rounded-3xl p-6">
        <ComponentRow
          title="No runtime policies"
          detail="Create a guardrail policy to show enforced tools, thresholds, data controls, review routing, and final-response checks."
        />
      </section>
    );
  }

  return (
    <section className="grid gap-5">
      {data.guardrailPolicies.map((policy) => (
        <PolicyControlCard key={readText(policy, ["policy_id"]) || readText(policy, ["display_name"])} policy={policy} />
      ))}
    </section>
  );
}

export function ReviewQueueWorkspace({
  data,
  onRefresh,
}: {
  data: PlatformData;
  onRefresh: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [searchQuery, setSearchQuery] = useState("");
  const query = searchQuery.trim().toLowerCase();
  const filteredReviews = data.reviewQueue.filter((review) => {
    const status = readText(review, ["status"]) || "PENDING";
    const matchesStatus = statusFilter === "ALL" || status === statusFilter;
    const matchesQuery = !query || evidenceText(review).includes(query);
    return matchesStatus && matchesQuery;
  });
  const statuses = ["PENDING", "APPROVED", "DENIED", "ALL"];

  if (!data.reviewQueue.length) {
    return (
      <section className="glass-card rounded-3xl p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Review queue</span>
            <h3 className="mt-2 text-xl font-semibold">No reviews yet</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-textSecondary">
              Run a review-triggering scenario such as "Find customers in Melbourne and include their emails" to create a reviewer decision item.
            </p>
          </div>
          <EvidenceBadge tone="review">waiting for review path</EvidenceBadge>
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-5">
      <section className="glass-card rounded-3xl p-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-line bg-ink/55 px-3 text-sm text-textSecondary">
            <Search size={16} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search reviews by agent, tool, risk, workflow, or reason..."
              className="min-w-0 flex-1 bg-transparent text-textPrimary outline-none placeholder:text-textSecondary"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {statuses.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                  statusFilter === status
                    ? "border-accent/50 bg-accent/12 text-textPrimary"
                    : "border-line bg-white/[0.04] text-textSecondary hover:border-accent/35 hover:text-textPrimary"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </section>

      {filteredReviews.length ? (
        filteredReviews.map((review) => (
          <ReviewEvidenceCard
            key={readText(review, ["review_id"]) || readText(review, ["session_id"])}
            onResolved={onRefresh}
            review={review}
          />
        ))
      ) : (
        <section className="glass-card rounded-3xl p-6">
          <ComponentRow title="No matching reviews" detail="Adjust the status filter or search text." />
        </section>
      )}
    </section>
  );
}

function AuditEventGroup({
  events,
  expandedEventId,
  groupId,
  onExpandedEventChange,
}: {
  events: ApiRecord[];
  expandedEventId: string;
  groupId: string;
  onExpandedEventChange: (eventId: string) => void;
}) {
  const maxRisk = Math.max(...events.map((event) => numberValue(event, ["risk_score"])));
  const blocked = events.some((event) => decisionBadgeTone(readText(event, ["decision"]), numberValue(event, ["risk_score"])) === "block");
  const review = events.some((event) => decisionBadgeTone(readText(event, ["decision"]), numberValue(event, ["risk_score"])) === "review");
  const overall = blocked ? "BLOCK" : review ? "REVIEW" : "ALLOW";
  const primaryAgent = readText(events[0], ["agent_id"]) || "Unknown agent";
  const workflowId = readText(events[0], ["workflow_id"]);
  const sessionId = readText(events[0], ["session_id"]);

  return (
    <section className="border-b border-line last:border-b-0">
      <div className="grid gap-2 bg-white/[0.025] px-5 py-3 text-sm md:grid-cols-[1fr_auto_auto_auto] md:items-center">
        <div className="min-w-0">
          <p className="truncate font-semibold text-textPrimary">
            {workflowId ? `Workflow ${workflowId}` : sessionId ? `Session ${sessionId}` : groupId}
          </p>
          <p className="mt-1 truncate text-xs text-textSecondary">{joinParts([primaryAgent, formatCount(events.length, "event")])}</p>
        </div>
        <EvidenceBadge tone={decisionBadgeTone(overall, maxRisk)}>{overall}</EvidenceBadge>
        <EvidenceBadge tone={decisionBadgeTone(undefined, maxRisk)}>{`max risk ${maxRisk}`}</EvidenceBadge>
        <span className="text-xs text-textSecondary">{formatTimestamp(readText(events[0], ["created_at"]))}</span>
      </div>
      {events.map((event) => {
        const eventId = readText(event, ["event_id"]) || "";
        const expanded = expandedEventId === eventId;
        return (
          <AuditEventRow
            key={eventId || readText(event, ["created_at"])}
            event={event}
            expanded={expanded}
            onToggle={() => onExpandedEventChange(expanded ? "" : eventId)}
          />
        );
      })}
    </section>
  );
}

export function AuditEventsWorkspace({
  data,
  selectedWorkflowId,
}: {
  data: PlatformData;
  selectedWorkflowId: string;
}) {
  const [decisionFilter, setDecisionFilter] = useState("ALL");
  const [stageFilter, setStageFilter] = useState("ALL");
  const [riskTypeFilter, setRiskTypeFilter] = useState("ALL");
  const [agentFilter, setAgentFilter] = useState("ALL");
  const [toolFilter, setToolFilter] = useState("ALL");
  const [environmentFilter, setEnvironmentFilter] = useState("ALL");
  const [dateRangeFilter, setDateRangeFilter] = useState("ALL");
  const [sortMode, setSortMode] = useState("NEWEST");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedEventId, setExpandedEventId] = useState("");
  const query = searchQuery.trim().toLowerCase();
  const stages = ["ALL", ...Array.from(new Set(data.auditEvents.map(eventStage).filter(Boolean)))];
  const agents = uniqueTextOptions(data.auditEvents, ["agent_id"]);
  const tools = uniqueTextOptions(data.auditEvents, ["tool_name"]);
  const environments = uniqueTextOptions(data.auditEvents, ["environment"]);
  const riskTypeOptions = [
    "ALL",
    ...Array.from(
      new Set(
        data.auditEvents
          .map((event) => readText(event, ["risk_type"]))
          .filter((rt): rt is string => Boolean(rt) && rt !== "none"),
      ),
    ),
  ];

  const blockCount = data.auditEvents.filter((e) => decisionBadgeTone(readText(e, ["decision"]) || "", numberValue(e, ["risk_score"])) === "block").length;
  const reviewCount = data.auditEvents.filter((e) => decisionBadgeTone(readText(e, ["decision"]) || "", numberValue(e, ["risk_score"])) === "review").length;
  const allowCount = data.auditEvents.filter((e) => decisionBadgeTone(readText(e, ["decision"]) || "", numberValue(e, ["risk_score"])) === "allow").length;

  const filteredEvents = data.auditEvents.filter((event) => {
    const decision = readText(event, ["decision"]) || "";
    const stage = eventStage(event);
    const riskType = readText(event, ["risk_type"]) || "";
    const agentId = readText(event, ["agent_id"]) || "";
    const toolName = readText(event, ["tool_name"]) || "";
    const environment = readText(event, ["environment"]) || "";
    const tone = decisionBadgeTone(decision, numberValue(event, ["risk_score"]));
    const matchesDecision =
      decisionFilter === "ALL"
      || (decisionFilter === "BLOCK" && tone === "block")
      || (decisionFilter === "REVIEW" && tone === "review")
      || (decisionFilter === "ALLOW" && tone === "allow");
    return (
      matchesDecision
      && (!selectedWorkflowId || recordMatchesWorkflow(event, selectedWorkflowId))
      && (stageFilter === "ALL" || stage === stageFilter)
      && (riskTypeFilter === "ALL" || riskType === riskTypeFilter)
      && (agentFilter === "ALL" || agentId === agentFilter)
      && (toolFilter === "ALL" || toolName === toolFilter)
      && (environmentFilter === "ALL" || environment === environmentFilter)
      && dateRangeMatches(event, dateRangeFilter)
      && (!query || evidenceText(event).includes(query))
    );
  }).sort((first, second) => {
    if (sortMode === "RISK") {
      return numberValue(second, ["risk_score"]) - numberValue(first, ["risk_score"]);
    }
    if (sortMode === "BLOCKED") {
      const firstTone = decisionBadgeTone(readText(first, ["decision"]), numberValue(first, ["risk_score"]));
      const secondTone = decisionBadgeTone(readText(second, ["decision"]), numberValue(second, ["risk_score"]));
      const rank = { block: 3, review: 2, allow: 1, neutral: 0 };
      return rank[secondTone] - rank[firstTone] || eventCreatedAtMs(second) - eventCreatedAtMs(first);
    }
    if (sortMode === "WORKFLOW") {
      return eventWorkflowKey(first).localeCompare(eventWorkflowKey(second)) || eventCreatedAtMs(second) - eventCreatedAtMs(first);
    }
    return eventCreatedAtMs(second) - eventCreatedAtMs(first);
  });
  const groupedEvents = Array.from(
    filteredEvents.reduce<Map<string, ApiRecord[]>>((groups, event) => {
      const key = eventWorkflowKey(event);
      groups.set(key, [...(groups.get(key) || []), event]);
      return groups;
    }, new Map()),
  );

  if (!data.auditEvents.length) {
    return (
      <section className="glass-card rounded-3xl p-6">
        <ComponentRow title="No audit events" detail="Run governed agents or workflows to populate runtime evidence." />
      </section>
    );
  }

  return (
    <section className="grid gap-5">
      {/* Filter bar: pill buttons for decision + dropdowns for risk type / stage */}
      <section className="glass-card rounded-3xl p-5">
        <div className="grid gap-4">
          {selectedWorkflowId ? (
            <div className="rounded-2xl border border-fuchsia-300/25 bg-fuchsia-300/10 px-4 py-3 text-sm text-fuchsia-100">
              Showing audit evidence for workflow/session <span className="font-semibold">{selectedWorkflowId}</span>.
            </div>
          ) : null}
          <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-line bg-ink/55 px-3 text-sm text-textSecondary">
            <Search size={16} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search audit evidence by agent, tool, risk, workflow, session, or reason..."
              className="min-w-0 flex-1 bg-transparent text-textPrimary outline-none placeholder:text-textSecondary"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { label: `All (${data.auditEvents.length})`, value: "ALL" },
                  { label: `Block (${blockCount})`, value: "BLOCK" },
                  { label: `Review (${reviewCount})`, value: "REVIEW" },
                  { label: `Allow (${allowCount})`, value: "ALLOW" },
                ] as const
              ).map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDecisionFilter(value)}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                    decisionFilter === value
                      ? "border-accent/50 bg-accent/12 text-textPrimary"
                      : "border-line bg-white/[0.04] text-textSecondary hover:border-accent/35 hover:text-textPrimary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <FilterSelect label="Agent" value={agentFilter} options={agents} onChange={setAgentFilter} />
              <FilterSelect label="Tool" value={toolFilter} options={tools} onChange={setToolFilter} />
              <FilterSelect label="Environment" value={environmentFilter} options={environments} onChange={setEnvironmentFilter} />
              <FilterSelect label="Risk type" value={riskTypeFilter} options={riskTypeOptions} onChange={setRiskTypeFilter} />
              <FilterSelect label="Stage" value={stageFilter} options={stages} onChange={setStageFilter} />
              <FilterSelect label="Date" value={dateRangeFilter} options={["ALL", "24H", "7D"]} onChange={setDateRangeFilter} />
              <FilterSelect
                label="Sort"
                value={sortMode}
                options={["NEWEST", "RISK", "BLOCKED", "WORKFLOW"]}
                onChange={setSortMode}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Events table with fuchsia accent edge */}
      <section className="glass-card overflow-hidden rounded-3xl">
        <div className="pointer-events-none h-0.5 bg-gradient-to-r from-fuchsia-400/60 via-violet-400/35 to-transparent" />
        <div className="grid grid-cols-[1fr_1.5fr_108px_96px_90px_1fr] gap-x-4 border-b border-line px-5 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary max-xl:hidden">
          <span>Agent</span>
          <span>Reason</span>
          <span>Stage</span>
          <span>Risk</span>
          <span>Decision</span>
          <span>Time</span>
        </div>
        <div className="grid">
          {filteredEvents.length ? (
            sortMode === "WORKFLOW" ? (
              groupedEvents.map(([groupId, events]) => (
                <AuditEventGroup
                  key={groupId}
                  events={events}
                  expandedEventId={expandedEventId}
                  groupId={groupId}
                  onExpandedEventChange={setExpandedEventId}
                />
              ))
            ) : filteredEvents.map((event) => {
              const eventId = readText(event, ["event_id"]) || "";
              const expanded = expandedEventId === eventId;
              return (
                <AuditEventRow
                  key={eventId || readText(event, ["created_at"])}
                  event={event}
                  expanded={expanded}
                  onToggle={() => setExpandedEventId(expanded ? "" : eventId)}
                />
              );
            })
          ) : (
            <div className="p-5">
              <ComponentRow title="No matching audit events" detail="Adjust the filters or search text." />
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
