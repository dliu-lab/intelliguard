from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from agent_governance.policy import PolicyConfig, decide_from_score


EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE_RE = re.compile(r"\+\d{1,3}[\s().-]?\d{2,4}[\s().-]?\d{3}[\s().-]?\d{3,4}")
CUSTOMER_ID_RE = re.compile(r"\bC\d{3,}\b", re.IGNORECASE)


@dataclass(frozen=True)
class DetectorFinding:
    risk_type: str
    score: int
    reason: str
    rule: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RiskAssessment:
    decision: str
    risk_score: int
    findings: list[DetectorFinding]
    reason: str

    @property
    def risk_types(self) -> list[str]:
        return sorted({finding.risk_type for finding in self.findings})

    @property
    def triggered_rules(self) -> list[str]:
        return [finding.rule for finding in self.findings]


def _contains_any(text: str, patterns: list[str]) -> list[str]:
    lowered = text.lower()
    return [pattern for pattern in patterns if pattern.lower() in lowered]


def _customer_ids_in_query(user_query: str) -> set[str]:
    return {match.upper() for match in CUSTOMER_ID_RE.findall(user_query)}


def _missing_required_args(tool_args: dict[str, Any], required: list[str]) -> list[str]:
    missing = []
    for key in required:
        value = tool_args.get(key)
        if value is None or value == "" or value == {} or value == []:
            missing.append(key)
    return missing


def _argument_limit(tool_args: dict[str, Any]) -> int | None:
    raw_limit = tool_args.get("limit")
    if raw_limit is None and isinstance(tool_args.get("filter"), dict):
        raw_limit = tool_args["filter"].get("limit")
    if raw_limit is None:
        return None
    try:
        return int(raw_limit)
    except (TypeError, ValueError):
        return None


def assess_tool_call(
    *,
    policy: PolicyConfig,
    user_query: str,
    tool_name: str,
    tool_args: dict[str, Any],
    agent_identity: dict[str, Any] | None = None,
    repeated_failures: int = 0,
) -> RiskAssessment:
    findings: list[DetectorFinding] = []
    lower_query = user_query.lower()
    identity = agent_identity or {}
    granted_tools = set((identity.get("permissions") or {}).get("tools", []))
    argument_rule = policy.tool_argument_rules.get(tool_name)
    side_effect_control = policy.tool_side_effect_controls.get(tool_name)

    if granted_tools and tool_name not in granted_tools:
        findings.append(
            DetectorFinding(
                risk_type="AGENT_PERMISSION_DENIED",
                score=92,
                reason=f"Agent {identity.get('agent_id', 'unknown')} is not granted tool {tool_name}.",
                rule=f"agent_tool_not_granted:{tool_name}",
                metadata={
                    "agent_id": identity.get("agent_id"),
                    "granted_tools": sorted(granted_tools),
                    "requested_tool": tool_name,
                },
            )
        )

    if argument_rule:
        missing_args = _missing_required_args(tool_args, argument_rule.required)
        if missing_args:
            findings.append(
                DetectorFinding(
                    risk_type="INVALID_TOOL_ARGUMENTS",
                    score=86,
                    reason=f"Tool {tool_name} is missing required arguments: {', '.join(missing_args)}.",
                    rule=f"missing_required_args:{tool_name}",
                    metadata={"missing_args": missing_args, "tool_name": tool_name},
                )
            )

        if argument_rule.customer_id_must_match_query:
            query_customer_ids = _customer_ids_in_query(user_query)
            requested_customer_id = str(tool_args.get("customer_id") or "").upper()
            if (
                query_customer_ids
                and requested_customer_id
                and requested_customer_id not in query_customer_ids
            ):
                findings.append(
                    DetectorFinding(
                        risk_type="SESSION_SCOPE_VIOLATION",
                        score=90,
                        reason=(
                            f"Tool argument customer_id={requested_customer_id} does not match "
                            f"the customer referenced in the user query."
                        ),
                        rule=f"customer_id_scope_mismatch:{tool_name}",
                        metadata={
                            "query_customer_ids": sorted(query_customer_ids),
                            "requested_customer_id": requested_customer_id,
                        },
                    )
                )

        if argument_rule.require_filter:
            filter_value = tool_args.get("filter")
            if not isinstance(filter_value, dict) or not filter_value:
                findings.append(
                    DetectorFinding(
                        risk_type="INVALID_TOOL_ARGUMENTS",
                        score=82,
                        reason=f"Tool {tool_name} requires a non-empty filter argument.",
                        rule=f"required_filter:{tool_name}",
                        metadata={"tool_name": tool_name},
                    )
                )

        limit = _argument_limit(tool_args)
        if (
            argument_rule.max_limit is not None
            and limit is not None
            and limit > argument_rule.max_limit
        ):
            findings.append(
                DetectorFinding(
                    risk_type="EXCESSIVE_ARGUMENT_SCOPE",
                    score=86,
                    reason=(
                        f"Tool {tool_name} requested limit {limit}, above the argument limit "
                        f"of {argument_rule.max_limit}."
                    ),
                    rule=f"max_argument_limit:{tool_name}",
                    metadata={"tool_name": tool_name, "requested_limit": limit},
                )
            )

    if side_effect_control and side_effect_control.requires_review:
        findings.append(
            DetectorFinding(
                risk_type="SIDE_EFFECT_REQUIRES_REVIEW",
                score=side_effect_control.review_score,
                reason=side_effect_control.reason
                or f"Tool {tool_name} has {side_effect_control.level} side effects and requires review.",
                rule=f"side_effect_review:{tool_name}",
                metadata={"tool_name": tool_name, "side_effect_level": side_effect_control.level},
            )
        )

    matched_patterns = _contains_any(user_query, policy.blocked_patterns)
    for pattern in matched_patterns:
        findings.append(
            DetectorFinding(
                risk_type="PROMPT_INJECTION",
                score=85,
                reason=f"User query matched blocked pattern: {pattern}",
                rule=f"blocked_pattern:{pattern}",
            )
        )

    if tool_name in policy.blocked_tools:
        findings.append(
            DetectorFinding(
                risk_type="TOOL_MISUSE",
                score=90,
                reason=f"Tool {tool_name} is explicitly blocked by policy.",
                rule=f"blocked_tool:{tool_name}",
            )
        )

    if policy.allowed_tools and tool_name not in policy.allowed_tools:
        findings.append(
            DetectorFinding(
                risk_type="TOOL_MISUSE",
                score=85,
                reason=f"Tool {tool_name} is not in the allowed tool list.",
                rule=f"tool_not_allowed:{tool_name}",
            )
        )

    if tool_name == "search_customers":
        filter_value = tool_args.get("filter") or {}
        wants_email = bool(filter_value.get("include_email")) or "email" in lower_query
        is_bulk = not filter_value or any(term in lower_query for term in ["all records", "dump"])

        if is_bulk:
            findings.append(
                DetectorFinding(
                    risk_type="DATA_EXFILTRATION",
                    score=82,
                    reason="Search may retrieve a broad customer dataset.",
                    rule="bulk_customer_search",
                    metadata={"filter": filter_value},
                )
            )
        elif wants_email:
            findings.append(
                DetectorFinding(
                    risk_type="PII_EXPOSURE",
                    score=62,
                    reason="Customer search requested email address exposure.",
                    rule="email_address_exposure",
                    metadata={"filter": filter_value},
                )
            )

    if repeated_failures >= 3:
        findings.append(
            DetectorFinding(
                risk_type="REPEATED_FAILED_TOOL_CALL",
                score=55,
                reason="Session has repeated failed tool calls.",
                rule="repeated_failed_tool_calls",
                metadata={"failed_calls": repeated_failures},
            )
        )

    risk_score = max((finding.score for finding in findings), default=0)
    decision = decide_from_score(risk_score, policy)
    reason = "Tool call is allowed by policy."
    if findings:
        reason = "; ".join(finding.reason for finding in findings)

    return RiskAssessment(
        decision=decision, risk_score=risk_score, findings=findings, reason=reason
    )


def assess_tool_result(policy: PolicyConfig, tool_name: str, result: Any) -> RiskAssessment:
    findings: list[DetectorFinding] = []
    record_count = len(result) if isinstance(result, list) else 1 if result else 0

    if record_count > policy.max_records_returned:
        findings.append(
            DetectorFinding(
                risk_type="EXCESSIVE_RECORD_ACCESS",
                score=85,
                reason=f"Tool returned {record_count} records, above the limit of {policy.max_records_returned}.",
                rule="max_records_returned",
                metadata={"record_count": record_count, "tool_name": tool_name},
            )
        )

    risk_score = max((finding.score for finding in findings), default=0)
    decision = decide_from_score(risk_score, policy)
    reason = (
        "Tool result passed policy checks."
        if not findings
        else "; ".join(f.reason for f in findings)
    )
    return RiskAssessment(
        decision=decision, risk_score=risk_score, findings=findings, reason=reason
    )


def assess_final_response(policy: PolicyConfig, response_text: str) -> RiskAssessment:
    findings: list[DetectorFinding] = []
    emails = EMAIL_RE.findall(response_text)
    phones = PHONE_RE.findall(response_text)

    if policy.block_pii_in_response and (emails or phones):
        findings.append(
            DetectorFinding(
                risk_type="PII_LEAKAGE",
                score=88,
                reason="Final response contains email or phone-number-like PII.",
                rule="block_pii_in_response",
                metadata={"email_count": len(emails), "phone_count": len(phones)},
            )
        )

    matched_patterns = _contains_any(response_text, policy.blocked_patterns)
    for pattern in matched_patterns:
        findings.append(
            DetectorFinding(
                risk_type="POLICY_BYPASS_TEXT",
                score=80,
                reason=f"Final response contains blocked policy pattern: {pattern}",
                rule=f"response_blocked_pattern:{pattern}",
            )
        )

    risk_score = max((finding.score for finding in findings), default=0)
    decision = decide_from_score(risk_score, policy)
    reason = (
        "Final response passed policy checks."
        if not findings
        else "; ".join(f.reason for f in findings)
    )
    return RiskAssessment(
        decision=decision, risk_score=risk_score, findings=findings, reason=reason
    )


def redact_pii(text: str) -> str:
    text = EMAIL_RE.sub("[redacted-email]", text)
    text = PHONE_RE.sub("[redacted-phone]", text)
    return text
