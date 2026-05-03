from __future__ import annotations

import hashlib
import json
from typing import Any

from agent_governance.evaluation.tool_evaluators import CriterionResult
from agent_governance.workflow_graph import NODE_TYPES

VALID_AGENT_TYPES = frozenset(NODE_TYPES)
TOOL_OPTIONAL_AGENT_TYPES = frozenset({"lead_agent", "review_agent", "approval_agent", "terminal_agent"})


def run_agent_evaluators(
    agent: dict[str, Any], assignments: dict[str, Any]
) -> list[CriterionResult]:
    return [
        _check_identity_declared(agent),
        _check_model_declared(agent),
        _check_agent_type_valid(agent),
        _check_tool_scope_defined(agent),
        _check_attached_tools_certified(agent, assignments),
        _check_guardrail_assigned(assignments),
    ]


def compute_agent_config_hash(agent: dict[str, Any], assignments: dict[str, Any]) -> str:
    metadata = _metadata(agent)
    llm = _llm_metadata(agent)
    fields = {
        "agent_type": agent.get("agent_type", ""),
        "domain": metadata.get("domain") or metadata.get("data_domain") or "",
        "evaluator_ids": _assignment_ids(assignments.get("evaluators") or [], "evaluator_id"),
        "guardrail_policy_ids": _assignment_ids(assignments.get("guardrails") or [], "policy_id"),
        "kb_ids": _assignment_ids(assignments.get("knowledge") or [], "kb_id"),
        "model": llm.get("model", ""),
        "prompt": metadata.get("prompt") or metadata.get("system_prompt") or "",
        "purpose": (agent.get("purpose") or "").strip(),
        "tools": sorted(str(tool) for tool in _agent_tools(agent)),
    }
    canonical = json.dumps(fields, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _check_identity_declared(agent: dict[str, Any]) -> CriterionResult:
    purpose = (agent.get("purpose") or "").strip()
    metadata = _metadata(agent)
    domain = str(metadata.get("domain") or metadata.get("data_domain") or "").strip()
    missing = []
    if not purpose:
        missing.append("purpose")
    if not domain:
        missing.append("domain")
    if missing:
        return CriterionResult(
            criterion_name="identity_declared",
            status="FAIL",
            score=0,
            evidence_sentence=f"Agent registration is missing: {', '.join(missing)}.",
            input_snapshot={"purpose": purpose, "domain": domain},
            observed_value={"missing": missing},
            expected_value={"required": ["purpose", "domain"]},
        )
    return CriterionResult(
        criterion_name="identity_declared",
        status="PASS",
        score=100,
        evidence_sentence="Agent purpose and domain are declared.",
        input_snapshot={"purpose": purpose, "domain": domain},
    )


def _check_model_declared(agent: dict[str, Any]) -> CriterionResult:
    model = str(_llm_metadata(agent).get("model") or "").strip()
    if not model:
        return CriterionResult(
            criterion_name="model_declared",
            status="FAIL",
            score=0,
            evidence_sentence="No LLM model is declared in metadata.llm.model.",
            input_snapshot={"model": model},
            observed_value={"model": model},
            expected_value={"metadata.llm.model": "non-empty string"},
        )
    return CriterionResult(
        criterion_name="model_declared",
        status="PASS",
        score=100,
        evidence_sentence=f"Agent model is declared as '{model}'.",
        input_snapshot={"model": model},
    )


def _check_agent_type_valid(agent: dict[str, Any]) -> CriterionResult:
    agent_type = str(agent.get("agent_type") or "").strip()
    if agent_type not in VALID_AGENT_TYPES:
        return CriterionResult(
            criterion_name="agent_type_valid",
            status="FAIL",
            score=0,
            evidence_sentence=f"agent_type '{agent_type}' is not in the controlled vocabulary.",
            input_snapshot={"agent_type": agent_type},
            observed_value={"agent_type": agent_type},
            expected_value={"allowed_values": sorted(VALID_AGENT_TYPES)},
        )
    return CriterionResult(
        criterion_name="agent_type_valid",
        status="PASS",
        score=100,
        evidence_sentence=f"agent_type '{agent_type}' is valid.",
        input_snapshot={"agent_type": agent_type},
    )


def _check_tool_scope_defined(agent: dict[str, Any]) -> CriterionResult:
    tools = _agent_tools(agent)
    agent_type = str(agent.get("agent_type") or "")
    if not tools and agent_type not in TOOL_OPTIONAL_AGENT_TYPES:
        return CriterionResult(
            criterion_name="tool_scope_defined",
            status="REVIEW",
            score=60,
            evidence_sentence="Task-style agent has no attached tool grants.",
            input_snapshot={"agent_type": agent_type, "tools": tools},
            observed_value={"tool_count": 0},
            expected_value={"tool_count": ">= 1 unless tool-optional node type"},
        )
    return CriterionResult(
        criterion_name="tool_scope_defined",
        status="PASS",
        score=100,
        evidence_sentence=f"Agent declares {len(tools)} tool grant(s).",
        input_snapshot={"agent_type": agent_type, "tools": tools},
    )


def _check_attached_tools_certified(
    agent: dict[str, Any], assignments: dict[str, Any]
) -> CriterionResult:
    tools = set(_agent_tools(agent))
    tool_records = assignments.get("tools") or []
    status_by_name = {
        str(tool.get("tool_name")): str((tool.get("certification") or {}).get("status") or "DRAFT")
        for tool in tool_records
        if isinstance(tool, dict)
    }
    missing_records = sorted(tool for tool in tools if tool not in status_by_name)
    uncertified = sorted(
        f"{tool}:{status}"
        for tool, status in status_by_name.items()
        if tool in tools and status != "CERTIFIED"
    )
    if missing_records or uncertified:
        return CriterionResult(
            criterion_name="attached_tools_certified",
            status="FAIL",
            score=0,
            evidence_sentence=(
                "Agent has attached tools that are missing registry records or are not certified."
            ),
            input_snapshot={
                "tools": sorted(tools),
                "status_by_name": status_by_name,
            },
            observed_value={"missing_records": missing_records, "uncertified": uncertified},
            expected_value={"all_attached_tools": "CERTIFIED"},
        )
    return CriterionResult(
        criterion_name="attached_tools_certified",
        status="PASS",
        score=100,
        evidence_sentence="All attached tools have certified registry records.",
        input_snapshot={"tools": sorted(tools), "status_by_name": status_by_name},
    )


def _check_guardrail_assigned(assignments: dict[str, Any]) -> CriterionResult:
    guardrails = assignments.get("guardrails") or []
    if not guardrails:
        return CriterionResult(
            criterion_name="guardrail_assigned",
            status="FAIL",
            score=0,
            evidence_sentence="No guardrail policy is assigned to this agent.",
            input_snapshot={"guardrail_count": 0},
            observed_value={"guardrail_count": 0},
            expected_value={"guardrail_count": ">= 1"},
        )
    return CriterionResult(
        criterion_name="guardrail_assigned",
        status="PASS",
        score=100,
        evidence_sentence=f"{len(guardrails)} guardrail assignment(s) found.",
        input_snapshot={"guardrail_count": len(guardrails)},
    )


def _agent_tools(agent: dict[str, Any]) -> list[str]:
    permissions = agent.get("permissions")
    if not isinstance(permissions, dict):
        return []
    tools = permissions.get("tools")
    return [str(tool) for tool in tools] if isinstance(tools, list) else []


def _metadata(agent: dict[str, Any]) -> dict[str, Any]:
    metadata = agent.get("metadata")
    return metadata if isinstance(metadata, dict) else {}


def _llm_metadata(agent: dict[str, Any]) -> dict[str, Any]:
    llm = _metadata(agent).get("llm")
    return llm if isinstance(llm, dict) else {}


def _assignment_ids(assignments: list[dict[str, Any]], key: str) -> list[str]:
    return sorted(str(assignment.get(key, "")) for assignment in assignments if assignment.get(key))
