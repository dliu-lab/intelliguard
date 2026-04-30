"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ApiRecord, PlatformData } from "@/lib/api";
import { ComponentRow, RecordList } from "./shared";
import { formatCount, formatTimestamp, joinParts, readNestedText, readText } from "./utils";

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
    readText(workflow, ["created_at", "updated_at"]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function WorkflowTraceWorkspace({
  data,
  selectedWorkflowId,
}: {
  data: PlatformData;
  selectedWorkflowId: string;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const filteredWorkflowRuns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return selectedWorkflowId
        ? data.workflows.filter((workflow) => recordMatchesWorkflow(workflow, selectedWorkflowId))
        : data.workflows;
    }

    return data.workflows.filter((workflow) => workflowRunSearchText(workflow).includes(query));
  }, [data.workflows, searchQuery, selectedWorkflowId]);

  const workflowRuns = filteredWorkflowRuns;

  if (!data.workflows.length) {
    return (
      <section className="glass-card rounded-3xl p-6">
        <ComponentRow title="No workflow traces" detail="Run a workflow to create grouped trace evidence." />
      </section>
    );
  }

  return (
    <section className="grid gap-5">
      <section className="glass-card rounded-3xl p-5">
        <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-line bg-ink/55 px-3 text-sm text-textSecondary">
          <Search size={16} aria-hidden="true" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search workflow traces..."
            className="min-w-0 flex-1 bg-transparent text-textPrimary outline-none placeholder:text-textSecondary"
          />
        </label>
      </section>

      {workflowRuns.length ? (
        workflowRuns.map((workflow) => (
          <WorkflowTraceGroup
            key={workflowRunId(workflow) || readText(workflow, ["session_id"])}
            auditEvents={data.auditEvents}
            detail={
              data.workflowDetails.find(
                (item) => readText(item, ["workflow_id"]) === readText(workflow, ["workflow_id"]),
              ) || workflow
            }
            reviewQueue={data.reviewQueue}
            workflow={workflow}
          />
        ))
      ) : (
        <section className="glass-card rounded-3xl p-6">
          <ComponentRow title="No matching workflow traces" detail="Adjust the search to find another trace." />
        </section>
      )}
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

function WorkflowTraceGroup({
  auditEvents,
  detail,
  reviewQueue,
  workflow,
}: {
  auditEvents: ApiRecord[];
  detail: ApiRecord;
  reviewQueue: ApiRecord[];
  workflow: ApiRecord;
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
          <p className="mt-2 text-xs text-textSecondary">
            {joinParts([workflowId, createdAt ? `Created ${createdAt}` : undefined, updatedAt ? `Updated ${updatedAt}` : undefined])}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${decisionTone(decision, maxRisk)}`}>
            {decision || "RUNNING"}
          </span>
          <span className="rounded-full border border-line bg-white/[0.04] px-3 py-1 text-xs text-textSecondary">
            {sessions.length || readText(workflow, ["session_count"]) || 0} steps
          </span>
          <span className={`rounded-full border px-3 py-1 text-xs text-textSecondary ${decisionTone(undefined, maxRisk)}`}>
            risk {maxRisk}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {sessions.length ? (
          sessions.map((session, index) => (
            <WorkflowStepTrace
              key={readText(session, ["session_id"]) || index}
              auditEvents={workflowAudits.filter((event) => readText(event, ["session_id"]) === readText(session, ["session_id"]))}
              index={index}
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
    </article>
  );
}

function WorkflowStepTrace({
  auditEvents,
  index,
  reviewItems,
  session,
}: {
  auditEvents: ApiRecord[];
  index: number;
  reviewItems: ApiRecord[];
  session: ApiRecord;
}) {
  const events = asRecords(session.events);
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
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${decisionTone(decision, maxRisk)}`}>
          {decision}
        </span>
        <span className={`rounded-full border px-3 py-1 text-xs ${decisionTone(undefined, maxRisk)}`}>risk {maxRisk}</span>
      </div>
    </div>
  );
}

export function RuntimePoliciesWorkspace({ data }: { data: PlatformData }) {
  return (
    <RecordList
      rows={data.guardrailPolicies.map((policy) => ({
        title: readText(policy, ["display_name", "policy_id", "name"]) || "Guardrail policy",
        detail: readText(policy, ["description", "mode"]) || "Runtime policy.",
        meta: readText(policy, ["environment"]),
      }))}
      emptyText="Create a guardrail policy to populate this view."
    />
  );
}

export function ReviewQueueWorkspace({ data }: { data: PlatformData }) {
  return (
    <RecordList
      rows={data.reviewQueue.map((review) => ({
        title: readText(review, ["review_id", "action", "tool_name"]) || "Review item",
        detail: readText(review, ["reason", "agent_id", "session_id"]) || "Human review item.",
        meta: readText(review, ["status", "environment"]),
      }))}
      emptyText="No items currently require review."
    />
  );
}

export function AuditEventsWorkspace({ data }: { data: PlatformData }) {
  return (
    <RecordList
      rows={data.auditEvents.map((event) => ({
        title: readText(event, ["decision", "action", "tool_name", "event_type"]) || "Audit event",
        detail: readText(event, ["reason", "agent_id", "session_id"]) || "Runtime evidence.",
        meta: joinParts([readText(event, ["environment"]), readText(event, ["risk_score"])]),
      }))}
      emptyText="Run governed agents or workflows to populate audit evidence."
    />
  );
}
