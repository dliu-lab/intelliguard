from __future__ import annotations

import re
from typing import Any
from uuid import uuid4

from agent_governance.adk.manifest import RuntimeManifest
from agent_governance.runtime.audit_completeness import check_runtime_audit_completeness
from agent_governance.runtime.contracts import RuntimeExecutionRequest, RuntimeRunner


PII_PATTERNS = (
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
)


def _contains_pii(value: Any) -> bool:
    text = value if isinstance(value, str) else str(value)
    return any(pattern.search(text) for pattern in PII_PATTERNS)


def _observed_tools(output_payload: dict[str, Any]) -> set[str]:
    tools = output_payload.get("tool_calls") or output_payload.get("tools") or []
    observed: set[str] = set()
    for item in tools:
        if isinstance(item, str):
            observed.add(item)
        elif isinstance(item, dict) and item.get("tool_name"):
            observed.add(str(item["tool_name"]))
    return observed


class ScenarioSuiteEvaluator:
    def __init__(self, *, store: Any, runner: RuntimeRunner) -> None:
        self.store = store
        self.runner = runner

    def run_suite(self, *, suite: dict[str, Any], deployment: dict[str, Any]) -> dict[str, Any]:
        manifest = RuntimeManifest.model_validate(deployment["manifest"])
        case_results: list[dict[str, Any]] = []
        passed = 0
        for case in suite.get("scenarios") or suite.get("cases") or []:
            result = self.runner.execute(
                RuntimeExecutionRequest(
                    run_id=f"scenario_{uuid4().hex[:16]}",
                    manifest=manifest,
                    user_query=str((case.get("input") or {}).get("query") or ""),
                    input_payload=case.get("input") or {},
                    idempotency_key=f"{suite.get('suite_id')}:{case.get('case_id')}",
                )
            )
            case_result = self._evaluate_case(case=case, result=result)
            runtime_run_id = (result.output_payload or {}).get("runtime_run_id")
            if deployment.get("environment") == "production" and runtime_run_id:
                audit = check_runtime_audit_completeness(self.store, str(runtime_run_id))
                case_result["audit_completeness"] = {
                    "passed": audit.passed,
                    "findings": audit.findings,
                }
                if not audit.passed:
                    case_result["passed"] = False
                    case_result["findings"].extend(audit.findings)
            case_results.append(case_result)
            if case_result["passed"]:
                passed += 1
        total = len(case_results)
        threshold = float(suite.get("pass_threshold", 1.0))
        overall_result = "PASS" if total and (passed / total) >= threshold else "FAIL"
        return self.store.create_scenario_run(
            {
                "suite_id": suite["suite_id"],
                "deployment_id": deployment["deployment_id"],
                "environment": deployment["environment"],
                "status": "COMPLETED",
                "overall_result": overall_result,
                "case_total": total,
                "case_passed": passed,
                "evidence": {"cases": case_results},
            }
        )

    @staticmethod
    def _evaluate_case(case: dict[str, Any], result: Any) -> dict[str, Any]:
        expected = case.get("expected") or {}
        findings: list[str] = []
        if expected.get("decision") and result.decision != expected["decision"]:
            findings.append(
                f"Expected decision {expected['decision']}, observed {result.decision}."
            )
        output_payload = result.output_payload or {}
        observed = _observed_tools(output_payload)
        required = set(expected.get("required_tools") or [])
        missing = required - observed
        if missing:
            findings.append(f"Missing required tools: {', '.join(sorted(missing))}.")
        forbidden = set(expected.get("forbidden_tools") or [])
        used_forbidden = forbidden & observed
        if used_forbidden:
            findings.append(f"Forbidden tools used: {', '.join(sorted(used_forbidden))}.")
        max_risk_score = expected.get("max_risk_score")
        observed_risk = int(output_payload.get("risk_score") or 0)
        if max_risk_score is not None and observed_risk > int(max_risk_score):
            findings.append(f"Risk score {observed_risk} exceeded max {max_risk_score}.")
        if expected.get("no_pii_in_response") and (
            _contains_pii(result.summary) or _contains_pii(output_payload)
        ):
            findings.append("PII detected in response.")
        return {
            "case_id": case.get("case_id"),
            "passed": not findings,
            "findings": findings,
            "observed": {
                "decision": result.decision,
                "status": result.status,
                "tools": sorted(observed),
                "risk_score": observed_risk,
            },
        }


def assert_production_activation_allowed(*, store: Any, deployment: dict[str, Any]) -> None:
    if deployment.get("environment") != "production":
        return
    if not store.latest_passing_scenario_run(deployment["deployment_id"]):
        raise ValueError(
            "Production activation requires a passing scenario run for this deployment."
        )
