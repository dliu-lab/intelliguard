import type { ApiRecord, PlatformData } from "@/lib/api";
import { ComponentRow, MetricSurface, PlatformSurface } from "./shared";
import type { DataStatus } from "./types";
import { formatCount, joinParts, readText } from "./utils";

function decisionCounts(events: ApiRecord[]) {
  return events.reduce<Record<string, number>>((counts, event) => {
    const decision = String(readText(event, ["decision"]) || "UNKNOWN").toUpperCase();
    counts[decision] = (counts[decision] || 0) + 1;
    return counts;
  }, {});
}

function riskCounts(events: ApiRecord[]) {
  return events.reduce<Record<string, number>>((counts, event) => {
    const riskType = readText(event, ["risk_type"]) || "unknown";
    counts[riskType] = (counts[riskType] || 0) + 1;
    return counts;
  }, {});
}

function averageRisk(events: ApiRecord[]) {
  if (!events.length) {
    return 0;
  }

  const total = events.reduce((sum, event) => {
    const value = Number(readText(event, ["risk_score"]));
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  return Math.round(total / events.length);
}

function certificationStatus(record: ApiRecord) {
  const certification = record.certification;
  if (!certification || typeof certification !== "object" || Array.isArray(certification)) {
    return "DRAFT";
  }

  return readText(certification as ApiRecord, ["status"]) || "DRAFT";
}

function certifiedCount(records: ApiRecord[]) {
  return records.filter((record) => certificationStatus(record) === "CERTIFIED").length;
}

export function MonitoringWorkspace({
  data,
  dataStatus,
}: {
  data: PlatformData;
  dataStatus: DataStatus;
}) {
  const loading = dataStatus === "loading";
  const decisions = decisionCounts(data.auditEvents);
  const risks = riskCounts(data.auditEvents);
  const pendingReviews = data.reviewQueue.filter((review) => readText(review, ["status"]) === "PENDING").length;
  const topRiskRows = Object.entries(risks)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 8)
    .map(([riskType, count]) => ({
      detail: formatCount(count, "event"),
      meta: `${Math.round((count / Math.max(data.auditEvents.length, 1)) * 100)}%`,
      title: riskType,
    }));
  const agentRows = Object.entries(
    data.auditEvents.reduce<Record<string, { blocked: number; count: number; risk: number }>>((counts, event) => {
      const agentId = readText(event, ["agent_id"]) || "unknown";
      const riskScore = Number(readText(event, ["risk_score"]));
      const next = counts[agentId] || { blocked: 0, count: 0, risk: 0 };
      next.count += 1;
      next.risk += Number.isFinite(riskScore) ? riskScore : 0;
      if (String(readText(event, ["decision"]) || "").toUpperCase() === "BLOCK") {
        next.blocked += 1;
      }
      counts[agentId] = next;
      return counts;
    }, {}),
  )
    .sort(([, left], [, right]) => right.count - left.count)
    .slice(0, 8)
    .map(([agentId, stats]) => ({
      detail: joinParts([
        formatCount(stats.count, "event"),
        `avg risk ${Math.round(stats.risk / Math.max(stats.count, 1))}`,
      ]) || "No audit data",
      meta: stats.blocked ? `${stats.blocked} blocked` : "no blocks",
      title: agentId,
    }));

  return (
    <section className="grid gap-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="Monitoring metrics">
        <MetricSurface label="Allow" loading={loading} tone="emerald" value={decisions.ALLOW || 0} />
        <MetricSurface label="Review" loading={loading} tone="amber" value={decisions.REVIEW || 0} />
        <MetricSurface label="Block" loading={loading} tone="rose" value={decisions.BLOCK || 0} />
        <MetricSurface label="Pending Reviews" loading={loading} tone="amber" value={pendingReviews} />
        <MetricSurface label="Average Risk" loading={loading} tone="sky" value={averageRisk(data.auditEvents)} />
        <MetricSurface label="Certified Tools" loading={loading} tone="indigo" value={certifiedCount(data.tools)} />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <PlatformSurface tone="sky">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Decision health
              </span>
              <h3 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Decision rate snapshot</h3>
            </div>
            <span className="rounded-full border border-line bg-ink/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
              {formatCount(data.auditEvents.length, "event")}
            </span>
          </div>
          <div className="mt-5 grid gap-3">
            {["ALLOW", "REVIEW", "BLOCK"].map((decision) => (
              <DecisionBar
                key={decision}
                count={decisions[decision] || 0}
                decision={decision}
                total={data.auditEvents.length}
              />
            ))}
          </div>
        </PlatformSurface>

        <PlatformSurface tone="amber">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Review queue health
          </span>
          <div className="mt-5 grid gap-3">
            {data.reviewQueue.length ? (
              data.reviewQueue.slice(0, 8).map((review) => (
                <ComponentRow
                  key={readText(review, ["review_id"]) || readText(review, ["session_id"])}
                  title={readText(review, ["review_id"]) || "Review item"}
                  detail={readText(review, ["reason"]) || "Human review item."}
                  meta={joinParts([
                    readText(review, ["status"]),
                    readText(review, ["agent_id"]),
                    readText(review, ["tool_name"]),
                  ])}
                />
              ))
            ) : (
              <ComponentRow title="No review items" detail="Runtime review queue is empty for the selected environment." />
            )}
          </div>
        </PlatformSurface>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <PlatformSurface tone="fuchsia">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Risk distribution
          </span>
          <div className="mt-5 grid gap-3">
            {topRiskRows.length ? (
              topRiskRows.map((row) => <ComponentRow key={row.title} {...row} />)
            ) : (
              <ComponentRow title="No risk events" detail="Audit events will populate this distribution." />
            )}
          </div>
        </PlatformSurface>

        <PlatformSurface tone="emerald">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Agent activity
          </span>
          <div className="mt-5 grid gap-3">
            {agentRows.length ? (
              agentRows.map((row) => <ComponentRow key={row.title} {...row} />)
            ) : (
              <ComponentRow title="No agent activity" detail="Governed agent runs will appear here after execution." />
            )}
          </div>
        </PlatformSurface>
      </div>
    </section>
  );
}

function DecisionBar({
  count,
  decision,
  total,
}: {
  count: number;
  decision: string;
  total: number;
}) {
  const percent = Math.round((count / Math.max(total, 1)) * 100);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-textPrimary">{decision}</span>
        <span className="text-textSecondary">{formatCount(count, "event")}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/55">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
