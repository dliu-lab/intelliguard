from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class AuditCompletenessResult:
    passed: bool
    findings: list[str] = field(default_factory=list)


def check_runtime_audit_completeness(store: Any, run_id: str) -> AuditCompletenessResult:
    findings: list[str] = []
    run = store.get_workflow_runtime_run(run_id)
    if not run:
        return AuditCompletenessResult(False, ["runtime run is missing"])
    deployment_id = run.get("deployment_id")
    if not deployment_id:
        findings.append("deployment_id is missing")
        deployment = None
    else:
        deployment = store.get_workflow_deployment_revision(deployment_id)
        if not deployment:
            findings.append("deployment revision is missing")
    if not (deployment or {}).get("manifest_hash"):
        findings.append("manifest_hash is missing")
    if not run.get("workflow_id"):
        findings.append("workflow_id is missing")
    output_payload = run.get("output_payload") or {}
    if not output_payload.get("lead_session_id"):
        findings.append("lead_session_id is missing")
    if not run.get("decision"):
        findings.append("final decision is missing")
    if not (deployment or {}).get("policy_hashes"):
        findings.append("policy snapshot hash is missing")
    events = store.list_runtime_outbox_events(run_id=run_id, limit=100)
    if not events:
        findings.append("runtime events are missing")
    for tool_call in output_payload.get("tool_calls") or []:
        if isinstance(tool_call, dict) and not tool_call.get("decision"):
            findings.append(
                f"tool call {tool_call.get('tool_name') or '<unknown>'} is missing a decision"
            )
    if (deployment or {}).get("evaluator_config_hashes") and not output_payload.get(
        "evaluator_results"
    ):
        findings.append("evaluator result is missing")
    return AuditCompletenessResult(not findings, findings)
