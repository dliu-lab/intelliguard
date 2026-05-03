from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from agent_governance.store import GovernanceStore


def _record_status(record: dict[str, Any]) -> str:
    certification = record.get("certification")
    if not isinstance(certification, dict):
        return "DRAFT"
    status = certification.get("status")
    return str(status or "DRAFT").upper()


def _certification_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    statuses = Counter(_record_status(record) for record in records)
    total = len(records)
    certified = statuses.get("CERTIFIED", 0)
    return {
        "total": total,
        "certified": certified,
        "failed": statuses.get("FAILED", 0),
        "needs_reevaluation": statuses.get("NEEDS_REEVALUATION", 0),
        "draft": statuses.get("DRAFT", 0),
        "evaluating": statuses.get("EVALUATING", 0),
        "coverage": round(certified / total, 4) if total else 0.0,
        "statuses": dict(sorted(statuses.items())),
    }


def _decision_totals(audit_events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals = Counter(str(event.get("decision") or "UNKNOWN").upper() for event in audit_events)
    return [
        {"decision": decision, "count": count}
        for decision, count in sorted(totals.items())
    ]


def _risk_type_distribution(audit_events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals = Counter(str(event.get("risk_type") or "unknown") for event in audit_events)
    return [
        {"risk_type": risk_type, "count": count}
        for risk_type, count in totals.most_common()
    ]


def _agent_leaderboard(audit_events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals: dict[str, dict[str, int]] = defaultdict(
        lambda: {"events": 0, "blocked": 0, "risk_score": 0}
    )
    for event in audit_events:
        agent_id = str(event.get("agent_id") or "unknown")
        risk_score = event.get("risk_score")
        totals[agent_id]["events"] += 1
        totals[agent_id]["risk_score"] += int(risk_score) if isinstance(risk_score, int) else 0
        if str(event.get("decision") or "").upper() == "BLOCK":
            totals[agent_id]["blocked"] += 1

    return [
        {
            "agent_id": agent_id,
            "event_count": stats["events"],
            "avg_risk_score": round(stats["risk_score"] / stats["events"], 2)
            if stats["events"]
            else 0,
            "block_rate": round(stats["blocked"] / stats["events"], 4)
            if stats["events"]
            else 0,
        }
        for agent_id, stats in sorted(
            totals.items(), key=lambda item: item[1]["events"], reverse=True
        )
    ]


def _evaluation_quality(evaluation_runs: list[dict[str, Any]]) -> dict[str, Any]:
    completed = [
        run
        for run in evaluation_runs
        if str(run.get("status") or "").upper() == "COMPLETED"
    ]
    passed = [
        run
        for run in completed
        if str(run.get("overall_result") or "").upper() == "CERTIFIED"
    ]
    failed = [
        run
        for run in completed
        if str(run.get("overall_result") or "").upper() == "FAILED"
    ]
    return {
        "runs_total": len(evaluation_runs),
        "completed": len(completed),
        "passed": len(passed),
        "failed": len(failed),
        "pass_rate": round(len(passed) / len(completed), 4) if completed else 0.0,
    }


def build_monitoring_metrics(
    store: GovernanceStore, environment: str | list[str] | None = None
) -> dict[str, Any]:
    audit_events = store.list_audit_events(limit=1000, environment=environment)
    review_items = store.list_review_queue(
        limit=1000, environment=environment, status="ALL"
    )
    tools = store.list_tool_records(environment=environment)
    agents = store.list_agents(environment=environment)
    workflows = store.list_workflow_definitions(environment=environment)
    evaluation_runs = store.list_evaluation_runs(environment=environment, limit=1000)

    review_statuses = Counter(str(item.get("status") or "UNKNOWN").upper() for item in review_items)
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "environment_scope": environment or "all",
        "decision_totals": _decision_totals(audit_events),
        "risk_type_distribution": _risk_type_distribution(audit_events),
        "agent_leaderboard": _agent_leaderboard(audit_events),
        "review_queue": {
            "total": len(review_items),
            "pending": review_statuses.get("PENDING", 0),
            "approved": review_statuses.get("APPROVED", 0),
            "denied": review_statuses.get("DENIED", 0),
            "sla_breached": 0,
        },
        "evaluation_quality": _evaluation_quality(evaluation_runs),
        "certification_coverage": {
            "tools": _certification_summary(tools),
            "agents": _certification_summary(agents),
            "workflows": _certification_summary(workflows),
        },
    }
