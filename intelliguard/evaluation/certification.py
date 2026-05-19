from __future__ import annotations

from dataclasses import dataclass
from typing import Any

CERTIFICATION_STATUSES = frozenset(
    {"DRAFT", "EVALUATING", "CERTIFIED", "FAILED", "NEEDS_REEVALUATION"}
)
VALID_TRANSITIONS: dict[str, frozenset[str]] = {
    "DRAFT": frozenset({"EVALUATING"}),
    "EVALUATING": frozenset({"CERTIFIED", "FAILED"}),
    "CERTIFIED": frozenset({"EVALUATING", "NEEDS_REEVALUATION"}),
    "FAILED": frozenset({"EVALUATING"}),
    "NEEDS_REEVALUATION": frozenset({"EVALUATING"}),
}


class CertificationError(Exception):
    """Raised when a certification transition or decision is invalid."""


@dataclass(frozen=True)
class CertificationDecision:
    status: str
    failure_reason: str | None


def decide_certification(criterion_results: list[dict[str, Any]]) -> CertificationDecision:
    failed = [result for result in criterion_results if result["status"] == "FAIL"]
    if failed:
        reasons = "; ".join(_evidence(result) for result in failed)
        return CertificationDecision(status="FAILED", failure_reason=reasons)
    return CertificationDecision(status="CERTIFIED", failure_reason=None)


def validate_transition(current: str, next_status: str) -> None:
    if current not in CERTIFICATION_STATUSES:
        raise CertificationError(f"Unknown certification status: {current}")
    if next_status not in CERTIFICATION_STATUSES:
        raise CertificationError(f"Unknown certification status: {next_status}")
    allowed = VALID_TRANSITIONS[current]
    if next_status not in allowed:
        raise CertificationError(
            f"Invalid certification transition: {current} -> {next_status}. "
            f"Allowed from {current}: {sorted(allowed)}"
        )


def _evidence(result: dict[str, Any]) -> str:
    evidence = result.get("evidence_sentence") or result.get("evidence")
    return str(evidence or f"{result.get('criterion_name', 'criterion')} failed")
