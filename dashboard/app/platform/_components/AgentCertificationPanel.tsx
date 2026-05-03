"use client";

import { AlertTriangle, CheckCircle2, PlayCircle, ShieldCheck, XCircle } from "lucide-react";
import type { AgentCertification, CriterionResult, EvaluationRun } from "@/lib/api";
import { ComponentRow } from "./shared";
import { formatTimestamp } from "./utils";

function statusClasses(status: string) {
  if (status === "CERTIFIED" || status === "PASS") {
    return "border-emerald-300/40 bg-emerald-300/12 text-emerald-100";
  }
  if (status === "FAILED" || status === "FAIL") {
    return "border-rose-300/45 bg-rose-300/12 text-rose-100";
  }
  if (status === "NEEDS_REEVALUATION" || status === "REVIEW") {
    return "border-amber-300/45 bg-amber-300/12 text-amber-100";
  }
  if (status === "EVALUATING") {
    return "border-sky-300/45 bg-sky-300/12 text-sky-100";
  }
  return "border-line bg-white/[0.045] text-textSecondary";
}

function statusIcon(status: string) {
  if (status === "PASS" || status === "CERTIFIED") {
    return <CheckCircle2 size={15} aria-hidden="true" />;
  }
  if (status === "FAIL" || status === "FAILED") {
    return <XCircle size={15} aria-hidden="true" />;
  }
  return <AlertTriangle size={15} aria-hidden="true" />;
}

interface AgentCertificationPanelProps {
  certification: AgentCertification | null;
  criteria: CriterionResult[];
  evaluating: boolean;
  onEvaluate: () => void | Promise<void>;
  runs: EvaluationRun[];
}

export function AgentCertificationPanel({
  certification,
  criteria,
  evaluating,
  onEvaluate,
  runs,
}: AgentCertificationPanelProps) {
  const status = certification?.status || "NOT_EVALUATED";

  return (
    <section className="grid gap-5">
      <div className="rounded-3xl border border-line bg-white/[0.035] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Agent Certification
            </span>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses(status)}`}>
                <ShieldCheck size={15} aria-hidden="true" />
                {status}
              </span>
              {certification?.invalidation_reason ? (
                <span className="rounded-full border border-amber-300/35 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
                  {certification.invalidation_reason}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            disabled={evaluating || certification?.status === "EVALUATING"}
            onClick={onEvaluate}
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-accent/35 bg-accent/10 px-4 text-sm font-semibold text-textPrimary transition hover:border-accent/55 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PlayCircle size={16} aria-hidden="true" />
            {evaluating ? "Evaluating" : "Run Evaluation"}
          </button>
        </div>

        {certification ? (
          <div className="mt-5 grid gap-2 text-xs md:grid-cols-2">
            <CertFact label="Config hash" value={certification.config_hash} mono />
            <CertFact label="Last run" value={certification.last_evaluation_run_id || "not run"} mono />
            <CertFact label="Certified by" value={certification.certified_by || "not certified"} />
            <CertFact label="Certified at" value={formatTimestamp(certification.certified_at || undefined) || "not certified"} />
            {certification.failure_reason ? (
              <div className="md:col-span-2">
                <CertFact label="Failure reason" value={certification.failure_reason} tone="error" />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-5 text-sm leading-6 text-textSecondary">
            No evaluation has been run for this agent. Run evaluation to create the first certification record.
          </p>
        )}
      </div>

      <section className="rounded-3xl border border-line bg-white/[0.035] p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Criteria
            </span>
            <h3 className="mt-2 text-xl font-semibold text-textPrimary">Latest evaluation evidence</h3>
          </div>
          {runs[0] ? (
            <span className="rounded-full border border-line bg-ink/55 px-3 py-1 text-xs font-semibold text-textSecondary">
              {runs[0].criteria_passed}/{runs[0].criteria_total} passed
            </span>
          ) : null}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {criteria.length ? (
            criteria.map((criterion) => (
              <article key={criterion.criterion_result_id} className="rounded-2xl border border-line bg-ink/45 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-textPrimary">{criterion.criterion_name}</p>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClasses(criterion.status)}`}>
                    {statusIcon(criterion.status)}
                    {criterion.status}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-textSecondary">{criterion.evidence_sentence}</p>
              </article>
            ))
          ) : (
            <ComponentRow title="No criterion evidence" detail="Run an evaluation to inspect build-time agent checks." />
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-line bg-white/[0.035] p-5">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">History</span>
        <div className="mt-5 grid gap-3">
          {runs.length ? (
            runs.slice(0, 5).map((run) => (
              <div key={run.run_id} className="grid gap-2 rounded-2xl border border-line bg-ink/45 p-4 text-sm md:grid-cols-[1fr_auto_auto] md:items-center">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-textPrimary">{run.run_id}</p>
                  <p className="mt-1 text-xs text-textSecondary">{formatTimestamp(run.created_at)}</p>
                </div>
                <span className="text-textSecondary">{run.criteria_passed}/{run.criteria_total}</span>
                <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses(run.overall_result || run.status)}`}>
                  {run.overall_result || run.status}
                </span>
              </div>
            ))
          ) : (
            <ComponentRow title="No evaluation history" detail="Completed agent evaluations will appear here." />
          )}
        </div>
      </section>
    </section>
  );
}

function CertFact({
  label,
  mono = false,
  tone,
  value,
}: {
  label: string;
  mono?: boolean;
  tone?: "error";
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-ink/50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-textSecondary">{label}</p>
      <p className={`mt-1 break-all text-sm ${mono ? "font-mono" : ""} ${tone === "error" ? "text-rose-100" : "text-textPrimary"}`}>
        {value}
      </p>
    </div>
  );
}

