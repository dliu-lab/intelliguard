"use client";

import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { getRuntimeRunEvents, getSession, listRuntimeRuns, type ApiRecord } from "@/lib/api";
import { formatTimestamp, readText } from "./utils";

interface RuntimeRunStatusPanelProps {
  environment: string;
  selectedRunId: string;
}

export function RuntimeRunStatusPanel({ environment, selectedRunId }: RuntimeRunStatusPanelProps) {
  const [runs, setRuns] = useState<ApiRecord[]>([]);
  const [events, setEvents] = useState<ApiRecord[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const activeRun = runs.find((run) => readText(run, ["run_id"]) === selectedRunId) || runs[0];
  const runId = readText(activeRun || {}, ["run_id"]) || selectedRunId;

  async function refresh() {
    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const nextRuns = await listRuntimeRuns(session.token, 20, environment || "all");
      setRuns(nextRuns);
      const nextRunId = selectedRunId || readText(nextRuns[0] || {}, ["run_id"]);
      if (nextRunId) {
        const payload = await getRuntimeRunEvents(session.token, nextRunId);
        setEvents(payload.events);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load runtime runs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [environment, selectedRunId]);

  const status = readText(activeRun || {}, ["status"]) || "NO RUN";
  const decision = readText(activeRun || {}, ["decision"]) || "PENDING";
  const eventCursor = readText(events.at(-1) || {}, ["outbox_id"]) || "start";
  const failed = status === "FAILED" || status === "BLOCKED";
  const outputPayload = objectValue(activeRun, "output_payload");
  const pausedHook = objectValue(outputPayload, "runtime_hook_pause");
  const pausedReviewId = readText(pausedHook, ["review_id"]);
  const pausedReason = readText(pausedHook, ["reason"]);

  return (
    <section className="rounded-3xl border border-line bg-white/[0.035] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            <Activity size={15} aria-hidden="true" />
            Runtime status
          </div>
          <h3 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-textPrimary">{status}</h3>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-white/[0.04] px-4 text-sm font-semibold text-textPrimary transition hover:border-accent/35 hover:bg-accent/10"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatusDatum icon={<Clock size={15} />} label="Run" value={runId || "not selected"} />
        <StatusDatum icon={<CheckCircle2 size={15} />} label="Decision" value={decision} />
        <StatusDatum icon={<Activity size={15} />} label="Runtime" value={readText(activeRun || {}, ["runtime_type"]) || "native"} />
        <StatusDatum icon={<Activity size={15} />} label="Deployment" value={readText(activeRun || {}, ["deployment_id"]) || "none"} />
        <StatusDatum icon={<Activity size={15} />} label="Cursor" value={eventCursor} />
        <StatusDatum icon={<AlertTriangle size={15} />} label="Error" value={readText(activeRun || {}, ["error"]) || (failed ? "check run" : "none")} />
      </div>

      {message ? <p className="mt-3 text-sm text-amber-200">{message}</p> : null}
      {status === "REVIEW" && pausedReviewId ? (
        <div className="mt-4 border-l-2 border-amber-300 bg-amber-300/10 px-4 py-3 text-sm text-textPrimary">
          <div className="flex flex-wrap items-center gap-2 font-semibold">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>Waiting for human review</span>
            <span className="font-mono text-xs text-amber-100">{pausedReviewId}</span>
          </div>
          {pausedReason ? <p className="mt-1 text-textSecondary">{pausedReason}</p> : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-2">
        {events.length ? (
          events.slice(-6).map((event) => (
            <div key={readText(event, ["outbox_id"])} className="rounded-xl border border-line bg-ink/60 p-3 text-xs text-textSecondary">
              <span className="font-semibold text-textPrimary">{readText(event, ["event_type"])}</span>
              <span className="ml-2">{formatTimestamp(readText(event, ["created_at"]))}</span>
            </div>
          ))
        ) : (
          <p className="text-sm text-textSecondary">No runtime events recorded yet.</p>
        )}
      </div>
    </section>
  );
}

function objectValue(record: ApiRecord | undefined, key: string): ApiRecord {
  const value = record?.[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as ApiRecord;
  }
  return {};
}

interface StatusDatumProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function StatusDatum({ icon, label, value }: StatusDatumProps) {
  return (
    <div className="rounded-2xl border border-line bg-ink/55 p-3">
      <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-textSecondary">
        {icon}
        {label}
      </div>
      <p className="mt-2 break-words font-mono text-xs text-textPrimary">{value}</p>
    </div>
  );
}
