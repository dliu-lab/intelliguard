# Phase 2: Agent Evaluators And Certification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build agent evaluation and certification — deterministic agent evaluators, async LLM-as-judge stub, AgentCertification lifecycle, cert invalidation on config change, and a Certification tab in the agent modal.

**Architecture:** Phase 1 already provides `EvaluationRun`, `EvaluationCriterionResult`, the certification state machine (`certification.py`), and enforcement primitives. Phase 2 adds `AgentCertification` to models, `agent_evaluators.py` for 5 deterministic checks, a `judge.py` stub (always returns REVIEW — real LLM wired in Phase 5), cert invalidation hooks in existing store methods, and a Certification tab in `SelectedAgentModal`.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 (Mapped), PostgreSQL, pytest, Next.js 14 App Router, TypeScript, Tailwind CSS

**Depends on:** Phase 1 complete (EvaluationRun, EvaluationCriterionResult, certification.py, enforcement.py, and all Phase 1 store methods in place).

---

## File Map

**Create (backend):**
- `intelliguard/evaluation/agent_evaluators.py`
- `intelliguard/evaluation/judge.py`
- `tests/evaluation/test_agent_evaluators.py`
- `tests/evaluation/test_judge.py`

**Modify (backend):**
- `intelliguard/models.py` — add `AgentCertification`
- `intelliguard/store.py` — add agent cert methods + invalidation hooks in 7 existing methods
- `intelliguard/evaluation/enforcement.py` — add `check_agent_certification`
- `tests/evaluation/test_enforcement.py` — add agent enforcement tests
- `api/main.py` — add `POST /v1/agents/{id}/evaluate`, `GET /v1/agents/{id}/certification`, `GET /v1/agents/{id}/evaluation-runs`

**Create (frontend):**
- `dashboard/app/platform/_components/AgentCertificationPanel.tsx`

**Modify (frontend):**
- `dashboard/lib/api.ts` — add `AgentCertification` type + agent eval API functions
- `dashboard/app/platform/_components/SelectedAgentModal.tsx` — add "certification" tab

---

## Task 1: Add AgentCertification Model

**Files:**
- Modify: `intelliguard/models.py`

- [ ] **Step 1: Add `AgentCertification` to `intelliguard/models.py`**

Add after the `KnowledgeBase` model (or after Phase 1's `EvaluationCriterionResult`):

```python
class AgentCertification(Base):
    __tablename__ = "agent_certifications"

    certification_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_id: Mapped[str] = mapped_column(
        ForeignKey("agent_identities.agent_id"), nullable=False, unique=True
    )
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="DRAFT")
    config_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    invalidation_reason: Mapped[str | None] = mapped_column(String(200))
    last_evaluation_run_id: Mapped[str | None] = mapped_column(String(64))
    certified_by: Mapped[str | None] = mapped_column(String(160))
    certified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
```

- [ ] **Step 2: Verify import**

```bash
cd /Users/dliu520/AIYA/Git/intelliguard
python -c "from intelliguard.models import AgentCertification; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add intelliguard/models.py
git commit -m "feat(evaluation): add AgentCertification model"
```

---

## Task 2: Create judge.py Stub

**Files:**
- Create: `intelliguard/evaluation/judge.py`
- Create: `tests/evaluation/test_judge.py`

- [ ] **Step 1: Write failing tests**

Create `tests/evaluation/test_judge.py`:

```python
from __future__ import annotations

import asyncio
import pytest
from intelliguard.evaluation.judge import JudgeResult, run_judge


def test_judge_stub_returns_review():
    result = asyncio.run(run_judge("response_quality", {"response": "test response"}))
    assert result.status == "REVIEW"


def test_judge_stub_preserves_criterion_name():
    result = asyncio.run(run_judge("task_completion", {"response": "done"}))
    assert result.criterion_name == "task_completion"


def test_judge_stub_has_no_judge_model():
    result = asyncio.run(run_judge("response_quality", {"response": "test"}))
    assert result.judge_model is None
```

- [ ] **Step 2: Run tests — confirm failure**

```bash
pytest tests/evaluation/test_judge.py -v 2>&1 | head -10
```

Expected: `ImportError`

- [ ] **Step 3: Create `intelliguard/evaluation/judge.py`**

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class JudgeResult:
    criterion_name: str
    status: str  # PASS | FAIL | REVIEW
    evidence: str
    judge_model: str | None
    prompt_version: str | None
    raw_response: str | None


async def run_judge(
    criterion_name: str,
    input_data: dict[str, Any],
    judge_config: dict[str, Any] | None = None,
) -> JudgeResult:
    """
    LLM-as-judge stub. Always returns REVIEW until calibrated judges are wired in Phase 5.
    This async interface is the stable contract — Phase 5 replaces the body.
    """
    return JudgeResult(
        criterion_name=criterion_name,
        status="REVIEW",
        evidence="LLM-as-judge not yet calibrated. Human review required before trusting this verdict.",
        judge_model=None,
        prompt_version=None,
        raw_response=None,
    )
```

- [ ] **Step 4: Run tests — all must pass**

```bash
pytest tests/evaluation/test_judge.py -v
```

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add intelliguard/evaluation/judge.py tests/evaluation/test_judge.py
git commit -m "feat(evaluation): judge.py stub — async interface, REVIEW until Phase 5 calibration"
```

---

## Task 3: Create Agent Evaluators

**Files:**
- Create: `intelliguard/evaluation/agent_evaluators.py`
- Create: `tests/evaluation/test_agent_evaluators.py`

- [ ] **Step 1: Write failing tests**

Create `tests/evaluation/test_agent_evaluators.py`:

```python
from __future__ import annotations

import pytest
from intelliguard.evaluation.agent_evaluators import (
    CriterionResult,
    compute_agent_config_hash,
    run_agent_evaluators,
)


def _base_agent() -> dict:
    return {
        "agent_id": "test-agent",
        "agent_type": "task_agent",
        "purpose": "Reviews customer support cases using governed tools.",
        "permissions": {"tools": ["lookup_account"]},
        "metadata": {"llm": {"model": "ollama/qwen3.5:9b"}},
    }


def _base_assignments() -> dict:
    return {
        "guardrails": [{"policy_id": "pol_001", "environment": "demo"}],
        "evaluators": [],
        "knowledge": [],
    }


def test_all_pass_for_well_formed_agent():
    results = run_agent_evaluators(_base_agent(), _base_assignments())
    failed = [r for r in results if r.status == "FAIL"]
    assert failed == [], f"Unexpected failures: {[r.criterion_name for r in failed]}"


def test_empty_purpose_fails():
    agent = _base_agent()
    agent["purpose"] = ""
    results = run_agent_evaluators(agent, _base_assignments())
    names = {r.criterion_name: r.status for r in results}
    assert names["purpose_declared"] == "FAIL"


def test_missing_model_fails():
    agent = _base_agent()
    agent["metadata"] = {"llm": {}}
    results = run_agent_evaluators(agent, _base_assignments())
    names = {r.criterion_name: r.status for r in results}
    assert names["model_declared"] == "FAIL"


def test_invalid_agent_type_fails():
    agent = _base_agent()
    agent["agent_type"] = "magic_agent"
    results = run_agent_evaluators(agent, _base_assignments())
    names = {r.criterion_name: r.status for r in results}
    assert names["agent_type_valid"] == "FAIL"


def test_empty_tools_list_triggers_review():
    agent = _base_agent()
    agent["permissions"] = {"tools": []}
    results = run_agent_evaluators(agent, _base_assignments())
    names = {r.criterion_name: r.status for r in results}
    assert names["tool_scope_defined"] == "REVIEW"


def test_no_guardrail_fails():
    results = run_agent_evaluators(
        _base_agent(),
        {"guardrails": [], "evaluators": [], "knowledge": []},
    )
    names = {r.criterion_name: r.status for r in results}
    assert names["guardrail_assigned"] == "FAIL"


def test_compute_config_hash_stable():
    h1 = compute_agent_config_hash(_base_agent(), _base_assignments())
    h2 = compute_agent_config_hash(_base_agent(), _base_assignments())
    assert h1 == h2
    assert len(h1) == 32


def test_compute_config_hash_changes_on_agent_type():
    h1 = compute_agent_config_hash(_base_agent(), _base_assignments())
    agent = _base_agent()
    agent["agent_type"] = "review_agent"
    h2 = compute_agent_config_hash(agent, _base_assignments())
    assert h1 != h2


def test_compute_config_hash_changes_on_guardrail_change():
    h1 = compute_agent_config_hash(_base_agent(), _base_assignments())
    assignments = _base_assignments()
    assignments["guardrails"] = [{"policy_id": "pol_different"}]
    h2 = compute_agent_config_hash(_base_agent(), assignments)
    assert h1 != h2
```

- [ ] **Step 2: Run tests — confirm failure**

```bash
pytest tests/evaluation/test_agent_evaluators.py -v 2>&1 | head -10
```

Expected: `ImportError`

- [ ] **Step 3: Create `intelliguard/evaluation/agent_evaluators.py`**

```python
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

# Re-export CriterionResult from tool_evaluators so tests can import from one place
from intelliguard.evaluation.tool_evaluators import CriterionResult

VALID_AGENT_TYPES = frozenset({
    "task_agent", "gate_agent", "review_agent", "lead_agent", "custom_agent",
})


def run_agent_evaluators(agent: dict[str, Any], assignments: dict[str, Any]) -> list[CriterionResult]:
    return [
        _check_purpose_declared(agent),
        _check_model_declared(agent),
        _check_agent_type_valid(agent),
        _check_tool_scope_defined(agent),
        _check_guardrail_assigned(assignments),
    ]


def compute_agent_config_hash(agent: dict[str, Any], assignments: dict[str, Any]) -> str:
    fields = {
        "agent_type": agent.get("agent_type", ""),
        "purpose": (agent.get("purpose") or "").strip(),
        "model": (agent.get("metadata") or {}).get("llm", {}).get("model", ""),
        "tools": sorted((agent.get("permissions") or {}).get("tools") or []),
        "guardrail_policy_ids": sorted(
            str(a.get("policy_id", "")) for a in (assignments.get("guardrails") or [])
        ),
        "kb_ids": sorted(
            str(a.get("kb_id", "")) for a in (assignments.get("knowledge") or [])
        ),
    }
    canonical = json.dumps(fields, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()[:32]


def _check_purpose_declared(agent: dict[str, Any]) -> CriterionResult:
    purpose = (agent.get("purpose") or "").strip()
    snapshot = {"purpose": purpose}
    if not purpose:
        return CriterionResult("purpose_declared", "FAIL",
                               "Agent has no purpose declared", snapshot)
    return CriterionResult("purpose_declared", "PASS",
                           f"Purpose declared ({len(purpose)} chars)", snapshot)


def _check_model_declared(agent: dict[str, Any]) -> CriterionResult:
    model = (agent.get("metadata") or {}).get("llm", {}).get("model", "")
    snapshot = {"model": model}
    if not model:
        return CriterionResult("model_declared", "FAIL",
                               "No LLM model declared in metadata.llm.model", snapshot)
    return CriterionResult("model_declared", "PASS",
                           f"Model declared as '{model}'", snapshot)


def _check_agent_type_valid(agent: dict[str, Any]) -> CriterionResult:
    agent_type = agent.get("agent_type", "")
    snapshot = {"agent_type": agent_type}
    if not agent_type:
        return CriterionResult("agent_type_valid", "FAIL",
                               "No agent_type declared", snapshot)
    if agent_type not in VALID_AGENT_TYPES:
        return CriterionResult("agent_type_valid", "FAIL",
                               f"agent_type '{agent_type}' not in {sorted(VALID_AGENT_TYPES)}",
                               snapshot)
    return CriterionResult("agent_type_valid", "PASS",
                           f"agent_type '{agent_type}' is valid", snapshot)


def _check_tool_scope_defined(agent: dict[str, Any]) -> CriterionResult:
    tools = (agent.get("permissions") or {}).get("tools")
    snapshot = {"permissions.tools": tools}
    if tools is None:
        return CriterionResult("tool_scope_defined", "FAIL",
                               "permissions.tools is not declared", snapshot)
    if len(tools) == 0:
        return CriterionResult("tool_scope_defined", "REVIEW",
                               "permissions.tools is an empty list — agent has no tool grants", snapshot)
    return CriterionResult("tool_scope_defined", "PASS",
                           f"permissions.tools declares {len(tools)} tool(s)", snapshot)


def _check_guardrail_assigned(assignments: dict[str, Any]) -> CriterionResult:
    guardrails = assignments.get("guardrails") or []
    snapshot = {"guardrail_count": len(guardrails)}
    if not guardrails:
        return CriterionResult("guardrail_assigned", "FAIL",
                               "No guardrail policy assigned to this agent", snapshot)
    return CriterionResult("guardrail_assigned", "PASS",
                           f"{len(guardrails)} guardrail assignment(s) found", snapshot)
```

- [ ] **Step 4: Run tests — all must pass**

```bash
pytest tests/evaluation/test_agent_evaluators.py -v
```

Expected: 9 tests passing.

- [ ] **Step 5: Commit**

```bash
git add intelliguard/evaluation/agent_evaluators.py tests/evaluation/test_agent_evaluators.py
git commit -m "feat(evaluation): agent evaluators with 5 deterministic criteria"
```

---

## Task 4: Agent Certification Store Methods And Invalidation Hooks

**Files:**
- Modify: `intelliguard/store.py`

- [ ] **Step 1: Add `AgentCertification` to the imports block in `store.py`**

In the `from intelliguard.models import (...)` block, add:

```python
    AgentCertification,
```

- [ ] **Step 2: Add agent certification store methods**

Add after the existing `_run_to_dict` method (added in Phase 1 Task 5):

```python
    def create_agent_certification(self, agent_id: str, config_hash: str) -> dict[str, Any]:
        with self.session() as db:
            cert = AgentCertification(
                certification_id=new_id("acert"),
                agent_id=agent_id,
                status="DRAFT",
                config_hash=config_hash,
            )
            db.add(cert)
            db.commit()
            db.refresh(cert)
            return self._agent_cert_to_dict(cert)

    def get_agent_certification(self, agent_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            cert = db.scalar(
                select(AgentCertification).where(AgentCertification.agent_id == agent_id)
            )
            return self._agent_cert_to_dict(cert) if cert else None

    def update_agent_certification(self, agent_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            cert = db.scalar(
                select(AgentCertification).where(AgentCertification.agent_id == agent_id)
            )
            if not cert:
                raise ValueError(f"No certification record for agent '{agent_id}'")
            for field in (
                "status", "config_hash", "invalidation_reason", "last_evaluation_run_id",
                "certified_by", "certified_at", "expires_at", "failure_reason",
            ):
                if field in payload:
                    setattr(cert, field, payload[field])
            cert.updated_at = utc_now()
            db.commit()
            db.refresh(cert)
            return self._agent_cert_to_dict(cert)

    def list_evaluation_runs_for_agent(self, agent_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            runs = db.scalars(
                select(EvaluationRun)
                .where(
                    EvaluationRun.target_type == "agent",
                    EvaluationRun.target_id == agent_id,
                )
                .order_by(EvaluationRun.created_at.desc())
            ).all()
            return [self._run_to_dict(r) for r in runs]

    @staticmethod
    def _agent_cert_to_dict(cert: AgentCertification | None) -> dict[str, Any] | None:
        if not cert:
            return None
        return {
            "certification_id": cert.certification_id,
            "agent_id": cert.agent_id,
            "status": cert.status,
            "config_hash": cert.config_hash,
            "invalidation_reason": cert.invalidation_reason,
            "last_evaluation_run_id": cert.last_evaluation_run_id,
            "certified_by": cert.certified_by,
            "certified_at": cert.certified_at.isoformat() if cert.certified_at else None,
            "expires_at": cert.expires_at.isoformat() if cert.expires_at else None,
            "failure_reason": cert.failure_reason,
            "created_at": cert.created_at.isoformat(),
            "updated_at": cert.updated_at.isoformat(),
        }
```

- [ ] **Step 3: Add the private invalidation helper method**

Add after `_agent_cert_to_dict`:

```python
    def _invalidate_agent_cert_if_certified(
        self, db: Session, agent_id: str, reason: str
    ) -> None:
        cert = db.scalar(
            select(AgentCertification).where(AgentCertification.agent_id == agent_id)
        )
        if cert and cert.status not in ("DRAFT", "NEEDS_REEVALUATION"):
            cert.status = "NEEDS_REEVALUATION"
            cert.invalidation_reason = reason
            cert.updated_at = utc_now()
```

- [ ] **Step 4: Add invalidation call to `upsert_agent_identity`**

Inside `upsert_agent_identity`, in the `else` branch (identity already exists), before `db.flush()`, add:

```python
            self._invalidate_agent_cert_if_certified(db, payload["agent_id"], "agent configuration updated")
```

- [ ] **Step 5: Add invalidation to `grant_agent_tool` and `revoke_agent_tool`**

In `grant_agent_tool`, before `db.flush()`, add:
```python
            self._invalidate_agent_cert_if_certified(db, agent_id, "tool grants changed")
```

In `revoke_agent_tool`, before `db.flush()`, add:
```python
            self._invalidate_agent_cert_if_certified(db, agent_id, "tool grants changed")
```

- [ ] **Step 6: Add invalidation to guardrail and KB assignment methods**

In `upsert_agent_guardrail_assignment`, before `db.flush()`, add:
```python
            self._invalidate_agent_cert_if_certified(db, agent_id, "guardrail assignments changed")
```

In `delete_agent_guardrail_assignment`, before `db.delete(row)`, add:
```python
            self._invalidate_agent_cert_if_certified(db, row.agent_id, "guardrail assignments changed")
```

In `upsert_agent_kb_assignment`, before `db.flush()`, add:
```python
            self._invalidate_agent_cert_if_certified(db, agent_id, "knowledge base assignments changed")
```

In `delete_agent_kb_assignment`, before `db.delete(row)`, add:
```python
            self._invalidate_agent_cert_if_certified(db, row.agent_id, "knowledge base assignments changed")
```

- [ ] **Step 7: Verify imports and run full tests**

```bash
cd /Users/dliu520/AIYA/Git/intelliguard
python -c "from intelliguard.store import GovernanceStore; print('OK')"
pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add intelliguard/store.py
git commit -m "feat(evaluation): agent certification store methods + invalidation on config change"
```

---

## Task 5: Add check_agent_certification To Enforcement

**Files:**
- Modify: `intelliguard/evaluation/enforcement.py`
- Modify: `tests/evaluation/test_enforcement.py`

- [ ] **Step 1: Add agent enforcement tests to `tests/evaluation/test_enforcement.py`**

Add to the existing test file:

```python
from intelliguard.evaluation.enforcement import (
    CertificationEnforcementError,
    check_agent_certification,
    check_tool_certification,
)


def _agent_store_with_cert(status: str) -> MagicMock:
    store = MagicMock()
    store.get_agent_certification.return_value = {"status": status}
    return store


def test_certified_agent_passes_in_production():
    store = _agent_store_with_cert("CERTIFIED")
    check_agent_certification(store, "agent_123", "production")  # must not raise


def test_failed_agent_blocked_in_production():
    store = _agent_store_with_cert("FAILED")
    with pytest.raises(CertificationEnforcementError, match="FAILED"):
        check_agent_certification(store, "agent_123", "production")


def test_draft_agent_blocked_in_production():
    store = _agent_store_with_cert("DRAFT")
    with pytest.raises(CertificationEnforcementError, match="DRAFT"):
        check_agent_certification(store, "agent_123", "production")


def test_no_agent_cert_blocked_in_production():
    store = MagicMock()
    store.get_agent_certification.return_value = None
    with pytest.raises(CertificationEnforcementError, match="no certification record"):
        check_agent_certification(store, "agent_123", "production")


def test_draft_agent_allowed_in_demo():
    store = _agent_store_with_cert("DRAFT")
    check_agent_certification(store, "agent_123", "demo")  # must not raise
```

- [ ] **Step 2: Run tests — confirm failure**

```bash
pytest tests/evaluation/test_enforcement.py -v -k "agent" 2>&1 | head -15
```

Expected: `ImportError` for `check_agent_certification`

- [ ] **Step 3: Add `check_agent_certification` to `intelliguard/evaluation/enforcement.py`**

```python
def check_agent_certification(store: object, agent_id: str, environment: str) -> None:
    """
    In production environments, agents must be CERTIFIED before they are included
    in workflow definitions. Lower environments are permissive.
    """
    if environment not in PRODUCTION_ENVIRONMENTS:
        return

    cert = store.get_agent_certification(agent_id)
    if cert is None:
        raise CertificationEnforcementError(
            f"Agent '{agent_id}' has no certification record. "
            "Run agent evaluation before deploying in production."
        )
    status = cert.get("status", "DRAFT")
    if status != "CERTIFIED":
        raise CertificationEnforcementError(
            f"Agent '{agent_id}' has certification status '{status}'. "
            "Only CERTIFIED agents can be deployed in production environments."
        )
```

- [ ] **Step 4: Run tests — all must pass**

```bash
pytest tests/evaluation/test_enforcement.py -v
```

Expected: all tests passing (including original tool enforcement tests).

- [ ] **Step 5: Commit**

```bash
git add intelliguard/evaluation/enforcement.py tests/evaluation/test_enforcement.py
git commit -m "feat(evaluation): check_agent_certification enforcement for production environments"
```

---

## Task 6: API Endpoints — Agent Evaluate And Certification

**Files:**
- Modify: `api/main.py`

- [ ] **Step 1: Add `POST /v1/agents/{agent_id}/evaluate` endpoint**

Add after the tool registry evaluate endpoint (Phase 1 Task 6):

```python
@app.post("/v1/agents/{agent_id}/evaluate")
def evaluate_agent(
    agent_id: str, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    from time import monotonic
    from intelliguard.evaluation.agent_evaluators import (
        compute_agent_config_hash,
        run_agent_evaluators,
    )
    from intelliguard.evaluation.certification import decide_certification, validate_transition
    from intelliguard.models import utc_now

    agent = store.get_agent_identity(agent_id)
    if not agent.get("agent_id"):
        raise HTTPException(status_code=404, detail="Agent not found")

    guardrails = store.list_agent_guardrail_assignments(agent_id)
    knowledge = store.list_agent_kb_assignments(agent_id)
    assignments = {
        "guardrails": guardrails,
        "evaluators": store.list_agent_evaluator_assignments(agent_id),
        "knowledge": knowledge,
    }

    config_hash = compute_agent_config_hash(agent, assignments)
    cert = store.get_agent_certification(agent_id)
    if not cert:
        cert = store.create_agent_certification(agent_id, config_hash)

    try:
        validate_transition(cert["status"], "EVALUATING")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    store.update_agent_certification(agent_id, {"status": "EVALUATING", "config_hash": config_hash})
    run = store.create_evaluation_run({
        "target_type": "agent",
        "target_id": agent_id,
        "config_hash": config_hash,
        "triggered_by": user["email"],
    })
    run_id = run["run_id"]

    start = monotonic()
    criterion_results = run_agent_evaluators(agent, assignments)
    duration_ms = int((monotonic() - start) * 1000)

    results_dicts = [
        {
            "evaluator_id": "agent_baseline",
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

    next_cert_status = decision.status
    store.update_agent_certification(agent_id, {
        "status": next_cert_status,
        "config_hash": config_hash,
        "last_evaluation_run_id": run_id,
        "certified_by": user["email"] if next_cert_status == "CERTIFIED" else None,
        "certified_at": utc_now() if next_cert_status == "CERTIFIED" else None,
        "failure_reason": decision.failure_reason,
        "invalidation_reason": None,
    })

    return {
        "run_id": run_id,
        "agent_id": agent_id,
        "overall_result": decision.status,
        "criteria_total": len(criterion_results),
        "criteria_passed": passed,
        "duration_ms": duration_ms,
        "criterion_results": results_dicts,
    }
```

- [ ] **Step 2: Add `GET /v1/agents/{agent_id}/certification` and evaluation-runs endpoints**

```python
@app.get("/v1/agents/{agent_id}/certification")
def get_agent_certification_status(
    agent_id: str, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    cert = store.get_agent_certification(agent_id)
    if not cert:
        raise HTTPException(status_code=404, detail="No certification record for this agent")
    return cert


@app.get("/v1/agents/{agent_id}/evaluation-runs")
def list_agent_evaluation_runs(
    agent_id: str, user: dict[str, Any] = Depends(current_user)
) -> list[dict[str, Any]]:
    return store.list_evaluation_runs_for_agent(agent_id)
```

- [ ] **Step 3: Start API and smoke-test**

```bash
cd /Users/dliu520/AIYA/Git/intelliguard
uvicorn api.main:app --reload --port 8000 &
sleep 2
curl -s -X POST http://localhost:8000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}' | python -m json.tool | head -5
kill %1
```

Expected: login returns token (or appropriate auth error — confirms API starts without import errors).

- [ ] **Step 4: Run full test suite**

```bash
pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/main.py
git commit -m "feat(evaluation): agent evaluate, certification, and evaluation-runs API endpoints"
```

---

## Task 7: Frontend — API Types And Functions

**Files:**
- Modify: `dashboard/lib/api.ts`

- [ ] **Step 1: Add `AgentCertification` type after `ToolCertification`**

```typescript
export type AgentCertification = {
  certification_id: string;
  agent_id: string;
  status: "DRAFT" | "EVALUATING" | "CERTIFIED" | "FAILED" | "NEEDS_REEVALUATION";
  config_hash: string;
  invalidation_reason: string | null;
  last_evaluation_run_id: string | null;
  certified_by: string | null;
  certified_at: string | null;
  expires_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 2: Add agent evaluation API functions**

Add after `listEvaluationCriteriaResults`:

```typescript
export function evaluateAgent(token: string, agentId: string) {
  return request<ApiRecord>(`/v1/agents/${encodeURIComponent(agentId)}/evaluate`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export function getAgentCertification(token: string, agentId: string) {
  return request<AgentCertification>(
    `/v1/agents/${encodeURIComponent(agentId)}/certification`,
    { headers: authHeaders(token) },
  );
}

export function listAgentEvaluationRuns(token: string, agentId: string) {
  return request<EvaluationRun[]>(
    `/v1/agents/${encodeURIComponent(agentId)}/evaluation-runs`,
    { headers: authHeaders(token) },
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/dliu520/AIYA/Git/intelliguard/dashboard
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/lib/api.ts
git commit -m "feat(evaluation): AgentCertification type + agent eval API client functions"
```

---

## Task 8: Frontend — AgentCertificationPanel And Modal Tab

**Files:**
- Create: `dashboard/app/platform/_components/AgentCertificationPanel.tsx`
- Modify: `dashboard/app/platform/_components/SelectedAgentModal.tsx`

- [ ] **Step 1: Create `AgentCertificationPanel.tsx`**

```tsx
"use client";

import { useState, useCallback } from "react";
import type { AgentCertification, EvaluationRun, CriterionResult } from "@/lib/api";

interface Props {
  agentId: string;
  certification: AgentCertification | null;
  runs: EvaluationRun[];
  lastRunCriteria: CriterionResult[];
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

const STATUS_ICON: Record<string, string> = {
  PASS: "✅",
  FAIL: "❌",
  REVIEW: "⚠️",
};

export function AgentCertificationPanel({
  agentId,
  certification,
  runs,
  lastRunCriteria,
  onEvaluate,
  evaluating,
}: Props) {
  const statusStyle = certification
    ? (STATUS_STYLES[certification.status] ?? STATUS_STYLES.DRAFT)
    : STATUS_STYLES.DRAFT;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className={`px-2.5 py-0.5 rounded text-xs font-medium ${statusStyle}`}>
          {certification?.status ?? "NOT EVALUATED"}
        </span>
        <button
          onClick={onEvaluate}
          disabled={evaluating || certification?.status === "EVALUATING"}
          className="px-3 py-1.5 rounded text-xs bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-400/30 hover:bg-fuchsia-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {evaluating ? "Running…" : "Run Evaluation"}
        </button>
      </div>

      {certification && (
        <div className="rounded-lg border border-line bg-white/[0.03] divide-y divide-line text-sm">
          <Row label="Config hash" value={certification.config_hash} mono />
          <Row label="Certified by" value={certification.certified_by ?? "—"} />
          <Row label="Certified at" value={certification.certified_at ? new Date(certification.certified_at).toLocaleString() : "—"} />
          {certification.invalidation_reason && (
            <Row label="Invalidation reason" value={certification.invalidation_reason} warn />
          )}
          {certification.failure_reason && (
            <Row label="Failure reason" value={certification.failure_reason} error />
          )}
        </div>
      )}

      {lastRunCriteria.length > 0 && (
        <div>
          <p className="text-xs text-textSecondary mb-2">Last evaluation criteria</p>
          <div className="rounded-lg border border-line bg-white/[0.03] divide-y divide-line">
            {lastRunCriteria.map((c) => (
              <div key={c.criterion_result_id} className="px-3 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <span>{STATUS_ICON[c.status] ?? "•"}</span>
                  <span className="font-mono text-xs text-textPrimary">{c.criterion_name}</span>
                  <span className={`ml-auto text-xs font-medium ${
                    c.status === "PASS" ? "text-emerald-400"
                    : c.status === "FAIL" ? "text-rose-400"
                    : "text-amber-400"
                  }`}>{c.status}</span>
                </div>
                <p className="mt-1 ml-6 text-xs text-textSecondary">{c.evidence}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {runs.length > 0 && (
        <div>
          <p className="text-xs text-textSecondary mb-2">Evaluation history</p>
          <div className="space-y-1.5">
            {runs.map((run) => (
              <div key={run.run_id} className="flex items-center justify-between rounded border border-line bg-white/[0.03] px-3 py-2 text-xs">
                <span className="text-textSecondary font-mono truncate max-w-[120px]">{run.run_id}</span>
                <span className="text-textSecondary">{run.criteria_passed}/{run.criteria_total}</span>
                <span className={run.overall_result === "CERTIFIED" ? "text-emerald-400" : "text-rose-400"}>
                  {run.overall_result ?? run.status}
                </span>
                <span className="text-textSecondary">{new Date(run.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!certification && (
        <p className="text-sm text-textSecondary py-4 text-center">
          No evaluation has been run yet. Click "Run Evaluation" to start.
        </p>
      )}
    </div>
  );
}

function Row({
  label, value, mono, error, warn,
}: { label: string; value: string; mono?: boolean; error?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-start gap-4 px-3 py-2">
      <span className="w-36 shrink-0 text-textSecondary text-xs">{label}</span>
      <span className={`flex-1 break-all text-xs ${mono ? "font-mono" : ""} ${error ? "text-rose-400" : warn ? "text-amber-400" : "text-textPrimary"}`}>
        {value}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Add certification tab to `SelectedAgentModal.tsx`**

First, find the `AgentModalTab` type near the top of `SelectedAgentModal.tsx`. Add `"certification"` to it:

```typescript
type AgentModalTab = "profile" | "tools" | "guardrails" | "evaluators" | "knowledge" | "certification";
```

Add state variables for certification data near the top of the component:

```typescript
  const [certification, setCertification] = useState<AgentCertification | null>(null);
  const [certRuns, setCertRuns] = useState<EvaluationRun[]>([]);
  const [certCriteria, setCertCriteria] = useState<CriterionResult[]>([]);
  const [evaluating, setEvaluating] = useState(false);
```

Add an effect to load certification data when the modal opens:

```typescript
  useEffect(() => {
    if (!agent) return;
    const agentId = String(agent.agent_id ?? "");
    const token = getSession()?.token ?? "";
    Promise.all([
      getAgentCertification(token, agentId).catch(() => null),
      listAgentEvaluationRuns(token, agentId).catch(() => []),
    ]).then(([cert, runs]) => {
      setCertification(cert);
      setCertRuns(runs);
      if (runs.length > 0) {
        listEvaluationCriteriaResults(token, runs[0].run_id)
          .then(setCertCriteria)
          .catch(() => {});
      }
    });
  }, [agent]);
```

Add a `handleEvaluate` callback:

```typescript
  const handleEvaluate = useCallback(async () => {
    const agentId = String(agent?.agent_id ?? "");
    const token = getSession()?.token ?? "";
    if (!agentId || !token) return;
    setEvaluating(true);
    try {
      await evaluateAgent(token, agentId);
      const [cert, runs] = await Promise.all([
        getAgentCertification(token, agentId),
        listAgentEvaluationRuns(token, agentId),
      ]);
      setCertification(cert);
      setCertRuns(runs);
      if (runs.length > 0) {
        const criteria = await listEvaluationCriteriaResults(token, runs[0].run_id);
        setCertCriteria(criteria);
      }
    } finally {
      setEvaluating(false);
    }
  }, [agent]);
```

Add "certification" to the tab list (wherever the modal renders its tab navigation), e.g. after "knowledge":

```tsx
<button onClick={() => onTabChange("certification")} className={tabClass("certification")}>
  Certification
</button>
```

Add the certification tab content panel (where the other tab panels are rendered):

```tsx
{modalTab === "certification" && (
  <AgentCertificationPanel
    agentId={String(agent.agent_id ?? "")}
    certification={certification}
    runs={certRuns}
    lastRunCriteria={certCriteria}
    onEvaluate={handleEvaluate}
    evaluating={evaluating}
  />
)}
```

Add imports at the top of `SelectedAgentModal.tsx`:

```typescript
import {
  evaluateAgent,
  getAgentCertification,
  listAgentEvaluationRuns,
  listEvaluationCriteriaResults,
  type AgentCertification,
  type EvaluationRun,
  type CriterionResult,
} from "@/lib/api";
import { AgentCertificationPanel } from "./AgentCertificationPanel";
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/dliu520/AIYA/Git/intelliguard/dashboard
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Start dev server and verify**

```bash
cd /Users/dliu520/AIYA/Git/intelliguard/dashboard
npm run dev
```

Open `http://localhost:5180/platform`, navigate to Control Plane → Agents, click any agent, verify:
- "Certification" tab appears after "Knowledge"
- Clicking it shows "No evaluation has been run yet"
- "Run Evaluation" button triggers evaluation and shows certification status + criterion results

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/platform/_components/AgentCertificationPanel.tsx \
        dashboard/app/platform/_components/SelectedAgentModal.tsx
git commit -m "feat(evaluation): AgentCertificationPanel + Certification tab in agent modal"
```

---

## Self-Review

| Spec requirement | Task |
|---|---|
| `agent_certifications` DB table with DRAFT→EVALUATING→CERTIFIED→FAILED→NEEDS_REEVALUATION | Task 1, 4 |
| 5 deterministic agent evaluators | Task 3 |
| `judge.py` async stub (REVIEW until calibrated) | Task 2 |
| Certification invalidation on config change (purpose, model, tools, guardrails, KB) | Task 4 |
| `POST /v1/agents/{id}/evaluate` | Task 6 |
| `GET /v1/agents/{id}/certification` | Task 6 |
| `check_agent_certification` for production enforcement | Task 5 |
| Agent Registry Certification tab | Task 8 |
| Per-criterion results in Certification tab | Task 8 |
| `compute_agent_config_hash` includes tools, guardrails, KB | Task 3 |

**Not in Phase 2 (deferred):**
- Real LLM-as-judge calls for response_quality/task_completion (Phase 5)
- Evaluation Center Agent Evaluations tab (Phase 4/5)
- Workflow enforcement calling `check_agent_certification` (Phase 3)
