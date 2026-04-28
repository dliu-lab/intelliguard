from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class DecisionThresholds:
    review: int = 50
    block: int = 80


@dataclass(frozen=True)
class PolicyConfig:
    allowed_tools: list[str] = field(default_factory=list)
    blocked_tools: list[str] = field(default_factory=list)
    max_records_returned: int = 100
    block_pii_in_response: bool = True
    redact_pii_in_response: bool = False
    blocked_patterns: list[str] = field(default_factory=list)
    review_required_for: list[str] = field(default_factory=list)
    decision_thresholds: DecisionThresholds = field(default_factory=DecisionThresholds)


def load_policy(path: str | Path) -> PolicyConfig:
    policy_path = Path(path)
    raw: dict[str, Any] = {}
    if policy_path.exists():
        raw = yaml.safe_load(policy_path.read_text()) or {}

    thresholds = raw.get("decision_thresholds", {}) or {}
    return PolicyConfig(
        allowed_tools=list(raw.get("allowed_tools", []) or []),
        blocked_tools=list(raw.get("blocked_tools", []) or []),
        max_records_returned=int(raw.get("max_records_returned", 100)),
        block_pii_in_response=bool(raw.get("block_pii_in_response", True)),
        redact_pii_in_response=bool(raw.get("redact_pii_in_response", False)),
        blocked_patterns=list(raw.get("blocked_patterns", []) or []),
        review_required_for=list(raw.get("review_required_for", []) or []),
        decision_thresholds=DecisionThresholds(
            review=int(thresholds.get("review", 50)),
            block=int(thresholds.get("block", 80)),
        ),
    )


def decide_from_score(risk_score: int, policy: PolicyConfig) -> str:
    if risk_score >= policy.decision_thresholds.block:
        return "BLOCK"
    if risk_score >= policy.decision_thresholds.review:
        return "REVIEW"
    return "ALLOW"


def policy_to_dict(policy: PolicyConfig) -> dict[str, Any]:
    payload = asdict(policy)
    payload["risk_controls"] = [
        {
            "control_id": "tool_allowlist",
            "category": "tool_access",
            "decision": "BLOCK",
            "rules": [f"tool_not_allowed:{tool}" for tool in policy.allowed_tools],
            "enabled": bool(policy.allowed_tools),
        },
        {
            "control_id": "tool_blocklist",
            "category": "tool_access",
            "decision": "BLOCK",
            "rules": [f"blocked_tool:{tool}" for tool in policy.blocked_tools],
            "enabled": bool(policy.blocked_tools),
        },
        {
            "control_id": "prompt_injection_patterns",
            "category": "prompt_injection",
            "decision": "BLOCK",
            "rules": [f"blocked_pattern:{pattern}" for pattern in policy.blocked_patterns],
            "enabled": bool(policy.blocked_patterns),
        },
        {
            "control_id": "review_required_risks",
            "category": "human_review",
            "decision": "REVIEW",
            "rules": policy.review_required_for,
            "enabled": bool(policy.review_required_for),
        },
        {
            "control_id": "max_records_returned",
            "category": "data_access",
            "decision": "BLOCK",
            "rules": [f"record_count>{policy.max_records_returned}"],
            "enabled": True,
        },
        {
            "control_id": "block_pii_in_response",
            "category": "response_safety",
            "decision": "BLOCK",
            "rules": ["email_detection", "phone_detection"],
            "enabled": policy.block_pii_in_response,
        },
        {
            "control_id": "redact_pii_in_response",
            "category": "response_safety",
            "decision": "ALLOW_WITH_REDACTION",
            "rules": ["redact_email", "redact_phone"],
            "enabled": policy.redact_pii_in_response,
        },
    ]
    return payload
