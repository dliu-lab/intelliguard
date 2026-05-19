# Phase 1: Tool Evaluation And Certification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tool evaluation and certification system — DB-backed Tool Registry, deterministic tool evaluators, certification state machine, enforcement at the tool-grant API boundary, and Tool Registry UI with Evaluators and Certification tabs.

**Architecture:** Tools move from the in-memory `ToolRegistry` to a Postgres-backed `tool_records` table. A new `intelliguard/evaluation/` sub-package holds evaluator logic, the certification state machine, and enforcement checks. The tool-grant API handler calls `enforcement.py` synchronously before granting — production environments hard-block uncertified tools.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 (Mapped), PostgreSQL, pytest, Next.js 14 App Router, TypeScript, Tailwind CSS

---

## File Map

**Create (backend):**
- `intelliguard/evaluation/__init__.py`
- `intelliguard/evaluation/tool_evaluators.py`
- `intelliguard/evaluation/certification.py`
- `intelliguard/evaluation/enforcement.py`
- `tests/evaluation/__init__.py`
- `tests/evaluation/test_tool_evaluators.py`
- `tests/evaluation/test_certification.py`
- `tests/evaluation/test_enforcement.py`

**Modify (backend):**
- `intelliguard/models.py` — add `ToolRecord`, `ToolCertification`, `EvaluationRun`, `EvaluationCriterionResult`
- `intelliguard/store.py` — add tool record and certification store methods
- `api/main.py` — replace `/v1/tool-marketplace` with DB-backed `/v1/tools`, add evaluate/certification endpoints, enforce certification in tool-grant

**Create (frontend):**
- `dashboard/app/platform/_components/ToolRegistryWorkspace.tsx`
- `dashboard/app/platform/_components/ToolEvaluatorsPanel.tsx`
- `dashboard/app/platform/_components/ToolCertificationPanel.tsx`

**Modify (frontend):**
- `dashboard/lib/api.ts` — add tool registry, evaluation, and certification API functions
- `dashboard/app/platform/_components/config.ts` — add Tool Registry nav view

---

## Task 1: Add DB Models

**Files:**
- Modify: `intelliguard/models.py`
- Test: `tests/evaluation/test_tool_evaluators.py` (fixture setup only in this task)

- [ ] **Step 1: Add four new models to `intelliguard/models.py`**

Add after the `KnowledgeBase` model at the end of the file:

```python
class ToolRecord(Base):
    __tablename__ = "tool_records"

    tool_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tool_name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(String(80), nullable=False, default="custom")
    side_effect_level: Mapped[str] = mapped_column(String(40), nullable=False, default="read_only")
    input_schema: Mapped[dict] = mapped_column(JSONB, default=dict)
    output_schema: Mapped[dict] = mapped_column(JSONB, default=dict)
    permissions: Mapped[dict] = mapped_column(JSONB, default=dict)
    allowed_actions: Mapped[list] = mapped_column(JSONB, default=list)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    owner: Mapped[str] = mapped_column(String(120), nullable=False)
    config_hash: Mapped[str | None] = mapped_column(String(64))
    artifact_digest: Mapped[str | None] = mapped_column(String(128))
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ToolCertification(Base):
    __tablename__ = "tool_certifications"

    certification_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tool_id: Mapped[str] = mapped_column(
        ForeignKey("tool_records.tool_id"), nullable=False, unique=True
    )
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="DRAFT")
    config_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    artifact_digest: Mapped[str | None] = mapped_column(String(128))
    last_evaluation_run_id: Mapped[str | None] = mapped_column(String(64))
    certified_by: Mapped[str | None] = mapped_column(String(160))
    certified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class EvaluationRun(Base):
    __tablename__ = "evaluation_runs"

    run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[str] = mapped_column(String(120), nullable=False)
    config_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    artifact_digest: Mapped[str | None] = mapped_column(String(128))
    triggered_by: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="RUNNING")
    overall_result: Mapped[str | None] = mapped_column(String(20))
    criteria_total: Mapped[int] = mapped_column(Integer, default=0)
    criteria_passed: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EvaluationCriterionResult(Base):
    __tablename__ = "evaluation_criterion_results"

    criterion_result_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("evaluation_runs.run_id"), nullable=False
    )
    evaluator_id: Mapped[str] = mapped_column(String(64), nullable=False)
    criterion_name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    evidence: Mapped[str] = mapped_column(Text, nullable=False)
    input_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
```

- [ ] **Step 2: Verify models import correctly**

```bash
cd /Users/dliu520/AIYA/Git/intelliguard
python -c "from intelliguard.models import ToolRecord, ToolCertification, EvaluationRun, EvaluationCriterionResult; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add intelliguard/models.py
git commit -m "feat(evaluation): add ToolRecord, ToolCertification, EvaluationRun, EvaluationCriterionResult models"
```

---

## Task 2: Create Evaluation Package And Tool Evaluators

**Files:**
- Create: `intelliguard/evaluation/__init__.py`
- Create: `intelliguard/evaluation/tool_evaluators.py`
- Create: `tests/evaluation/__init__.py`
- Create: `tests/evaluation/test_tool_evaluators.py`

- [ ] **Step 1: Create `intelliguard/evaluation/__init__.py`**

```python
```

(empty file — marks the package)

- [ ] **Step 2: Create `tests/evaluation/__init__.py`**

```python
```

(empty file)

- [ ] **Step 3: Write failing tests for tool evaluators**

Create `tests/evaluation/test_tool_evaluators.py`:

```python
from __future__ import annotations

import pytest
from intelliguard.evaluation.tool_evaluators import (
    CriterionResult,
    compute_config_hash,
    run_tool_evaluators,
)


def _base_tool() -> dict:
    return {
        "tool_name": "lookup_account",
        "side_effect_level": "read_only",
        "input_schema": {
            "type": "object",
            "properties": {"account_id": {"type": "string"}},
            "required": ["account_id"],
        },
        "output_schema": {
            "type": "object",
            "properties": {"balance": {"type": "number"}},
        },
        "permissions": {"requires_grant": True},
        "allowed_actions": ["read_account"],
    }


def test_all_pass_for_well_formed_tool():
    results = run_tool_evaluators(_base_tool())
    failed = [r for r in results if r.status == "FAIL"]
    assert failed == [], f"Unexpected failures: {[r.criterion_name for r in failed]}"


def test_missing_input_schema_fails():
    tool = _base_tool()
    del tool["input_schema"]
    results = run_tool_evaluators(tool)
    names = {r.criterion_name: r.status for r in results}
    assert names["input_schema_validation"] == "FAIL"


def test_missing_output_schema_fails():
    tool = _base_tool()
    del tool["output_schema"]
    results = run_tool_evaluators(tool)
    names = {r.criterion_name: r.status for r in results}
    assert names["output_schema_validation"] == "FAIL"


def test_invalid_side_effect_level_fails():
    tool = _base_tool()
    tool["side_effect_level"] = "magic_action"
    results = run_tool_evaluators(tool)
    names = {r.criterion_name: r.status for r in results}
    assert names["side_effect_classification"] == "FAIL"


def test_missing_permissions_fails():
    tool = _base_tool()
    tool["permissions"] = {}
    results = run_tool_evaluators(tool)
    names = {r.criterion_name: r.status for r in results}
    assert names["permission_model_validation"] == "FAIL"


def test_pii_field_in_output_schema_triggers_review():
    tool = _base_tool()
    tool["output_schema"]["properties"]["email"] = {"type": "string"}
    results = run_tool_evaluators(tool)
    names = {r.criterion_name: r.status for r in results}
    assert names["pii_field_leakage"] == "REVIEW"


def test_missing_required_list_triggers_review():
    tool = _base_tool()
    del tool["input_schema"]["required"]
    results = run_tool_evaluators(tool)
    names = {r.criterion_name: r.status for r in results}
    assert names["required_argument_validation"] == "REVIEW"


def test_compute_config_hash_is_stable():
    tool = _base_tool()
    h1 = compute_config_hash(tool)
    h2 = compute_config_hash(tool)
    assert h1 == h2
    assert len(h1) == 32


def test_compute_config_hash_changes_on_schema_change():
    tool = _base_tool()
    h1 = compute_config_hash(tool)
    tool["input_schema"]["properties"]["extra_field"] = {"type": "string"}
    h2 = compute_config_hash(tool)
    assert h1 != h2
```

- [ ] **Step 4: Run tests to confirm they fail**

```bash
cd /Users/dliu520/AIYA/Git/intelliguard
pytest tests/evaluation/test_tool_evaluators.py -v 2>&1 | head -20
```

Expected: `ImportError` or `ModuleNotFoundError` — `tool_evaluators` does not exist yet.

- [ ] **Step 5: Create `intelliguard/evaluation/tool_evaluators.py`**

```python
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

SIDE_EFFECT_LEVELS = frozenset({
    "read_only", "write_update", "external_communication",
    "financial_action", "credential_action",
})
REQUIRED_INPUT_SCHEMA_FIELDS = frozenset({"type", "properties"})
REQUIRED_OUTPUT_SCHEMA_FIELDS = frozenset({"type"})
PII_FIELD_PATTERNS = frozenset({
    "email", "phone", "ssn", "password", "credit_card", "dob", "address",
})


@dataclass
class CriterionResult:
    criterion_name: str
    status: str  # PASS | FAIL | REVIEW
    evidence: str
    input_snapshot: dict[str, Any]


def run_tool_evaluators(tool: dict[str, Any]) -> list[CriterionResult]:
    return [
        _check_input_schema(tool),
        _check_output_schema(tool),
        _check_side_effect_level(tool),
        _check_permission_model(tool),
        _check_pii_field_leakage(tool),
        _check_required_arguments(tool),
    ]


def compute_config_hash(tool: dict[str, Any]) -> str:
    fields = {
        "input_schema": tool.get("input_schema", {}),
        "output_schema": tool.get("output_schema", {}),
        "side_effect_level": tool.get("side_effect_level", ""),
        "permissions": tool.get("permissions", {}),
        "allowed_actions": sorted(tool.get("allowed_actions", [])),
    }
    canonical = json.dumps(fields, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()[:32]


def _check_input_schema(tool: dict[str, Any]) -> CriterionResult:
    snapshot = {"input_schema": tool.get("input_schema")}
    schema = tool.get("input_schema")
    if not schema:
        return CriterionResult("input_schema_validation", "FAIL",
                               "Tool has no input schema declared", snapshot)
    missing = REQUIRED_INPUT_SCHEMA_FIELDS - set(schema.keys())
    if missing:
        return CriterionResult("input_schema_validation", "FAIL",
                               f"Input schema missing required fields: {sorted(missing)}", snapshot)
    return CriterionResult("input_schema_validation", "PASS",
                           "Input schema present with required fields", snapshot)


def _check_output_schema(tool: dict[str, Any]) -> CriterionResult:
    snapshot = {"output_schema": tool.get("output_schema")}
    schema = tool.get("output_schema")
    if not schema:
        return CriterionResult("output_schema_validation", "FAIL",
                               "Tool has no output schema declared", snapshot)
    missing = REQUIRED_OUTPUT_SCHEMA_FIELDS - set(schema.keys())
    if missing:
        return CriterionResult("output_schema_validation", "FAIL",
                               f"Output schema missing required fields: {sorted(missing)}", snapshot)
    return CriterionResult("output_schema_validation", "PASS",
                           "Output schema present with required fields", snapshot)


def _check_side_effect_level(tool: dict[str, Any]) -> CriterionResult:
    level = tool.get("side_effect_level", "")
    snapshot = {"side_effect_level": level}
    if not level:
        return CriterionResult("side_effect_classification", "FAIL",
                               "Tool has no side_effect_level declared", snapshot)
    if level not in SIDE_EFFECT_LEVELS:
        return CriterionResult("side_effect_classification", "FAIL",
                               f"side_effect_level '{level}' not in {sorted(SIDE_EFFECT_LEVELS)}",
                               snapshot)
    return CriterionResult("side_effect_classification", "PASS",
                           f"Side effect level declared as '{level}'", snapshot)


def _check_permission_model(tool: dict[str, Any]) -> CriterionResult:
    permissions = tool.get("permissions", {})
    snapshot = {"permissions": permissions}
    if not permissions:
        return CriterionResult("permission_model_validation", "FAIL",
                               "Tool has no permissions declared", snapshot)
    return CriterionResult("permission_model_validation", "PASS",
                           f"Permissions declared with {len(permissions)} entries", snapshot)


def _check_pii_field_leakage(tool: dict[str, Any]) -> CriterionResult:
    properties = tool.get("output_schema", {}).get("properties", {})
    snapshot = {"output_schema_properties": list(properties.keys())}
    pii = [f for f in properties if any(p in f.lower() for p in PII_FIELD_PATTERNS)]
    if pii:
        return CriterionResult("pii_field_leakage", "REVIEW",
                               f"Output schema contains potential PII fields: {pii}", snapshot)
    return CriterionResult("pii_field_leakage", "PASS",
                           "No potential PII fields detected in output schema", snapshot)


def _check_required_arguments(tool: dict[str, Any]) -> CriterionResult:
    input_schema = tool.get("input_schema", {})
    properties = input_schema.get("properties", {})
    required = input_schema.get("required", [])
    snapshot = {"properties": list(properties.keys()), "required": required}
    if properties and not required:
        return CriterionResult("required_argument_validation", "REVIEW",
                               "Input schema has properties but no 'required' list declared",
                               snapshot)
    return CriterionResult("required_argument_validation", "PASS",
                           f"{len(required)} required arguments declared", snapshot)
```

- [ ] **Step 6: Run tests — all must pass**

```bash
pytest tests/evaluation/test_tool_evaluators.py -v
```

Expected: 9 tests passing.

- [ ] **Step 7: Commit**

```bash
git add intelliguard/evaluation/__init__.py intelliguard/evaluation/tool_evaluators.py tests/evaluation/__init__.py tests/evaluation/test_tool_evaluators.py
git commit -m "feat(evaluation): tool evaluators with 6 deterministic criteria"
```

---

## Task 3: Certification State Machine

**Files:**
- Create: `intelliguard/evaluation/certification.py`
- Create: `tests/evaluation/test_certification.py`

- [ ] **Step 1: Write failing tests**

Create `tests/evaluation/test_certification.py`:

```python
from __future__ import annotations

import pytest
from intelliguard.evaluation.certification import (
    CertificationDecision,
    CertificationError,
    decide_certification,
    validate_transition,
)


def test_all_pass_gives_certified():
    results = [
        {"criterion_name": "input_schema_validation", "status": "PASS", "evidence": "ok"},
        {"criterion_name": "pii_field_leakage", "status": "REVIEW", "evidence": "email present"},
    ]
    decision = decide_certification(results)
    assert decision.status == "CERTIFIED"
    assert decision.failure_reason is None


def test_any_fail_gives_failed():
    results = [
        {"criterion_name": "input_schema_validation", "status": "FAIL", "evidence": "no schema"},
        {"criterion_name": "output_schema_validation", "status": "PASS", "evidence": "ok"},
    ]
    decision = decide_certification(results)
    assert decision.status == "FAILED"
    assert "no schema" in decision.failure_reason


def test_multiple_failures_combine_reasons():
    results = [
        {"criterion_name": "input_schema_validation", "status": "FAIL", "evidence": "no schema"},
        {"criterion_name": "permission_model_validation", "status": "FAIL", "evidence": "no perms"},
    ]
    decision = decide_certification(results)
    assert "no schema" in decision.failure_reason
    assert "no perms" in decision.failure_reason


def test_valid_transition_draft_to_evaluating():
    validate_transition("DRAFT", "EVALUATING")  # must not raise


def test_valid_transition_evaluating_to_certified():
    validate_transition("EVALUATING", "CERTIFIED")  # must not raise


def test_valid_transition_certified_to_needs_reevaluation():
    validate_transition("CERTIFIED", "NEEDS_REEVALUATION")  # must not raise


def test_invalid_transition_raises():
    with pytest.raises(CertificationError, match="DRAFT -> CERTIFIED"):
        validate_transition("DRAFT", "CERTIFIED")


def test_invalid_transition_certified_to_draft_raises():
    with pytest.raises(CertificationError):
        validate_transition("CERTIFIED", "DRAFT")
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pytest tests/evaluation/test_certification.py -v 2>&1 | head -10
```

Expected: `ImportError`

- [ ] **Step 3: Create `intelliguard/evaluation/certification.py`**

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

VALID_TRANSITIONS: dict[str, frozenset[str]] = {
    "DRAFT": frozenset({"EVALUATING"}),
    "EVALUATING": frozenset({"CERTIFIED", "FAILED"}),
    "CERTIFIED": frozenset({"NEEDS_REEVALUATION"}),
    "FAILED": frozenset({"EVALUATING"}),
    "NEEDS_REEVALUATION": frozenset({"EVALUATING"}),
}


class CertificationError(Exception):
    pass


@dataclass
class CertificationDecision:
    status: str  # CERTIFIED | FAILED
    failure_reason: str | None


def decide_certification(criterion_results: list[dict[str, Any]]) -> CertificationDecision:
    failed = [r for r in criterion_results if r["status"] == "FAIL"]
    if failed:
        reasons = "; ".join(r["evidence"] for r in failed)
        return CertificationDecision(status="FAILED", failure_reason=reasons)
    return CertificationDecision(status="CERTIFIED", failure_reason=None)


def validate_transition(current: str, next_status: str) -> None:
    allowed = VALID_TRANSITIONS.get(current, frozenset())
    if next_status not in allowed:
        raise CertificationError(
            f"Invalid certification transition: {current} -> {next_status}. "
            f"Allowed from {current!r}: {sorted(allowed)}"
        )
```

- [ ] **Step 4: Run tests — all must pass**

```bash
pytest tests/evaluation/test_certification.py -v
```

Expected: 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add intelliguard/evaluation/certification.py tests/evaluation/test_certification.py
git commit -m "feat(evaluation): certification state machine and decision logic"
```

---

## Task 4: Enforcement Module

**Files:**
- Create: `intelliguard/evaluation/enforcement.py`
- Create: `tests/evaluation/test_enforcement.py`

- [ ] **Step 1: Write failing tests**

Create `tests/evaluation/test_enforcement.py`:

```python
from __future__ import annotations

import pytest
from unittest.mock import MagicMock
from intelliguard.evaluation.enforcement import (
    CertificationEnforcementError,
    check_tool_certification,
)


def _store_with_cert(status: str) -> MagicMock:
    store = MagicMock()
    store.get_tool_certification.return_value = {"status": status}
    return store


def test_certified_tool_passes_in_production():
    store = _store_with_cert("CERTIFIED")
    check_tool_certification(store, "tool_123", "production")  # must not raise


def test_failed_tool_blocked_in_production():
    store = _store_with_cert("FAILED")
    with pytest.raises(CertificationEnforcementError, match="FAILED"):
        check_tool_certification(store, "tool_123", "production")


def test_draft_tool_blocked_in_production():
    store = _store_with_cert("DRAFT")
    with pytest.raises(CertificationEnforcementError, match="DRAFT"):
        check_tool_certification(store, "tool_123", "production")


def test_no_certification_record_blocked_in_production():
    store = MagicMock()
    store.get_tool_certification.return_value = None
    with pytest.raises(CertificationEnforcementError, match="no certification record"):
        check_tool_certification(store, "tool_123", "production")


def test_draft_tool_allowed_in_demo():
    store = _store_with_cert("DRAFT")
    check_tool_certification(store, "tool_123", "demo")  # must not raise


def test_failed_tool_allowed_in_dev():
    store = _store_with_cert("FAILED")
    check_tool_certification(store, "tool_123", "dev")  # must not raise


def test_needs_reevaluation_blocked_in_production():
    store = _store_with_cert("NEEDS_REEVALUATION")
    with pytest.raises(CertificationEnforcementError):
        check_tool_certification(store, "tool_123", "production")
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pytest tests/evaluation/test_enforcement.py -v 2>&1 | head -10
```

Expected: `ImportError`

- [ ] **Step 3: Create `intelliguard/evaluation/enforcement.py`**

```python
from __future__ import annotations

PRODUCTION_ENVIRONMENTS = frozenset({"production", "prod"})


class CertificationEnforcementError(Exception):
    pass


def check_tool_certification(store: object, tool_id: str, environment: str) -> None:
    """
    In production environments, tools must have CERTIFIED status before
    they can be attached to agents. Lower environments are permissive.
    Raises CertificationEnforcementError if the check fails.
    """
    if environment not in PRODUCTION_ENVIRONMENTS:
        return

    cert = store.get_tool_certification(tool_id)
    if cert is None:
        raise CertificationEnforcementError(
            f"Tool '{tool_id}' has no certification record. "
            "Run tool evaluation before attaching to agents in production."
        )
    status = cert.get("status", "DRAFT")
    if status != "CERTIFIED":
        raise CertificationEnforcementError(
            f"Tool '{tool_id}' has certification status '{status}'. "
            "Only CERTIFIED tools can be attached to agents in production environments."
        )
```

- [ ] **Step 4: Run tests — all must pass**

```bash
pytest tests/evaluation/test_enforcement.py -v
```

Expected: 7 tests passing.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
pytest tests/ -v
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add intelliguard/evaluation/enforcement.py tests/evaluation/test_enforcement.py
git commit -m "feat(evaluation): enforcement module — hard-block uncertified tools in production"
```

---

## Task 5: Store Methods For Tool Records And Certifications

**Files:**
- Modify: `intelliguard/store.py`

- [ ] **Step 1: Add imports for new models at the top of `store.py`**

Add to the existing import block from `intelliguard.models`:

```python
    EvaluationCriterionResult,
    EvaluationRun,
    ToolCertification,
    ToolRecord,
```

- [ ] **Step 2: Add tool record store methods**

Add after the existing `deleteAgentKnowledgeBase`-equivalent methods in `store.py`:

```python
    def create_tool_record(self, payload: dict[str, Any]) -> dict[str, Any]:
        from intelliguard.evaluation.tool_evaluators import compute_config_hash
        tool_id = payload.get("tool_id") or new_id("tool")
        config_hash = compute_config_hash(payload)
        with self.session() as db:
            record = ToolRecord(
                tool_id=tool_id,
                tool_name=payload["tool_name"],
                display_name=payload.get("display_name") or payload["tool_name"].replace("_", " ").title(),
                description=payload.get("description", ""),
                category=payload.get("category", "custom"),
                side_effect_level=payload.get("side_effect_level", "read_only"),
                input_schema=payload.get("input_schema", {}),
                output_schema=payload.get("output_schema", {}),
                permissions=payload.get("permissions", {}),
                allowed_actions=payload.get("allowed_actions", []),
                environment=payload.get("environment", "demo"),
                owner=payload.get("owner", "Unassigned"),
                config_hash=config_hash,
                artifact_digest=payload.get("artifact_digest"),
                metadata_json=payload.get("metadata", {}),
            )
            db.add(record)
            db.flush()
            cert = ToolCertification(
                certification_id=new_id("cert"),
                tool_id=tool_id,
                status="DRAFT",
                config_hash=config_hash,
                artifact_digest=payload.get("artifact_digest"),
            )
            db.add(cert)
            db.commit()
            db.refresh(record)
            return self._tool_record_to_dict(record)

    def list_tool_records(self) -> list[dict[str, Any]]:
        with self.session() as db:
            records = db.scalars(select(ToolRecord).order_by(ToolRecord.created_at.desc())).all()
            return [self._tool_record_to_dict(r) for r in records]

    def get_tool_record(self, tool_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            record = db.get(ToolRecord, tool_id)
            return self._tool_record_to_dict(record) if record else None

    def get_tool_record_by_name(self, tool_name: str) -> dict[str, Any] | None:
        with self.session() as db:
            record = db.scalar(select(ToolRecord).where(ToolRecord.tool_name == tool_name))
            return self._tool_record_to_dict(record) if record else None

    def _tool_record_to_dict(self, record: ToolRecord) -> dict[str, Any]:
        return {
            "tool_id": record.tool_id,
            "tool_name": record.tool_name,
            "display_name": record.display_name,
            "description": record.description,
            "category": record.category,
            "side_effect_level": record.side_effect_level,
            "input_schema": record.input_schema,
            "output_schema": record.output_schema,
            "permissions": record.permissions,
            "allowed_actions": record.allowed_actions,
            "environment": record.environment,
            "owner": record.owner,
            "config_hash": record.config_hash,
            "artifact_digest": record.artifact_digest,
            "metadata": record.metadata_json,
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat(),
        }
```

- [ ] **Step 3: Add tool certification store methods**

```python
    def get_tool_certification(self, tool_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            cert = db.scalar(
                select(ToolCertification).where(ToolCertification.tool_id == tool_id)
            )
            return self._cert_to_dict(cert) if cert else None

    def update_tool_certification(self, tool_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            cert = db.scalar(
                select(ToolCertification).where(ToolCertification.tool_id == tool_id)
            )
            if not cert:
                raise ValueError(f"No certification record for tool '{tool_id}'")
            for field in ("status", "config_hash", "artifact_digest", "last_evaluation_run_id",
                          "certified_by", "certified_at", "expires_at", "failure_reason"):
                if field in payload:
                    setattr(cert, field, payload[field])
            cert.updated_at = utc_now()
            db.commit()
            db.refresh(cert)
            return self._cert_to_dict(cert)

    def _cert_to_dict(self, cert: ToolCertification) -> dict[str, Any]:
        return {
            "certification_id": cert.certification_id,
            "tool_id": cert.tool_id,
            "status": cert.status,
            "config_hash": cert.config_hash,
            "artifact_digest": cert.artifact_digest,
            "last_evaluation_run_id": cert.last_evaluation_run_id,
            "certified_by": cert.certified_by,
            "certified_at": cert.certified_at.isoformat() if cert.certified_at else None,
            "expires_at": cert.expires_at.isoformat() if cert.expires_at else None,
            "failure_reason": cert.failure_reason,
            "created_at": cert.created_at.isoformat(),
            "updated_at": cert.updated_at.isoformat(),
        }
```

- [ ] **Step 4: Add evaluation run store methods**

```python
    def create_evaluation_run(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            run = EvaluationRun(
                run_id=new_id("run"),
                target_type=payload["target_type"],
                target_id=payload["target_id"],
                config_hash=payload["config_hash"],
                artifact_digest=payload.get("artifact_digest"),
                triggered_by=payload["triggered_by"],
                status="RUNNING",
            )
            db.add(run)
            db.commit()
            db.refresh(run)
            return self._run_to_dict(run)

    def complete_evaluation_run(
        self,
        run_id: str,
        overall_result: str,
        criteria_total: int,
        criteria_passed: int,
        duration_ms: int,
    ) -> dict[str, Any]:
        with self.session() as db:
            run = db.get(EvaluationRun, run_id)
            if not run:
                raise ValueError(f"Evaluation run '{run_id}' not found")
            run.status = "PASSED" if overall_result == "PASS" else "FAILED"
            run.overall_result = overall_result
            run.criteria_total = criteria_total
            run.criteria_passed = criteria_passed
            run.duration_ms = duration_ms
            run.completed_at = utc_now()
            db.commit()
            db.refresh(run)
            return self._run_to_dict(run)

    def add_evaluation_criterion_results(
        self, run_id: str, results: list[dict[str, Any]]
    ) -> None:
        with self.session() as db:
            for r in results:
                row = EvaluationCriterionResult(
                    criterion_result_id=new_id("crit"),
                    run_id=run_id,
                    evaluator_id=r["evaluator_id"],
                    criterion_name=r["criterion_name"],
                    status=r["status"],
                    evidence=r["evidence"],
                    input_snapshot=r.get("input_snapshot", {}),
                )
                db.add(row)
            db.commit()

    def list_evaluation_runs_for_tool(self, tool_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            runs = db.scalars(
                select(EvaluationRun)
                .where(EvaluationRun.target_type == "tool", EvaluationRun.target_id == tool_id)
                .order_by(EvaluationRun.created_at.desc())
            ).all()
            return [self._run_to_dict(r) for r in runs]

    def list_evaluation_criterion_results(self, run_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(EvaluationCriterionResult)
                .where(EvaluationCriterionResult.run_id == run_id)
                .order_by(EvaluationCriterionResult.created_at)
            ).all()
            return [
                {
                    "criterion_result_id": r.criterion_result_id,
                    "run_id": r.run_id,
                    "evaluator_id": r.evaluator_id,
                    "criterion_name": r.criterion_name,
                    "status": r.status,
                    "evidence": r.evidence,
                    "input_snapshot": r.input_snapshot,
                    "created_at": r.created_at.isoformat(),
                }
                for r in rows
            ]

    def _run_to_dict(self, run: EvaluationRun) -> dict[str, Any]:
        return {
            "run_id": run.run_id,
            "target_type": run.target_type,
            "target_id": run.target_id,
            "config_hash": run.config_hash,
            "artifact_digest": run.artifact_digest,
            "triggered_by": run.triggered_by,
            "status": run.status,
            "overall_result": run.overall_result,
            "criteria_total": run.criteria_total,
            "criteria_passed": run.criteria_passed,
            "duration_ms": run.duration_ms,
            "created_at": run.created_at.isoformat(),
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        }
```

- [ ] **Step 5: Verify imports and basic usage**

```bash
cd /Users/dliu520/AIYA/Git/intelliguard
python -c "
from intelliguard.store import GovernanceStore
print('store imports OK')
"
```

Expected: `store imports OK`

- [ ] **Step 6: Run full test suite**

```bash
pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add intelliguard/store.py
git commit -m "feat(evaluation): store methods for tool records, certifications, and evaluation runs"
```

---

## Task 6: API Endpoints — Tool Registry, Evaluate, Certification, Enforcement

**Files:**
- Modify: `api/main.py`

- [ ] **Step 1: Add Pydantic request models to `api/main.py`**

Add after the existing `ToolCreateRequest` model:

```python
class ToolRegistryCreateRequest(BaseModel):
    tool_name: str
    display_name: str | None = None
    description: str = ""
    category: str = "custom"
    side_effect_level: str = "read_only"
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    permissions: dict[str, Any] = Field(default_factory=dict)
    allowed_actions: list[str] = Field(default_factory=list)
    environment: str = "demo"
    owner: str = "Unassigned"
    artifact_digest: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
```

- [ ] **Step 2: Add Tool Registry CRUD endpoints**

Add after the existing `@app.post("/v1/tool-marketplace")` block:

```python
@app.get("/v1/tool-registry")
def list_tool_registry(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return store.list_tool_records()


@app.post("/v1/tool-registry")
def create_tool_registry(
    request: ToolRegistryCreateRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    require_environment_access(user, request.environment, "tool:create")
    return store.create_tool_record(request.model_dump())


@app.get("/v1/tool-registry/{tool_id}")
def get_tool_registry(tool_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    tool = store.get_tool_record(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    return tool
```

- [ ] **Step 3: Add tool evaluate endpoint**

```python
@app.post("/v1/tool-registry/{tool_id}/evaluate")
def evaluate_tool(tool_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    from time import monotonic
    from intelliguard.evaluation.tool_evaluators import run_tool_evaluators
    from intelliguard.evaluation.certification import decide_certification, validate_transition

    tool = store.get_tool_record(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")

    cert = store.get_tool_certification(tool_id)
    current_status = cert["status"] if cert else "DRAFT"
    try:
        validate_transition(current_status, "EVALUATING")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    store.update_tool_certification(tool_id, {"status": "EVALUATING"})
    run = store.create_evaluation_run({
        "target_type": "tool",
        "target_id": tool_id,
        "config_hash": tool["config_hash"],
        "artifact_digest": tool.get("artifact_digest"),
        "triggered_by": user["email"],
    })
    run_id = run["run_id"]

    start = monotonic()
    criterion_results = run_tool_evaluators(tool)
    duration_ms = int((monotonic() - start) * 1000)

    results_dicts = [
        {
            "evaluator_id": "tool_baseline",
            "criterion_name": r.criterion_name,
            "status": r.status,
            "evidence": r.evidence,
            "input_snapshot": r.input_snapshot,
        }
        for r in criterion_results
    ]
    store.add_evaluation_criterion_results(run_id, results_dicts)

    passed = sum(1 for r in criterion_results if r.status == "PASS")
    decision = decide_certification(results_dicts)
    store.complete_evaluation_run(
        run_id,
        overall_result=decision.status,
        criteria_total=len(criterion_results),
        criteria_passed=passed,
        duration_ms=duration_ms,
    )

    next_cert_status = decision.status  # CERTIFIED or FAILED
    store.update_tool_certification(tool_id, {
        "status": next_cert_status,
        "last_evaluation_run_id": run_id,
        "certified_by": user["email"] if next_cert_status == "CERTIFIED" else None,
        "certified_at": utc_now() if next_cert_status == "CERTIFIED" else None,
        "failure_reason": decision.failure_reason,
    })

    return {
        "run_id": run_id,
        "tool_id": tool_id,
        "overall_result": decision.status,
        "criteria_total": len(criterion_results),
        "criteria_passed": passed,
        "duration_ms": duration_ms,
        "criterion_results": results_dicts,
    }
```

Note: add `from intelliguard.models import utc_now` to the top of `api/main.py` if not already imported.

- [ ] **Step 4: Add tool certification GET endpoint**

```python
@app.get("/v1/tool-registry/{tool_id}/certification")
def get_tool_certification(
    tool_id: str, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    cert = store.get_tool_certification(tool_id)
    if not cert:
        raise HTTPException(status_code=404, detail="Certification record not found")
    return cert


@app.get("/v1/tool-registry/{tool_id}/evaluation-runs")
def list_tool_evaluation_runs(
    tool_id: str, user: dict[str, Any] = Depends(current_user)
) -> list[dict[str, Any]]:
    return store.list_evaluation_runs_for_tool(tool_id)


@app.get("/v1/evaluation-runs/{run_id}/criteria")
def get_evaluation_criterion_results(
    run_id: str, user: dict[str, Any] = Depends(current_user)
) -> list[dict[str, Any]]:
    return store.list_evaluation_criterion_results(run_id)
```

- [ ] **Step 5: Update tool-grant endpoint to enforce certification**

Replace the existing `grant_agent_tool` function body:

```python
@app.post("/v1/agents/{agent_id}/tool-grants")
def grant_agent_tool(
    agent_id: str, request: AgentToolGrantRequest, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    from intelliguard.evaluation.enforcement import (
        CertificationEnforcementError,
        check_tool_certification,
    )

    # Look up tool by name in tool_records (new DB-backed registry)
    tool = store.get_tool_record_by_name(request.tool_name)
    if not tool and request.tool_name not in registry.names():
        raise HTTPException(status_code=400, detail="Unknown tool")

    agent_env = store.agent_environment(agent_id)
    require_environment_access(user, agent_env, "tool:grant")

    # Enforce certification for tools registered in tool_records
    if tool:
        try:
            check_tool_certification(store, tool["tool_id"], agent_env)
        except CertificationEnforcementError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc

    return store.grant_agent_tool(agent_id, request.tool_name)
```

- [ ] **Step 6: Start the API and verify endpoints exist**

```bash
cd /Users/dliu520/AIYA/Git/intelliguard
uvicorn api.main:app --reload --port 8000 &
sleep 2
curl -s http://localhost:8000/v1/tool-registry | python -m json.tool
```

Expected: `[]` (empty array — no tools yet)

```bash
kill %1
```

- [ ] **Step 7: Run full test suite**

```bash
pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add api/main.py
git commit -m "feat(evaluation): tool registry API, evaluate endpoint, certification endpoint, enforcement in tool-grant"
```

---

## Task 7: Frontend — API Functions

**Files:**
- Modify: `dashboard/lib/api.ts`

- [ ] **Step 1: Add tool registry types and API functions to `dashboard/lib/api.ts`**

Add after the existing `PlatformData` type:

```typescript
export type ToolRecord = {
  tool_id: string;
  tool_name: string;
  display_name: string;
  description: string;
  category: string;
  side_effect_level: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  permissions: Record<string, unknown>;
  allowed_actions: string[];
  environment: string;
  owner: string;
  config_hash: string | null;
  artifact_digest: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ToolCertification = {
  certification_id: string;
  tool_id: string;
  status: "DRAFT" | "EVALUATING" | "CERTIFIED" | "FAILED" | "NEEDS_REEVALUATION";
  config_hash: string;
  artifact_digest: string | null;
  last_evaluation_run_id: string | null;
  certified_by: string | null;
  certified_at: string | null;
  expires_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type EvaluationRun = {
  run_id: string;
  target_type: string;
  target_id: string;
  config_hash: string;
  triggered_by: string;
  status: string;
  overall_result: string | null;
  criteria_total: number;
  criteria_passed: number;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
};

export type CriterionResult = {
  criterion_result_id: string;
  run_id: string;
  evaluator_id: string;
  criterion_name: string;
  status: "PASS" | "FAIL" | "REVIEW";
  evidence: string;
  input_snapshot: Record<string, unknown>;
  created_at: string;
};
```

Add after the existing API functions:

```typescript
export function listToolRegistry(token: string) {
  return request<ToolRecord[]>("/v1/tool-registry", {
    headers: authHeaders(token),
  });
}

export function createToolRecord(token: string, payload: ApiRecord) {
  return request<ToolRecord>("/v1/tool-registry", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function getToolRecord(token: string, toolId: string) {
  return request<ToolRecord>(`/v1/tool-registry/${encodeURIComponent(toolId)}`, {
    headers: authHeaders(token),
  });
}

export function evaluateTool(token: string, toolId: string) {
  return request<ApiRecord>(`/v1/tool-registry/${encodeURIComponent(toolId)}/evaluate`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export function getToolCertification(token: string, toolId: string) {
  return request<ToolCertification>(`/v1/tool-registry/${encodeURIComponent(toolId)}/certification`, {
    headers: authHeaders(token),
  });
}

export function listToolEvaluationRuns(token: string, toolId: string) {
  return request<EvaluationRun[]>(`/v1/tool-registry/${encodeURIComponent(toolId)}/evaluation-runs`, {
    headers: authHeaders(token),
  });
}

export function listEvaluationCriteriaResults(token: string, runId: string) {
  return request<CriterionResult[]>(`/v1/evaluation-runs/${encodeURIComponent(runId)}/criteria`, {
    headers: authHeaders(token),
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/dliu520/AIYA/Git/intelliguard/dashboard
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/api.ts
git commit -m "feat(evaluation): tool registry, certification, and evaluation run API client functions"
```

---

## Task 8: Frontend — Tool Registry Workspace

**Files:**
- Create: `dashboard/app/platform/_components/ToolRegistryWorkspace.tsx`
- Create: `dashboard/app/platform/_components/ToolCertificationPanel.tsx`
- Create: `dashboard/app/platform/_components/ToolEvaluatorsPanel.tsx`
- Modify: `dashboard/app/platform/_components/config.ts`

- [ ] **Step 1: Add Tool Registry nav view to `config.ts`**

Add after the `"control"` entry in `workspaceViews`:

```typescript
  {
    id: "tool-registry",
    label: "Tool Registry",
    title: "Tool Registry",
    description: "Register, evaluate, and certify tools before attaching them to agents.",
  },
```

- [ ] **Step 2: Create `ToolCertificationPanel.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { ToolCertification, EvaluationRun } from "@/lib/api";

interface Props {
  certification: ToolCertification | null;
  runs: EvaluationRun[];
  onEvaluate: () => Promise<void>;
  evaluating: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  CERTIFIED: "bg-emerald-400/15 text-emerald-300 border border-emerald-400/40",
  FAILED: "bg-rose-400/15 text-rose-300 border border-rose-400/40",
  EVALUATING: "bg-amber-400/15 text-amber-300 border border-amber-400/40",
  DRAFT: "bg-white/[0.06] text-textSecondary border border-line",
  NEEDS_REEVALUATION: "bg-violet-400/15 text-violet-300 border border-violet-400/40",
};

export function ToolCertificationPanel({ certification, runs, onEvaluate, evaluating }: Props) {
  if (!certification) {
    return (
      <div className="text-sm text-textSecondary py-6 text-center">
        No certification record found.
      </div>
    );
  }

  const statusStyle = STATUS_STYLES[certification.status] ?? STATUS_STYLES.DRAFT;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className={`px-2.5 py-0.5 rounded text-xs font-medium ${statusStyle}`}>
          {certification.status}
        </span>
        <button
          onClick={onEvaluate}
          disabled={evaluating || certification.status === "EVALUATING"}
          className="px-3 py-1.5 rounded text-xs bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-400/30 hover:bg-fuchsia-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {evaluating ? "Running…" : "Run Evaluation"}
        </button>
      </div>

      <div className="rounded-lg border border-line bg-white/[0.03] divide-y divide-line text-sm">
        <Row label="Config hash" value={certification.config_hash ?? "—"} mono />
        <Row label="Artifact digest" value={certification.artifact_digest ?? "not supplied"} mono />
        <Row label="Certified by" value={certification.certified_by ?? "—"} />
        <Row label="Certified at" value={certification.certified_at ? new Date(certification.certified_at).toLocaleString() : "—"} />
        {certification.failure_reason && (
          <Row label="Failure reason" value={certification.failure_reason} error />
        )}
      </div>

      {runs.length > 0 && (
        <div>
          <p className="text-xs text-textSecondary mb-2">Evaluation history</p>
          <div className="space-y-1.5">
            {runs.map((run) => (
              <div key={run.run_id} className="flex items-center justify-between rounded border border-line bg-white/[0.03] px-3 py-2 text-xs">
                <span className="text-textSecondary font-mono">{run.run_id}</span>
                <span className="text-textSecondary">{run.criteria_passed}/{run.criteria_total} passed</span>
                <span className={run.overall_result === "CERTIFIED" ? "text-emerald-400" : "text-rose-400"}>
                  {run.overall_result ?? run.status}
                </span>
                <span className="text-textSecondary">{new Date(run.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono, error }: { label: string; value: string; mono?: boolean; error?: boolean }) {
  return (
    <div className="flex items-start gap-4 px-3 py-2">
      <span className="w-36 shrink-0 text-textSecondary">{label}</span>
      <span className={`flex-1 break-all ${mono ? "font-mono text-xs" : ""} ${error ? "text-rose-400" : "text-textPrimary"}`}>
        {value}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Create `ToolEvaluatorsPanel.tsx`**

```tsx
"use client";

import type { CriterionResult } from "@/lib/api";

interface Props {
  runId: string | null;
  criteria: CriterionResult[];
  loading: boolean;
}

const STATUS_ICON: Record<string, string> = {
  PASS: "✅",
  FAIL: "❌",
  REVIEW: "⚠️",
};

const STATUS_STYLE: Record<string, string> = {
  PASS: "text-emerald-400",
  FAIL: "text-rose-400",
  REVIEW: "text-amber-400",
};

export function ToolEvaluatorsPanel({ runId, criteria, loading }: Props) {
  if (!runId) {
    return (
      <div className="text-sm text-textSecondary py-6 text-center">
        No evaluation has been run yet. Use the Certification tab to run the first evaluation.
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm text-textSecondary py-6 text-center">Loading criteria…</div>;
  }

  if (criteria.length === 0) {
    return (
      <div className="text-sm text-textSecondary py-6 text-center">
        No criterion results for this run.
      </div>
    );
  }

  const passed = criteria.filter((c) => c.status === "PASS").length;

  return (
    <div className="space-y-3">
      <p className="text-xs text-textSecondary">
        {passed} of {criteria.length} criteria passed in run{" "}
        <span className="font-mono">{runId}</span>
      </p>
      <div className="rounded-lg border border-line bg-white/[0.03] divide-y divide-line">
        {criteria.map((c) => (
          <div key={c.criterion_result_id} className="px-3 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span>{STATUS_ICON[c.status] ?? "•"}</span>
              <span className="font-mono text-xs text-textPrimary">{c.criterion_name}</span>
              <span className={`ml-auto text-xs font-medium ${STATUS_STYLE[c.status] ?? ""}`}>
                {c.status}
              </span>
            </div>
            <p className="mt-1 ml-6 text-xs text-textSecondary">{c.evidence}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `ToolRegistryWorkspace.tsx`**

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import {
  listToolRegistry,
  createToolRecord,
  evaluateTool,
  getToolCertification,
  listToolEvaluationRuns,
  listEvaluationCriteriaResults,
  type ToolRecord,
  type ToolCertification,
  type EvaluationRun,
  type CriterionResult,
} from "@/lib/api";
import { getSession } from "@/lib/api";
import { ToolCertificationPanel } from "./ToolCertificationPanel";
import { ToolEvaluatorsPanel } from "./ToolEvaluatorsPanel";

type Tab = "definition" | "evaluators" | "certification";

export function ToolRegistryWorkspace() {
  const [tools, setTools] = useState<ToolRecord[]>([]);
  const [selected, setSelected] = useState<ToolRecord | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("definition");
  const [certification, setCertification] = useState<ToolCertification | null>(null);
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [criteria, setCriteria] = useState<CriterionResult[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [criteriaLoading, setCriteriaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = getSession()?.token ?? "";

  const loadTools = useCallback(async () => {
    try {
      const data = await listToolRegistry(token);
      setTools(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tools");
    }
  }, [token]);

  useEffect(() => { loadTools(); }, [loadTools]);

  const selectTool = useCallback(async (tool: ToolRecord) => {
    setSelected(tool);
    setActiveTab("definition");
    setCertification(null);
    setRuns([]);
    setCriteria([]);
    try {
      const [cert, runList] = await Promise.all([
        getToolCertification(token, tool.tool_id).catch(() => null),
        listToolEvaluationRuns(token, tool.tool_id).catch(() => []),
      ]);
      setCertification(cert);
      setRuns(runList);
      if (runList.length > 0 && runList[0].last_evaluation_run_id !== undefined) {
        loadCriteria(runList[0].run_id);
      }
    } catch {
      // non-fatal: cert and runs may not exist yet
    }
  }, [token]);

  const loadCriteria = useCallback(async (runId: string) => {
    setCriteriaLoading(true);
    try {
      const data = await listEvaluationCriteriaResults(token, runId);
      setCriteria(data);
    } finally {
      setCriteriaLoading(false);
    }
  }, [token]);

  const handleEvaluate = useCallback(async () => {
    if (!selected) return;
    setEvaluating(true);
    try {
      await evaluateTool(token, selected.tool_id);
      const [cert, runList] = await Promise.all([
        getToolCertification(token, selected.tool_id),
        listToolEvaluationRuns(token, selected.tool_id),
      ]);
      setCertification(cert);
      setRuns(runList);
      if (runList.length > 0) loadCriteria(runList[0].run_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation failed");
    } finally {
      setEvaluating(false);
    }
  }, [selected, token, loadCriteria]);

  const TABS: { id: Tab; label: string }[] = [
    { id: "definition", label: "Definition" },
    { id: "evaluators", label: "Evaluators" },
    { id: "certification", label: "Certification" },
  ];

  return (
    <div className="flex h-full gap-4">
      {/* Tool list */}
      <div className="w-64 shrink-0 flex flex-col gap-1 overflow-y-auto">
        <p className="text-xs text-textSecondary px-1 mb-1">
          {tools.length} tool{tools.length !== 1 ? "s" : ""}
        </p>
        {tools.map((tool) => (
          <button
            key={tool.tool_id}
            onClick={() => selectTool(tool)}
            className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
              selected?.tool_id === tool.tool_id
                ? "border-fuchsia-400/40 bg-fuchsia-500/10 text-textPrimary"
                : "border-line bg-white/[0.03] text-textSecondary hover:text-textPrimary hover:bg-white/[0.05]"
            }`}
          >
            <p className="font-medium truncate">{tool.display_name}</p>
            <p className="text-xs mt-0.5 opacity-60 truncate">{tool.side_effect_level}</p>
          </button>
        ))}
        {tools.length === 0 && (
          <p className="text-xs text-textSecondary px-1">No tools registered yet.</p>
        )}
      </div>

      {/* Detail panel */}
      {selected ? (
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div>
            <h2 className="text-base font-semibold text-textPrimary">{selected.display_name}</h2>
            <p className="text-xs text-textSecondary mt-0.5">{selected.tool_name}</p>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-line">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-sm -mb-px border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-fuchsia-400 text-textPrimary"
                    : "border-transparent text-textSecondary hover:text-textPrimary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {activeTab === "definition" && (
              <div className="space-y-3 text-sm">
                <Field label="Description" value={selected.description || "—"} />
                <Field label="Category" value={selected.category} />
                <Field label="Side effect level" value={selected.side_effect_level} />
                <Field label="Environment" value={selected.environment} />
                <Field label="Owner" value={selected.owner} />
                {selected.input_schema && Object.keys(selected.input_schema).length > 0 && (
                  <div>
                    <p className="text-xs text-textSecondary mb-1">Input schema</p>
                    <pre className="text-xs font-mono bg-white/[0.04] rounded-lg border border-line p-3 overflow-auto">
                      {JSON.stringify(selected.input_schema, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
            {activeTab === "evaluators" && (
              <ToolEvaluatorsPanel
                runId={runs[0]?.run_id ?? null}
                criteria={criteria}
                loading={criteriaLoading}
              />
            )}
            {activeTab === "certification" && (
              <ToolCertificationPanel
                certification={certification}
                runs={runs}
                onEvaluate={handleEvaluate}
                evaluating={evaluating}
              />
            )}
          </div>

          {error && (
            <p className="text-xs text-rose-400 px-1">{error}</p>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-textSecondary">
          Select a tool to inspect its definition, evaluators, and certification.
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4">
      <span className="w-36 shrink-0 text-textSecondary">{label}</span>
      <span className="text-textPrimary">{value}</span>
    </div>
  );
}
```

- [ ] **Step 5: Wire `ToolRegistryWorkspace` into the platform router**

Find where `WorkspaceViewContent.tsx` renders workspace components by view id and add:

```tsx
case "tool-registry":
  return <ToolRegistryWorkspace />;
```

Import at the top of `WorkspaceViewContent.tsx`:
```tsx
import { ToolRegistryWorkspace } from "./ToolRegistryWorkspace";
```

- [ ] **Step 6: TypeScript check**

```bash
cd /Users/dliu520/AIYA/Git/intelliguard/dashboard
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Start dev server and verify Tool Registry nav item appears and renders**

```bash
cd /Users/dliu520/AIYA/Git/intelliguard/dashboard
npm run dev
```

Open `http://localhost:5180/platform` and confirm:
- "Tool Registry" appears in the sidebar nav
- Clicking it shows the two-panel layout (tool list left, detail right)
- With no tools registered, the left panel shows "No tools registered yet."
- Creating a tool via the API shows it in the list

- [ ] **Step 8: Commit**

```bash
git add dashboard/app/platform/_components/config.ts \
        dashboard/app/platform/_components/ToolRegistryWorkspace.tsx \
        dashboard/app/platform/_components/ToolCertificationPanel.tsx \
        dashboard/app/platform/_components/ToolEvaluatorsPanel.tsx \
        dashboard/app/platform/_components/WorkspaceViewContent.tsx
git commit -m "feat(evaluation): Tool Registry workspace with Definition, Evaluators, and Certification tabs"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `tool_records` DB table with config_hash | Task 1, 5 |
| `tool_certifications` DB table with DRAFT→EVALUATING→CERTIFIED→FAILED→NEEDS_REEVALUATION | Task 1, 3 |
| `evaluation_runs` and `evaluation_criterion_results` DB tables | Task 1, 5 |
| 6 deterministic tool evaluator criteria | Task 2 |
| Certification state machine with valid transitions | Task 3 |
| Enforcement hard-blocks uncertified tools in production | Task 4, 6 |
| `POST /v1/tool-registry/{id}/evaluate` endpoint | Task 6 |
| `GET /v1/tool-registry/{id}/certification` endpoint | Task 6 |
| Tool-grant API calls enforcement before granting | Task 6 |
| config_hash computed from registered fields | Task 2 |
| artifact_digest optional field on tool and cert records | Task 1 |
| Tool Registry nav item in Control Plane | Task 8 |
| Inline Evaluators tab with per-criterion checklist | Task 8 |
| Inline Certification tab with status badge, history, run button | Task 8 |

**Not in Phase 1 (deferred to Phase 2–5):**
- Evaluation Center hub page and tabs
- Agent evaluators and agent certification
- Workflow evaluators
- Runtime (production trace) evaluation
- Human corrections and judge calibration
- `monitoring.py` and the Monitoring dashboard
