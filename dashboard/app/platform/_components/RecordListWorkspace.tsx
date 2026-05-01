"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, FileJson, Search, SlidersHorizontal, XCircle } from "lucide-react";
import { getSession, resolveReview, type ApiRecord, type PlatformData } from "@/lib/api";
import { ComponentRow } from "./shared";
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

  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full gap-x-4 gap-y-2 px-5 py-4 text-left transition hover:bg-white/[0.035] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent/35 xl:grid-cols-[1fr_96px_108px_1.5fr] xl:items-start"
      >
        {/* Col 1: decision + time */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <EvidenceBadge tone={decisionBadgeTone(decision, riskScore)}>{decision}</EvidenceBadge>
            <span className="text-xs text-textSecondary">{formatTimestamp(readText(event, ["created_at"]))}</span>
          </div>
        </div>

        {/* Col 2: risk score + risk type */}
        <div className="min-w-0">
          <EvidenceBadge tone={decisionBadgeTone(undefined, riskScore)}>{`risk ${riskScore}`}</EvidenceBadge>
          {riskType && riskType !== "none" && (
            <p className="mt-1.5 truncate text-xs text-textSecondary" title={riskType}>{riskType.replace(/_/g, " ")}</p>
          )}
        </div>

        {/* Col 3: stage */}
        <div className="min-w-0">
          <EvidenceBadge>{stageShort(stage)}</EvidenceBadge>
          {toolName && (
            <p className="mt-1.5 truncate text-xs text-textSecondary" title={toolName}>{toolName}</p>
          )}
        </div>

        {/* Col 4: agent, reason, chevron */}
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-textPrimary" title={agentId ?? undefined}>
                {agentId || "Unknown agent"}
              </p>
              <p className="mt-1 line-clamp-2 text-sm leading-5 text-textSecondary">
                {readText(event, ["reason"]) || "Runtime evidence."}
              </p>
            </div>
            <ChevronDown
              className={`mt-0.5 shrink-0 text-textSecondary transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              size={18}
              aria-hidden="true"
            />
          </div>
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

export function AuditEventsWorkspace({ data }: { data: PlatformData }) {
  const [decisionFilter, setDecisionFilter] = useState("ALL");
  const [stageFilter, setStageFilter] = useState("ALL");
  const [riskTypeFilter, setRiskTypeFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedEventId, setExpandedEventId] = useState("");
  const query = searchQuery.trim().toLowerCase();
  const stages = ["ALL", ...Array.from(new Set(data.auditEvents.map(eventStage).filter(Boolean)))];
  const decisions = ["ALL", ...Array.from(new Set(data.auditEvents.map((event) => readText(event, ["decision"])).filter(Boolean) as string[]))];
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
  const filteredEvents = data.auditEvents.filter((event) => {
    const decision = readText(event, ["decision"]) || "";
    const stage = eventStage(event);
    // events with no risk_type or "none" are excluded when a specific type filter is active
    const riskType = readText(event, ["risk_type"]) || "";
    return (
      (decisionFilter === "ALL" || decision === decisionFilter)
      && (stageFilter === "ALL" || stage === stageFilter)
      && (riskTypeFilter === "ALL" || riskType === riskTypeFilter)
      && (!query || evidenceText(event).includes(query))
    );
  });

  if (!data.auditEvents.length) {
    return (
      <section className="glass-card rounded-3xl p-6">
        <ComponentRow title="No audit events" detail="Run governed agents or workflows to populate runtime evidence." />
      </section>
    );
  }

  return (
    <section className="grid gap-5">
      <section className="glass-card rounded-3xl p-5">
        <div className="grid gap-4 xl:grid-cols-[1fr_auto_auto_auto] xl:items-center">
          <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-line bg-ink/55 px-3 text-sm text-textSecondary">
            <Search size={16} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search audit evidence by agent, tool, risk, workflow, session, or reason..."
              className="min-w-0 flex-1 bg-transparent text-textPrimary outline-none placeholder:text-textSecondary"
            />
          </label>
          <FilterSelect label="Decision" value={decisionFilter} options={decisions} onChange={setDecisionFilter} />
          <FilterSelect label="Risk type" value={riskTypeFilter} options={riskTypeOptions} onChange={setRiskTypeFilter} />
          <FilterSelect label="Stage" value={stageFilter} options={stages} onChange={setStageFilter} />
        </div>
      </section>

      <section className="glass-card overflow-hidden rounded-3xl">
        <div className="grid grid-cols-[1fr_96px_108px_1.5fr] gap-x-4 border-b border-line px-5 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary max-xl:hidden">
          <span>Decision &amp; time</span>
          <span>Risk</span>
          <span>Stage</span>
          <span>Agent &amp; reason</span>
        </div>
        <div className="grid">
          {filteredEvents.length ? (
            filteredEvents.map((event) => {
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
