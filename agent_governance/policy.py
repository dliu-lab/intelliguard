from __future__ import annotations

from dataclasses import asdict, dataclass, field
import hashlib
import json
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class DecisionThresholds:
    review: int = 50
    block: int = 80


@dataclass(frozen=True)
class ToolArgumentRule:
    required: list[str] = field(default_factory=list)
    customer_id_must_match_query: bool = False
    require_filter: bool = False
    max_limit: int | None = None


@dataclass(frozen=True)
class ToolSideEffectControl:
    level: str = "read_only"
    requires_review: bool = False
    review_score: int = 72
    reason: str = ""


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
    tool_argument_rules: dict[str, ToolArgumentRule] = field(default_factory=dict)
    tool_side_effect_controls: dict[str, ToolSideEffectControl] = field(default_factory=dict)


def _argument_rule_from_dict(raw: dict[str, Any]) -> ToolArgumentRule:
    max_limit = raw.get("max_limit")
    return ToolArgumentRule(
        required=list(raw.get("required", []) or []),
        customer_id_must_match_query=bool(raw.get("customer_id_must_match_query", False)),
        require_filter=bool(raw.get("require_filter", False)),
        max_limit=int(max_limit) if max_limit is not None else None,
    )


def _side_effect_control_from_dict(raw: dict[str, Any]) -> ToolSideEffectControl:
    return ToolSideEffectControl(
        level=str(raw.get("level", "read_only")),
        requires_review=bool(raw.get("requires_review", False)),
        review_score=int(raw.get("review_score", 72)),
        reason=str(raw.get("reason", "")),
    )


def policy_from_dict(raw: dict[str, Any]) -> PolicyConfig:
    thresholds = raw.get("decision_thresholds", {}) or {}
    argument_rules = raw.get("tool_argument_rules", {}) or {}
    side_effect_controls = raw.get("tool_side_effect_controls", {}) or {}
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
        tool_argument_rules={
            str(tool_name): _argument_rule_from_dict(rule)
            for tool_name, rule in argument_rules.items()
            if isinstance(rule, dict)
        },
        tool_side_effect_controls={
            str(tool_name): _side_effect_control_from_dict(control)
            for tool_name, control in side_effect_controls.items()
            if isinstance(control, dict)
        },
    )


def load_policy(path: str | Path) -> PolicyConfig:
    policy_path = Path(path)
    raw: dict[str, Any] = {}
    if policy_path.exists():
        raw = yaml.safe_load(policy_path.read_text()) or {}

    return policy_from_dict(raw)


def decide_from_score(risk_score: int, policy: PolicyConfig) -> str:
    if risk_score >= policy.decision_thresholds.block:
        return "BLOCK"
    if risk_score >= policy.decision_thresholds.review:
        return "REVIEW"
    return "ALLOW"


def policy_snapshot_hash(policy: PolicyConfig) -> str:
    payload = json.dumps(asdict(policy), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


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
        {
            "control_id": "tool_argument_validation",
            "category": "tool_access",
            "decision": "BLOCK",
            "rules": [
                f"{tool}:{','.join(rule.required) or 'argument_rule'}"
                for tool, rule in policy.tool_argument_rules.items()
            ],
            "enabled": bool(policy.tool_argument_rules),
        },
        {
            "control_id": "side_effect_review",
            "category": "side_effect_control",
            "decision": "REVIEW",
            "rules": [
                f"{tool}:{control.level}"
                for tool, control in policy.tool_side_effect_controls.items()
                if control.requires_review
            ],
            "enabled": any(
                control.requires_review for control in policy.tool_side_effect_controls.values()
            ),
        },
    ]
    return payload
