from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Literal

CriterionStatus = Literal["PASS", "FAIL", "REVIEW"]

SIDE_EFFECT_LEVELS = frozenset(
    {
        "none",
        "read_only",
        "write_update",
        "external_communication",
        "financial_action",
        "credential_action",
    }
)
REQUIRED_INPUT_SCHEMA_FIELDS = frozenset({"type", "properties"})
REQUIRED_OUTPUT_SCHEMA_FIELDS = frozenset({"type"})
PII_FIELD_PATTERNS = frozenset(
    {
        "address",
        "credit_card",
        "date_of_birth",
        "dob",
        "email",
        "password",
        "phone",
        "ssn",
    }
)


@dataclass(frozen=True)
class CriterionResult:
    criterion_name: str
    status: CriterionStatus
    evidence_sentence: str
    input_snapshot: dict[str, Any]
    score: int | None = None
    observed_value: dict[str, Any] = field(default_factory=dict)
    expected_value: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_record(self, evaluator_id: str = "tool_baseline") -> dict[str, Any]:
        return {
            "evaluator_id": evaluator_id,
            "criterion_name": self.criterion_name,
            "status": self.status,
            "score": self.score,
            "evidence_sentence": self.evidence_sentence,
            "observed_value": self.observed_value,
            "expected_value": self.expected_value,
            "metadata": self.metadata,
            "input_snapshot": self.input_snapshot,
        }


def run_tool_evaluators(tool: dict[str, Any]) -> list[CriterionResult]:
    return [
        _check_input_schema(tool),
        _check_required_arguments(tool),
        _check_output_schema(tool),
        _check_side_effect_level(tool),
        _check_permission_model(tool),
        _check_pii_field_leakage(tool),
    ]


def compute_config_hash(tool: dict[str, Any]) -> str:
    fields = {
        "allowed_actions": sorted(str(action) for action in tool.get("allowed_actions", [])),
        "input_schema": tool.get("input_schema", {}) or {},
        "output_schema": tool.get("output_schema", {}) or {},
        "permissions": tool.get("permissions", {}) or {},
        "side_effect_level": tool.get("side_effect_level", "") or "",
    }
    canonical = json.dumps(fields, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _check_input_schema(tool: dict[str, Any]) -> CriterionResult:
    schema = tool.get("input_schema")
    snapshot = {"input_schema": schema}
    if not isinstance(schema, dict) or not schema:
        return CriterionResult(
            criterion_name="input_schema_validation",
            status="FAIL",
            score=0,
            evidence_sentence="Tool has no input schema declared.",
            input_snapshot=snapshot,
            observed_value={"present": bool(schema)},
            expected_value={"required_fields": sorted(REQUIRED_INPUT_SCHEMA_FIELDS)},
        )
    missing = REQUIRED_INPUT_SCHEMA_FIELDS - set(schema.keys())
    if missing:
        return CriterionResult(
            criterion_name="input_schema_validation",
            status="FAIL",
            score=0,
            evidence_sentence=f"Input schema is missing required fields: {', '.join(sorted(missing))}.",
            input_snapshot=snapshot,
            observed_value={"fields": sorted(schema.keys())},
            expected_value={"required_fields": sorted(REQUIRED_INPUT_SCHEMA_FIELDS)},
        )
    if schema.get("type") != "object" or not isinstance(schema.get("properties"), dict):
        return CriterionResult(
            criterion_name="input_schema_validation",
            status="FAIL",
            score=0,
            evidence_sentence="Input schema must be an object schema with a properties map.",
            input_snapshot=snapshot,
            observed_value={"type": schema.get("type"), "properties_type": type(schema.get("properties")).__name__},
            expected_value={"type": "object", "properties_type": "dict"},
        )
    return CriterionResult(
        criterion_name="input_schema_validation",
        status="PASS",
        score=100,
        evidence_sentence="Input schema is present and declares object properties.",
        input_snapshot=snapshot,
    )


def _check_required_arguments(tool: dict[str, Any]) -> CriterionResult:
    schema = tool.get("input_schema") if isinstance(tool.get("input_schema"), dict) else {}
    properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    required = schema.get("required", [])
    snapshot = {"properties": sorted(properties.keys()), "required": required}
    if properties and not isinstance(required, list):
        return CriterionResult(
            criterion_name="required_argument_validation",
            status="FAIL",
            score=0,
            evidence_sentence="Input schema required field must be a list.",
            input_snapshot=snapshot,
            observed_value={"required_type": type(required).__name__},
            expected_value={"required_type": "list"},
        )
    if properties and not required:
        return CriterionResult(
            criterion_name="required_argument_validation",
            status="REVIEW",
            score=60,
            evidence_sentence="Input schema has properties but no required argument list.",
            input_snapshot=snapshot,
            observed_value={"required_count": 0},
            expected_value={"required_count": ">= 1 for tools with arguments"},
        )
    unknown_required = sorted(set(required) - set(properties))
    if unknown_required:
        return CriterionResult(
            criterion_name="required_argument_validation",
            status="FAIL",
            score=0,
            evidence_sentence=f"Required arguments are not declared in properties: {', '.join(unknown_required)}.",
            input_snapshot=snapshot,
            observed_value={"unknown_required": unknown_required},
            expected_value={"required_subset_of_properties": True},
        )
    return CriterionResult(
        criterion_name="required_argument_validation",
        status="PASS",
        score=100,
        evidence_sentence=f"{len(required)} required arguments are declared.",
        input_snapshot=snapshot,
    )


def _check_output_schema(tool: dict[str, Any]) -> CriterionResult:
    schema = tool.get("output_schema")
    snapshot = {"output_schema": schema}
    if not isinstance(schema, dict) or not schema:
        return CriterionResult(
            criterion_name="output_schema_validation",
            status="FAIL",
            score=0,
            evidence_sentence="Tool has no output schema declared.",
            input_snapshot=snapshot,
            observed_value={"present": bool(schema)},
            expected_value={"required_fields": sorted(REQUIRED_OUTPUT_SCHEMA_FIELDS)},
        )
    missing = REQUIRED_OUTPUT_SCHEMA_FIELDS - set(schema.keys())
    if missing:
        return CriterionResult(
            criterion_name="output_schema_validation",
            status="FAIL",
            score=0,
            evidence_sentence=f"Output schema is missing required fields: {', '.join(sorted(missing))}.",
            input_snapshot=snapshot,
            observed_value={"fields": sorted(schema.keys())},
            expected_value={"required_fields": sorted(REQUIRED_OUTPUT_SCHEMA_FIELDS)},
        )
    return CriterionResult(
        criterion_name="output_schema_validation",
        status="PASS",
        score=100,
        evidence_sentence="Output schema is present.",
        input_snapshot=snapshot,
    )


def _check_side_effect_level(tool: dict[str, Any]) -> CriterionResult:
    level = str(tool.get("side_effect_level") or "")
    snapshot = {"side_effect_level": level}
    if not level:
        return CriterionResult(
            criterion_name="side_effect_classification",
            status="FAIL",
            score=0,
            evidence_sentence="Tool has no side_effect_level declared.",
            input_snapshot=snapshot,
            observed_value={"side_effect_level": level},
            expected_value={"allowed_values": sorted(SIDE_EFFECT_LEVELS)},
        )
    if level not in SIDE_EFFECT_LEVELS:
        return CriterionResult(
            criterion_name="side_effect_classification",
            status="FAIL",
            score=0,
            evidence_sentence=f"side_effect_level '{level}' is not in the allowed vocabulary.",
            input_snapshot=snapshot,
            observed_value={"side_effect_level": level},
            expected_value={"allowed_values": sorted(SIDE_EFFECT_LEVELS)},
        )
    return CriterionResult(
        criterion_name="side_effect_classification",
        status="PASS",
        score=100,
        evidence_sentence=f"Side-effect level is declared as '{level}'.",
        input_snapshot=snapshot,
    )


def _check_permission_model(tool: dict[str, Any]) -> CriterionResult:
    permissions = tool.get("permissions")
    snapshot = {"permissions": permissions}
    if not isinstance(permissions, dict) or not permissions:
        return CriterionResult(
            criterion_name="permission_model_validation",
            status="FAIL",
            score=0,
            evidence_sentence="Tool has no permissions declared.",
            input_snapshot=snapshot,
            observed_value={"present": bool(permissions)},
            expected_value={"permissions": "non-empty object"},
        )
    if not any(key in permissions for key in ("requires_grant", "access_model", "scope", "data_scope")):
        return CriterionResult(
            criterion_name="permission_model_validation",
            status="REVIEW",
            score=75,
            evidence_sentence="Permissions are declared but do not describe grant or scope controls.",
            input_snapshot=snapshot,
            observed_value={"permission_keys": sorted(permissions.keys())},
            expected_value={"one_of": ["requires_grant", "access_model", "scope", "data_scope"]},
        )
    return CriterionResult(
        criterion_name="permission_model_validation",
        status="PASS",
        score=100,
        evidence_sentence=f"Permission model declares {len(permissions)} control fields.",
        input_snapshot=snapshot,
    )


def _check_pii_field_leakage(tool: dict[str, Any]) -> CriterionResult:
    output_schema = tool.get("output_schema") if isinstance(tool.get("output_schema"), dict) else {}
    properties = output_schema.get("properties") if isinstance(output_schema.get("properties"), dict) else {}
    field_names = sorted(str(name) for name in properties.keys())
    pii_fields = [
        field_name
        for field_name in field_names
        if any(pattern in field_name.lower() for pattern in PII_FIELD_PATTERNS)
    ]
    snapshot = {"output_schema_properties": field_names}
    if pii_fields:
        return CriterionResult(
            criterion_name="pii_field_leakage",
            status="REVIEW",
            score=70,
            evidence_sentence=f"Output schema contains potential sensitive fields: {', '.join(pii_fields)}.",
            input_snapshot=snapshot,
            observed_value={"sensitive_fields": pii_fields},
            expected_value={"sensitive_fields": []},
            metadata={"recommended_control": "Bind response redaction or human-review policy before production use."},
        )
    return CriterionResult(
        criterion_name="pii_field_leakage",
        status="PASS",
        score=100,
        evidence_sentence="No potential sensitive output fields were detected.",
        input_snapshot=snapshot,
    )

