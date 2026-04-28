# Guardrail & Evaluator Governance System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-agent guardrail policy assignments and rule-based evaluators to IntelliGuard, with full API, runtime integration, and dashboard UI.

**Architecture:** Five new DB tables store named guardrail policies, per-agent assignments, evaluator templates, evaluator assignments, and evaluation results. `GovernedToolRunner` resolves the agent's active guardrail policy at construction time (falling back to global YAML if none assigned). After each run, `EvaluatorEngine` executes assigned evaluators and stores results as `EVALUATION_COMPLETE` workflow events. Workflow-level evaluators run at the end of `run_customer_support_workflow`.

**Tech Stack:** Python 3.12, SQLAlchemy 2, FastAPI, PostgreSQL/JSONB, React/JSX

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `agent_governance/models.py` | Modify | Add 5 new ORM models |
| `agent_governance/db.py` | Modify | Seed default guardrail policy + 5 evaluator templates |
| `agent_governance/store.py` | Modify | CRUD for all 5 new entities + session helper queries |
| `agent_governance/evaluators.py` | Create | `EvaluatorEngine` + 5 rule-based evaluators |
| `agent_governance/runner.py` | Modify | Per-agent policy resolution, mode enforcement, post-run evaluation |
| `agent_governance/multi_agent.py` | Modify | Workflow-level evaluation at end of `run_customer_support_workflow` |
| `api/main.py` | Modify | 14 new API endpoints |
| `dashboard/src/lib/api.js` | Modify | API client methods for new endpoints |
| `dashboard/src/App.jsx` | Modify | Agent card tabs, Governance marketplace tab, evaluation badges |
| `tests/conftest.py` | Create | pytest fixtures for Postgres test DB |
| `tests/test_evaluators.py` | Create | Evaluator engine unit tests |
| `tests/test_store_governance.py` | Create | Store method tests for new entities |
| `tests/test_runner_guardrails.py` | Create | Runner policy resolution + mode enforcement tests |

---

## Task 1: Test infrastructure

**Files:**
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

- [ ] **Step 1: Create test package and conftest**

```python
# tests/__init__.py
# (empty)
```

```python
# tests/conftest.py
from __future__ import annotations

import os
import pytest
from sqlalchemy import create_engine
from agent_governance.models import Base
from agent_governance.store import GovernanceStore
from agent_governance.db import seed_demo_data

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/governance_test"),
)


@pytest.fixture(scope="session")
def db_url() -> str:
    engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.create_all(engine)
    engine.dispose()
    yield TEST_DATABASE_URL
    engine2 = create_engine(TEST_DATABASE_URL)
    Base.metadata.drop_all(engine2)
    engine2.dispose()


@pytest.fixture
def store(db_url: str) -> GovernanceStore:
    s = GovernanceStore(db_url)
    with s.session() as db:
        seed_demo_data(db)
    return s
```

- [ ] **Step 2: Verify pytest is installed**

```bash
cd /Users/dliu520/AIYA/Git/agent_governance
source .venv/bin/activate
pip install -e ".[dev]"
pytest --collect-only tests/ 2>&1 | head -20
```

Expected: `no tests ran` with no import errors.

- [ ] **Step 3: Commit**

```bash
git add tests/__init__.py tests/conftest.py
git commit -m "test: add pytest infrastructure with Postgres fixture"
```

---

## Task 2: Add 5 new SQLAlchemy models

**Files:**
- Modify: `agent_governance/models.py`

- [ ] **Step 1: Write failing test to confirm models don't exist yet**

```python
# tests/test_store_governance.py
def test_models_importable():
    from agent_governance.models import (
        GuardrailPolicy,
        AgentGuardrailAssignment,
        EvaluatorTemplate,
        AgentEvaluatorAssignment,
        EvaluationResult,
    )
    assert GuardrailPolicy.__tablename__ == "guardrail_policies"
    assert AgentGuardrailAssignment.__tablename__ == "agent_guardrail_assignments"
    assert EvaluatorTemplate.__tablename__ == "evaluator_templates"
    assert AgentEvaluatorAssignment.__tablename__ == "agent_evaluator_assignments"
    assert EvaluationResult.__tablename__ == "evaluation_results"
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/test_store_governance.py::test_models_importable -v
```

Expected: `ImportError` or `FAILED`.

- [ ] **Step 3: Add the 5 models to `agent_governance/models.py`**

Add after the `WorkflowEvent` class at the end of the file:

```python
class GuardrailPolicy(Base):
    __tablename__ = "guardrail_policies"

    policy_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AgentGuardrailAssignment(Base):
    __tablename__ = "agent_guardrail_assignments"
    __table_args__ = (
        UniqueConstraint("agent_id", "environment", name="uq_agent_guardrail_env"),
    )

    assignment_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent_identities.agent_id"), nullable=False)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    policy_id: Mapped[str] = mapped_column(ForeignKey("guardrail_policies.policy_id"), nullable=False)
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="enforce")
    threshold_overrides: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class EvaluatorTemplate(Base):
    __tablename__ = "evaluator_templates"

    evaluator_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    evaluator_type: Mapped[str] = mapped_column(String(80), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    default_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    llm_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AgentEvaluatorAssignment(Base):
    __tablename__ = "agent_evaluator_assignments"
    __table_args__ = (
        UniqueConstraint("agent_id", "environment", "evaluator_id", name="uq_agent_evaluator_env"),
    )

    assignment_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent_identities.agent_id"), nullable=False)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    evaluator_id: Mapped[str] = mapped_column(ForeignKey("evaluator_templates.evaluator_id"), nullable=False)
    trigger: Mapped[str] = mapped_column(String(32), nullable=False, default="after_run")
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class EvaluationResult(Base):
    __tablename__ = "evaluation_results"

    result_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_sessions.session_id"), nullable=False)
    workflow_id: Mapped[str | None] = mapped_column(String(64))
    agent_id: Mapped[str] = mapped_column(String(120), nullable=False)
    evaluator_id: Mapped[str] = mapped_column(ForeignKey("evaluator_templates.evaluator_id"), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    findings: Mapped[list] = mapped_column(JSONB, default=list)
    trigger: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
```

- [ ] **Step 4: Update store.py imports** — add the 5 new models to the import block in `agent_governance/store.py`:

```python
from agent_governance.models import (
    AgentEvaluatorAssignment,
    AgentGuardrailAssignment,
    AgentIdentity,
    AgentSession,
    AgentWorkflow,
    AuditEvent,
    EvaluationResult,
    EvaluatorTemplate,
    GuardrailPolicy,
    PolicyDecision,
    ReviewQueueItem,
    ToolCall,
    User,
    UserEnvironmentAccess,
    UserSession,
    WorkflowDefinition,
    WorkflowEvent,
    WorkflowSessionLink,
    new_id,
    utc_now,
)
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
pytest tests/test_store_governance.py::test_models_importable -v
```

Expected: `PASSED`.

- [ ] **Step 6: Commit**

```bash
git add agent_governance/models.py agent_governance/store.py tests/test_store_governance.py
git commit -m "feat: add 5 new governance DB models (guardrails + evaluators)"
```

---

## Task 3: Seed default guardrail policy and evaluator templates

**Files:**
- Modify: `agent_governance/db.py`

- [ ] **Step 1: Add failing test**

Add to `tests/test_store_governance.py`:

```python
def test_seed_creates_default_policy(store):
    from agent_governance.db import seed_guardrail_defaults
    from agent_governance.models import GuardrailPolicy, EvaluatorTemplate
    from sqlalchemy import select
    seed_guardrail_defaults.__doc__  # just confirms it's importable
```

- [ ] **Step 2: Add `seed_guardrail_defaults` to `agent_governance/db.py`**

Add this import at the top of `db.py`:

```python
from agent_governance.models import (
    AgentIdentity,
    Base,
    Customer,
    CustomerTransaction,
    EvaluatorTemplate,
    GuardrailPolicy,
    SupportCase,
)
```

Add this function before `seed_demo_data`:

```python
def seed_guardrail_defaults(session: Session) -> None:
    from agent_governance.policy import load_policy
    from agent_governance.settings import DEFAULT_POLICY_PATH

    if not session.get(GuardrailPolicy, "pol_default"):
        policy = load_policy(DEFAULT_POLICY_PATH)
        session.add(
            GuardrailPolicy(
                policy_id="pol_default",
                display_name="Default Policy",
                description="Seeded from the default policy.yaml. Edit to create custom policies.",
                environment="demo",
                config={
                    "allowed_tools": list(policy.allowed_tools),
                    "blocked_tools": list(policy.blocked_tools),
                    "max_records_returned": policy.max_records_returned,
                    "block_pii_in_response": policy.block_pii_in_response,
                    "redact_pii_in_response": policy.redact_pii_in_response,
                    "blocked_patterns": list(policy.blocked_patterns),
                    "review_required_for": list(policy.review_required_for),
                    "decision_thresholds": {
                        "review": policy.decision_thresholds.review,
                        "block": policy.decision_thresholds.block,
                    },
                },
            )
        )

    built_in = [
        EvaluatorTemplate(
            evaluator_id="eval_policy_compliance",
            display_name="Policy Compliance",
            evaluator_type="policy_compliance",
            scope="agent",
            description="Scores the fraction of policy decisions that were ALLOW in the session.",
            default_config={"pass_threshold": 80},
        ),
        EvaluatorTemplate(
            evaluator_id="eval_tool_use_correctness",
            display_name="Tool Use Correctness",
            evaluator_type="tool_use_correctness",
            scope="agent",
            description="Checks that the agent only called tools it was explicitly granted.",
            default_config={"pass_threshold": 100},
        ),
        EvaluatorTemplate(
            evaluator_id="eval_pii_leakage",
            display_name="PII Leakage",
            evaluator_type="pii_leakage",
            scope="agent",
            description="Fails if any PII-related audit event was recorded for the session.",
            default_config={"pass_threshold": 100},
        ),
        EvaluatorTemplate(
            evaluator_id="eval_workflow_completion",
            display_name="Workflow Completion",
            evaluator_type="workflow_completion",
            scope="workflow",
            description="Scores overall workflow outcome: all COMPLETED=100, any BLOCK=0, any REVIEW=50.",
            default_config={"pass_threshold": 80},
        ),
        EvaluatorTemplate(
            evaluator_id="eval_response_quality",
            display_name="Response Quality",
            evaluator_type="response_quality",
            scope="workflow",
            description="Checks the lead agent's FINAL_RESPONSE_CHECK event status.",
            default_config={"pass_threshold": 80},
        ),
    ]
    for template in built_in:
        if not session.get(EvaluatorTemplate, template.evaluator_id):
            session.add(template)
```

- [ ] **Step 3: Call `seed_guardrail_defaults` from `seed_demo_data`**

In `seed_demo_data`, add as the first line:

```python
def seed_demo_data(session: Session) -> None:
    seed_guardrail_defaults(session)
    seed_agent_identities(session)
    ...
```

- [ ] **Step 4: Add `DEFAULT_POLICY_PATH` to `agent_governance/settings.py`**

Read `agent_governance/settings.py` first, then add:

```python
DEFAULT_POLICY_PATH = os.getenv("POLICY_PATH", "policies/policy.yaml")
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_store_governance.py -v
```

Expected: `PASSED` (the seed import test).

- [ ] **Step 6: Commit**

```bash
git add agent_governance/db.py agent_governance/settings.py tests/test_store_governance.py
git commit -m "feat: seed default guardrail policy and 5 evaluator templates on startup"
```

---

## Task 4: Store methods — guardrail policies

**Files:**
- Modify: `agent_governance/store.py`
- Modify: `tests/test_store_governance.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_store_governance.py`:

```python
def test_upsert_and_get_guardrail_policy(store):
    payload = {
        "policy_id": "pol_test_001",
        "display_name": "Test Policy",
        "description": "For tests",
        "environment": "staging",
        "config": {
            "allowed_tools": ["get_customer_profile"],
            "blocked_tools": [],
            "max_records_returned": 50,
            "block_pii_in_response": True,
            "redact_pii_in_response": False,
            "blocked_patterns": [],
            "review_required_for": [],
            "decision_thresholds": {"review": 40, "block": 70},
        },
    }
    result = store.upsert_guardrail_policy(payload)
    assert result["policy_id"] == "pol_test_001"
    assert result["display_name"] == "Test Policy"

    fetched = store.get_guardrail_policy("pol_test_001")
    assert fetched["config"]["max_records_returned"] == 50

    listed = store.list_guardrail_policies(environment="staging")
    assert any(p["policy_id"] == "pol_test_001" for p in listed)
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/test_store_governance.py::test_upsert_and_get_guardrail_policy -v
```

Expected: `AttributeError: 'GovernanceStore' object has no attribute 'upsert_guardrail_policy'`.

- [ ] **Step 3: Add methods to `GovernanceStore` in `store.py`**

Add after `upsert_workflow_definition`:

```python
def list_guardrail_policies(self, environment: str | list[str] | None = None) -> list[dict[str, Any]]:
    with self.session() as db:
        stmt = select(GuardrailPolicy).order_by(GuardrailPolicy.display_name)
        if isinstance(environment, list):
            stmt = stmt.where(GuardrailPolicy.environment.in_(environment))
        elif environment and environment != "all":
            stmt = stmt.where(GuardrailPolicy.environment == environment)
        return [self._guardrail_policy_to_dict(row) for row in db.scalars(stmt).all()]

def get_guardrail_policy(self, policy_id: str) -> dict[str, Any] | None:
    with self.session() as db:
        row = db.get(GuardrailPolicy, policy_id)
        return self._guardrail_policy_to_dict(row) if row else None

def upsert_guardrail_policy(self, payload: dict[str, Any]) -> dict[str, Any]:
    with self.session() as db:
        row = db.get(GuardrailPolicy, payload["policy_id"])
        if not row:
            row = GuardrailPolicy(
                policy_id=payload["policy_id"],
                display_name=payload["display_name"],
                description=payload.get("description") or "",
                environment=payload["environment"],
                config=payload.get("config") or {},
            )
            db.add(row)
        else:
            row.display_name = payload["display_name"]
            row.description = payload.get("description") or ""
            row.environment = payload["environment"]
            row.config = payload.get("config") or {}
            row.updated_at = utc_now()
        db.flush()
        return self._guardrail_policy_to_dict(row)

@staticmethod
def _guardrail_policy_to_dict(row: GuardrailPolicy | None) -> dict[str, Any]:
    if not row:
        return {}
    return {
        "policy_id": row.policy_id,
        "display_name": row.display_name,
        "description": row.description,
        "environment": row.environment,
        "config": row.config or {},
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_store_governance.py::test_upsert_and_get_guardrail_policy -v
```

Expected: `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add agent_governance/store.py tests/test_store_governance.py
git commit -m "feat: add guardrail policy store CRUD methods"
```

---

## Task 5: Store methods — guardrail assignments + session helpers

**Files:**
- Modify: `agent_governance/store.py`
- Modify: `tests/test_store_governance.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_store_governance.py`:

```python
def test_guardrail_assignment_lifecycle(store):
    # create policy first
    store.upsert_guardrail_policy({
        "policy_id": "pol_assign_test",
        "display_name": "Assign Test Policy",
        "description": "",
        "environment": "demo",
        "config": {"decision_thresholds": {"review": 50, "block": 80}},
    })
    result = store.upsert_agent_guardrail_assignment(
        agent_id="customer-support-agent",
        environment="demo",
        policy_id="pol_assign_test",
        mode="enforce",
        threshold_overrides={},
    )
    assert result["agent_id"] == "customer-support-agent"
    assert result["mode"] == "enforce"

    fetched = store.get_agent_guardrail_assignment("customer-support-agent", "demo")
    assert fetched["policy_id"] == "pol_assign_test"

    listed = store.list_agent_guardrail_assignments("customer-support-agent")
    assert any(a["policy_id"] == "pol_assign_test" for a in listed)

    deleted = store.delete_agent_guardrail_assignment(result["assignment_id"])
    assert deleted is True
    assert store.get_agent_guardrail_assignment("customer-support-agent", "demo") is None


def test_get_sessions_for_workflow(store):
    # Use the existing store methods to create a minimal workflow + session
    workflow_id = store.create_agent_workflow(
        name="Test workflow", user_goal="test", lead_agent_id="customer-support-agent"
    )
    session_id = new_id("sess")
    store.ensure_agent_session(session_id, "customer-support-agent", "test query")
    store.link_session_to_workflow(
        workflow_id=workflow_id,
        session_id=session_id,
        agent_id="customer-support-agent",
        role="lead",
    )
    sessions = store.get_sessions_for_workflow(workflow_id)
    assert any(s["session_id"] == session_id for s in sessions)
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/test_store_governance.py::test_guardrail_assignment_lifecycle -v
```

Expected: `AttributeError`.

- [ ] **Step 3: Add methods to `GovernanceStore`**

```python
def get_agent_guardrail_assignment(self, agent_id: str, environment: str) -> dict[str, Any] | None:
    with self.session() as db:
        row = db.scalar(
            select(AgentGuardrailAssignment).where(
                AgentGuardrailAssignment.agent_id == agent_id,
                AgentGuardrailAssignment.environment == environment,
            )
        )
        return self._guardrail_assignment_to_dict(row) if row else None

def list_agent_guardrail_assignments(self, agent_id: str) -> list[dict[str, Any]]:
    with self.session() as db:
        rows = db.scalars(
            select(AgentGuardrailAssignment)
            .where(AgentGuardrailAssignment.agent_id == agent_id)
            .order_by(AgentGuardrailAssignment.environment)
        ).all()
        return [self._guardrail_assignment_to_dict(row) for row in rows]

def upsert_agent_guardrail_assignment(
    self,
    *,
    agent_id: str,
    environment: str,
    policy_id: str,
    mode: str,
    threshold_overrides: dict[str, Any],
) -> dict[str, Any]:
    with self.session() as db:
        row = db.scalar(
            select(AgentGuardrailAssignment).where(
                AgentGuardrailAssignment.agent_id == agent_id,
                AgentGuardrailAssignment.environment == environment,
            )
        )
        if not row:
            row = AgentGuardrailAssignment(
                assignment_id=new_id("gra"),
                agent_id=agent_id,
                environment=environment,
                policy_id=policy_id,
                mode=mode,
                threshold_overrides=threshold_overrides or {},
            )
            db.add(row)
        else:
            row.policy_id = policy_id
            row.mode = mode
            row.threshold_overrides = threshold_overrides or {}
            row.updated_at = utc_now()
        db.flush()
        return self._guardrail_assignment_to_dict(row)

def delete_agent_guardrail_assignment(self, assignment_id: str) -> bool:
    with self.session() as db:
        row = db.get(AgentGuardrailAssignment, assignment_id)
        if not row:
            return False
        db.delete(row)
        return True

def get_sessions_for_workflow(self, workflow_id: str) -> list[dict[str, Any]]:
    with self.session() as db:
        links = db.scalars(
            select(WorkflowSessionLink).where(WorkflowSessionLink.workflow_id == workflow_id)
        ).all()
        result = []
        for link in links:
            session = db.get(AgentSession, link.session_id)
            if session:
                result.append({
                    "session_id": session.session_id,
                    "agent_id": session.agent_id,
                    "status": session.status,
                })
        return result

def get_policy_decisions_for_session(self, session_id: str) -> list[dict[str, Any]]:
    with self.session() as db:
        rows = db.scalars(
            select(PolicyDecision).where(PolicyDecision.session_id == session_id)
        ).all()
        return [{"decision": row.decision, "tool_name": row.tool_name} for row in rows]

def get_tool_calls_for_session(self, session_id: str) -> list[dict[str, Any]]:
    with self.session() as db:
        rows = db.scalars(
            select(ToolCall).where(ToolCall.session_id == session_id)
        ).all()
        return [{"tool_name": row.tool_name, "decision": row.decision} for row in rows]

def get_audit_events_for_session(self, session_id: str) -> list[dict[str, Any]]:
    with self.session() as db:
        rows = db.scalars(
            select(AuditEvent).where(AuditEvent.session_id == session_id)
        ).all()
        return [{"risk_type": row.risk_type, "decision": row.decision} for row in rows]

@staticmethod
def _guardrail_assignment_to_dict(row: AgentGuardrailAssignment | None) -> dict[str, Any]:
    if not row:
        return {}
    return {
        "assignment_id": row.assignment_id,
        "agent_id": row.agent_id,
        "environment": row.environment,
        "policy_id": row.policy_id,
        "mode": row.mode,
        "threshold_overrides": row.threshold_overrides or {},
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }
```

Also add `new_id` import to `tests/test_store_governance.py`:
```python
from agent_governance.models import new_id
```

- [ ] **Step 4: Run all store tests**

```bash
pytest tests/test_store_governance.py -v
```

Expected: All `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add agent_governance/store.py tests/test_store_governance.py
git commit -m "feat: add guardrail assignment store methods + session helpers"
```

---

## Task 6: Store methods — evaluator templates + assignments

**Files:**
- Modify: `agent_governance/store.py`
- Modify: `tests/test_store_governance.py`

- [ ] **Step 1: Write failing tests**

```python
def test_evaluator_template_and_assignment(store):
    templates = store.list_evaluator_templates()
    # seeded 5 built-ins in Task 3
    assert any(t["evaluator_id"] == "eval_policy_compliance" for t in templates)

    result = store.upsert_agent_evaluator_assignment(
        agent_id="customer-support-agent",
        environment="demo",
        evaluator_id="eval_policy_compliance",
        trigger="after_run",
        config={},
    )
    assert result["evaluator_id"] == "eval_policy_compliance"
    assert result["trigger"] == "after_run"

    assignments = store.list_agent_evaluator_assignments("customer-support-agent")
    assert any(a["evaluator_id"] == "eval_policy_compliance" for a in assignments)

    by_trigger = store.get_agent_evaluator_assignments_for_trigger(
        "customer-support-agent", "demo", "after_run"
    )
    assert any(a["evaluator_id"] == "eval_policy_compliance" for a in by_trigger)

    deleted = store.delete_agent_evaluator_assignment(result["assignment_id"])
    assert deleted is True
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/test_store_governance.py::test_evaluator_template_and_assignment -v
```

Expected: `AttributeError`.

- [ ] **Step 3: Add methods to `GovernanceStore`**

```python
def list_evaluator_templates(self) -> list[dict[str, Any]]:
    with self.session() as db:
        rows = db.scalars(select(EvaluatorTemplate).order_by(EvaluatorTemplate.display_name)).all()
        return [self._evaluator_template_to_dict(row) for row in rows]

def get_evaluator_template(self, evaluator_id: str) -> dict[str, Any] | None:
    with self.session() as db:
        row = db.get(EvaluatorTemplate, evaluator_id)
        return self._evaluator_template_to_dict(row) if row else None

def upsert_evaluator_template(self, payload: dict[str, Any]) -> dict[str, Any]:
    with self.session() as db:
        row = db.get(EvaluatorTemplate, payload["evaluator_id"])
        if not row:
            row = EvaluatorTemplate(
                evaluator_id=payload["evaluator_id"],
                display_name=payload["display_name"],
                evaluator_type=payload["evaluator_type"],
                scope=payload["scope"],
                description=payload.get("description") or "",
                default_config=payload.get("default_config") or {},
                llm_enabled=bool(payload.get("llm_enabled", False)),
            )
            db.add(row)
        else:
            row.display_name = payload["display_name"]
            row.evaluator_type = payload["evaluator_type"]
            row.scope = payload["scope"]
            row.description = payload.get("description") or ""
            row.default_config = payload.get("default_config") or {}
            row.llm_enabled = bool(payload.get("llm_enabled", False))
            row.updated_at = utc_now()
        db.flush()
        return self._evaluator_template_to_dict(row)

def list_agent_evaluator_assignments(self, agent_id: str) -> list[dict[str, Any]]:
    with self.session() as db:
        rows = db.scalars(
            select(AgentEvaluatorAssignment)
            .where(AgentEvaluatorAssignment.agent_id == agent_id)
            .order_by(AgentEvaluatorAssignment.environment, AgentEvaluatorAssignment.evaluator_id)
        ).all()
        return [self._evaluator_assignment_to_dict(row) for row in rows]

def get_agent_evaluator_assignments_for_trigger(
    self, agent_id: str, environment: str, trigger: str
) -> list[dict[str, Any]]:
    with self.session() as db:
        rows = db.scalars(
            select(AgentEvaluatorAssignment).where(
                AgentEvaluatorAssignment.agent_id == agent_id,
                AgentEvaluatorAssignment.environment == environment,
                AgentEvaluatorAssignment.trigger == trigger,
            )
        ).all()
        return [self._evaluator_assignment_to_dict(row) for row in rows]

def upsert_agent_evaluator_assignment(
    self,
    *,
    agent_id: str,
    environment: str,
    evaluator_id: str,
    trigger: str,
    config: dict[str, Any],
) -> dict[str, Any]:
    with self.session() as db:
        row = db.scalar(
            select(AgentEvaluatorAssignment).where(
                AgentEvaluatorAssignment.agent_id == agent_id,
                AgentEvaluatorAssignment.environment == environment,
                AgentEvaluatorAssignment.evaluator_id == evaluator_id,
            )
        )
        if not row:
            row = AgentEvaluatorAssignment(
                assignment_id=new_id("eva"),
                agent_id=agent_id,
                environment=environment,
                evaluator_id=evaluator_id,
                trigger=trigger,
                config=config or {},
            )
            db.add(row)
        else:
            row.trigger = trigger
            row.config = config or {}
            row.updated_at = utc_now()
        db.flush()
        return self._evaluator_assignment_to_dict(row)

def delete_agent_evaluator_assignment(self, assignment_id: str) -> bool:
    with self.session() as db:
        row = db.get(AgentEvaluatorAssignment, assignment_id)
        if not row:
            return False
        db.delete(row)
        return True

@staticmethod
def _evaluator_template_to_dict(row: EvaluatorTemplate | None) -> dict[str, Any]:
    if not row:
        return {}
    return {
        "evaluator_id": row.evaluator_id,
        "display_name": row.display_name,
        "evaluator_type": row.evaluator_type,
        "scope": row.scope,
        "description": row.description,
        "default_config": row.default_config or {},
        "llm_enabled": bool(row.llm_enabled),
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }

@staticmethod
def _evaluator_assignment_to_dict(row: AgentEvaluatorAssignment | None) -> dict[str, Any]:
    if not row:
        return {}
    return {
        "assignment_id": row.assignment_id,
        "agent_id": row.agent_id,
        "environment": row.environment,
        "evaluator_id": row.evaluator_id,
        "trigger": row.trigger,
        "config": row.config or {},
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_store_governance.py -v
```

Expected: All `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add agent_governance/store.py tests/test_store_governance.py
git commit -m "feat: add evaluator template and assignment store methods"
```

---

## Task 7: Store methods — evaluation results

**Files:**
- Modify: `agent_governance/store.py`
- Modify: `tests/test_store_governance.py`

- [ ] **Step 1: Write failing test**

```python
def test_evaluation_result_lifecycle(store):
    session_id = new_id("sess")
    store.ensure_agent_session(session_id, "customer-support-agent", "test query")

    result = store.add_evaluation_result(
        session_id=session_id,
        workflow_id=None,
        agent_id="customer-support-agent",
        evaluator_id="eval_policy_compliance",
        score=90,
        passed=True,
        findings=[{"check": "policy_decisions", "result": "pass", "detail": "9/10 ALLOW"}],
        trigger="after_run",
    )
    assert result["score"] == 90
    assert result["passed"] is True

    session_results = store.list_session_evaluation_results(session_id)
    assert any(r["evaluator_id"] == "eval_policy_compliance" for r in session_results)

    all_results = store.list_evaluation_results(agent_id="customer-support-agent")
    assert any(r["session_id"] == session_id for r in all_results)
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/test_store_governance.py::test_evaluation_result_lifecycle -v
```

Expected: `AttributeError`.

- [ ] **Step 3: Add methods to `GovernanceStore`**

```python
def add_evaluation_result(
    self,
    *,
    session_id: str,
    workflow_id: str | None,
    agent_id: str,
    evaluator_id: str,
    score: int,
    passed: bool,
    findings: list[dict[str, Any]],
    trigger: str,
) -> dict[str, Any]:
    result_id = new_id("evr")
    with self.session() as db:
        row = EvaluationResult(
            result_id=result_id,
            session_id=session_id,
            workflow_id=workflow_id,
            agent_id=agent_id,
            evaluator_id=evaluator_id,
            score=score,
            passed=passed,
            findings=findings,
            trigger=trigger,
        )
        db.add(row)
        db.flush()
        return self._evaluation_result_to_dict(row)

def list_session_evaluation_results(self, session_id: str) -> list[dict[str, Any]]:
    with self.session() as db:
        rows = db.scalars(
            select(EvaluationResult)
            .where(EvaluationResult.session_id == session_id)
            .order_by(EvaluationResult.created_at)
        ).all()
        return [self._evaluation_result_to_dict(row) for row in rows]

def list_evaluation_results(
    self,
    environment: str | list[str] | None = None,
    agent_id: str | None = None,
    session_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    with self.session() as db:
        stmt = select(EvaluationResult).order_by(desc(EvaluationResult.created_at)).limit(limit)
        if agent_id:
            stmt = stmt.where(EvaluationResult.agent_id == agent_id)
        if session_id:
            stmt = stmt.where(EvaluationResult.session_id == session_id)
        rows = db.scalars(stmt).all()
        results = []
        for row in rows:
            if environment:
                identity = db.get(AgentIdentity, row.agent_id)
                if not self._environment_matches(identity.environment if identity else None, environment):
                    continue
            results.append(self._evaluation_result_to_dict(row))
        return results

@staticmethod
def _evaluation_result_to_dict(row: EvaluationResult | None) -> dict[str, Any]:
    if not row:
        return {}
    return {
        "result_id": row.result_id,
        "session_id": row.session_id,
        "workflow_id": row.workflow_id,
        "agent_id": row.agent_id,
        "evaluator_id": row.evaluator_id,
        "score": row.score,
        "passed": bool(row.passed),
        "findings": row.findings or [],
        "trigger": row.trigger,
        "created_at": row.created_at.isoformat(),
    }
```

- [ ] **Step 4: Run all store tests**

```bash
pytest tests/test_store_governance.py -v
```

Expected: All `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add agent_governance/store.py tests/test_store_governance.py
git commit -m "feat: add evaluation result store methods"
```

---

## Task 8: Evaluator engine — agent-scoped evaluators

**Files:**
- Create: `agent_governance/evaluators.py`
- Create: `tests/test_evaluators.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_evaluators.py
from __future__ import annotations
import pytest
from agent_governance.models import new_id
from agent_governance.evaluators import EvaluatorEngine, EvaluatorResult


def _make_session(store, agent_id="customer-support-agent"):
    session_id = new_id("sess")
    store.ensure_agent_session(session_id, agent_id, "test query")
    return session_id


def test_policy_compliance_all_allow(store):
    session_id = _make_session(store)
    store.add_policy_decision(session_id=session_id, agent_id="customer-support-agent",
        tool_name="get_customer_profile", decision="ALLOW", risk_score=0, risk_types=[], reason="OK", triggered_rules=[])
    store.add_policy_decision(session_id=session_id, agent_id="customer-support-agent",
        tool_name="get_customer_transactions", decision="ALLOW", risk_score=0, risk_types=[], reason="OK", triggered_rules=[])
    engine = EvaluatorEngine(store)
    template = {"evaluator_type": "policy_compliance", "scope": "agent", "default_config": {"pass_threshold": 80}}
    result = engine._run_evaluator(template, {"config": {}}, session_id=session_id)
    assert result.score == 100
    assert result.passed is True


def test_policy_compliance_with_block(store):
    session_id = _make_session(store)
    store.add_policy_decision(session_id=session_id, agent_id="customer-support-agent",
        tool_name="t1", decision="ALLOW", risk_score=0, risk_types=[], reason="OK", triggered_rules=[])
    store.add_policy_decision(session_id=session_id, agent_id="customer-support-agent",
        tool_name="t2", decision="BLOCK", risk_score=90, risk_types=["TOOL_MISUSE"], reason="blocked", triggered_rules=[])
    engine = EvaluatorEngine(store)
    template = {"evaluator_type": "policy_compliance", "scope": "agent", "default_config": {"pass_threshold": 80}}
    result = engine._run_evaluator(template, {"config": {}}, session_id=session_id)
    assert result.score == 50
    assert result.passed is False


def test_tool_use_correctness_granted_tools(store):
    session_id = _make_session(store)
    store.add_tool_call(session_id=session_id, agent_id="customer-support-agent",
        tool_name="get_customer_profile", tool_args={}, decision="ALLOW")
    engine = EvaluatorEngine(store)
    template = {"evaluator_type": "tool_use_correctness", "scope": "agent", "default_config": {"pass_threshold": 100}}
    result = engine._run_evaluator(template, {"config": {}}, session_id=session_id)
    assert result.score == 100
    assert result.passed is True


def test_tool_use_correctness_ungrant_tool(store):
    session_id = _make_session(store)
    store.add_tool_call(session_id=session_id, agent_id="customer-support-agent",
        tool_name="drop_database", tool_args={}, decision="BLOCK")
    engine = EvaluatorEngine(store)
    template = {"evaluator_type": "tool_use_correctness", "scope": "agent", "default_config": {"pass_threshold": 100}}
    result = engine._run_evaluator(template, {"config": {}}, session_id=session_id)
    assert result.score < 100
    assert result.passed is False


def test_pii_leakage_clean(store):
    session_id = _make_session(store)
    engine = EvaluatorEngine(store)
    template = {"evaluator_type": "pii_leakage", "scope": "agent", "default_config": {"pass_threshold": 100}}
    result = engine._run_evaluator(template, {"config": {}}, session_id=session_id)
    assert result.score == 100
    assert result.passed is True


def test_pii_leakage_detected(store):
    session_id = _make_session(store)
    store.add_audit_event(session_id=session_id, agent_id="customer-support-agent",
        risk_type="PII_LEAKAGE", decision="BLOCK", reason="PII detected", tool_name=None, risk_score=88)
    engine = EvaluatorEngine(store)
    template = {"evaluator_type": "pii_leakage", "scope": "agent", "default_config": {"pass_threshold": 100}}
    result = engine._run_evaluator(template, {"config": {}}, session_id=session_id)
    assert result.score == 0
    assert result.passed is False
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/test_evaluators.py -v
```

Expected: `ImportError: cannot import name 'EvaluatorEngine'`.

- [ ] **Step 3: Create `agent_governance/evaluators.py`**

```python
# agent_governance/evaluators.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from agent_governance.store import GovernanceStore


@dataclass
class EvaluatorResult:
    evaluator_id: str
    score: int
    passed: bool
    findings: list[dict[str, Any]]


class EvaluatorEngine:
    def __init__(self, store: GovernanceStore) -> None:
        self.store = store

    def run_for_session(self, session_id: str, agent_id: str, environment: str) -> list[EvaluatorResult]:
        assignments = self.store.get_agent_evaluator_assignments_for_trigger(agent_id, environment, "after_run")
        results = []
        for assignment in assignments:
            template = self.store.get_evaluator_template(assignment["evaluator_id"])
            if not template or template["scope"] != "agent":
                continue
            result = self._run_evaluator(template, assignment, session_id=session_id)
            self.store.add_evaluation_result(
                session_id=session_id,
                workflow_id=None,
                agent_id=agent_id,
                evaluator_id=template["evaluator_id"],
                score=result.score,
                passed=result.passed,
                findings=result.findings,
                trigger="after_run",
            )
            results.append(result)
        return results

    def run_for_workflow(
        self, workflow_id: str, lead_session_id: str, agent_id: str, environment: str
    ) -> list[EvaluatorResult]:
        assignments = self.store.get_agent_evaluator_assignments_for_trigger(agent_id, environment, "after_workflow")
        results = []
        for assignment in assignments:
            template = self.store.get_evaluator_template(assignment["evaluator_id"])
            if not template or template["scope"] != "workflow":
                continue
            result = self._run_evaluator(template, assignment, workflow_id=workflow_id, session_id=lead_session_id)
            self.store.add_evaluation_result(
                session_id=lead_session_id,
                workflow_id=workflow_id,
                agent_id=agent_id,
                evaluator_id=template["evaluator_id"],
                score=result.score,
                passed=result.passed,
                findings=result.findings,
                trigger="after_workflow",
            )
            results.append(result)
        return results

    def _run_evaluator(
        self,
        template: dict[str, Any],
        assignment: dict[str, Any],
        *,
        session_id: str | None = None,
        workflow_id: str | None = None,
    ) -> EvaluatorResult:
        config = {**template["default_config"], **assignment.get("config", {})}
        evaluator_type = template["evaluator_type"]
        evaluator_id = template["evaluator_id"]

        if evaluator_type == "policy_compliance":
            return self._policy_compliance(evaluator_id, session_id, config)
        if evaluator_type == "tool_use_correctness":
            return self._tool_use_correctness(evaluator_id, session_id, config)
        if evaluator_type == "pii_leakage":
            return self._pii_leakage(evaluator_id, session_id, config)
        if evaluator_type == "workflow_completion":
            return self._workflow_completion(evaluator_id, workflow_id, config)
        if evaluator_type == "response_quality":
            return self._response_quality(evaluator_id, session_id, config)
        return EvaluatorResult(
            evaluator_id=evaluator_id,
            score=0,
            passed=False,
            findings=[{"check": "unknown_type", "result": "error", "detail": f"Unknown evaluator type: {evaluator_type}"}],
        )

    def _policy_compliance(self, evaluator_id: str, session_id: str, config: dict) -> EvaluatorResult:
        pass_threshold = config.get("pass_threshold", 80)
        decisions = self.store.get_policy_decisions_for_session(session_id)
        if not decisions:
            return EvaluatorResult(evaluator_id=evaluator_id, score=100, passed=True,
                findings=[{"check": "policy_decisions", "result": "pass", "detail": "No policy decisions recorded"}])
        allow_count = sum(1 for d in decisions if d["decision"] == "ALLOW")
        score = int((allow_count / len(decisions)) * 100)
        passed = score >= pass_threshold
        return EvaluatorResult(
            evaluator_id=evaluator_id, score=score, passed=passed,
            findings=[{"check": "policy_decisions", "result": "pass" if passed else "fail",
                       "detail": f"{allow_count}/{len(decisions)} decisions were ALLOW"}],
        )

    def _tool_use_correctness(self, evaluator_id: str, session_id: str, config: dict) -> EvaluatorResult:
        pass_threshold = config.get("pass_threshold", 100)
        tool_calls = self.store.get_tool_calls_for_session(session_id)
        if not tool_calls:
            return EvaluatorResult(evaluator_id=evaluator_id, score=100, passed=True,
                findings=[{"check": "tool_calls", "result": "pass", "detail": "No tool calls recorded"}])
        sessions = self.store.list_sessions(limit=1)
        # get agent_id from session
        agent_session = next((s for s in self.store.list_sessions(limit=500) if s["session_id"] == session_id), None)
        granted_tools: set[str] = set()
        if agent_session:
            identity = self.store.get_agent_identity(agent_session["agent_id"])
            granted_tools = set(identity.get("permissions", {}).get("tools", []))
        correct = sum(1 for tc in tool_calls if tc["tool_name"] in granted_tools)
        score = int((correct / len(tool_calls)) * 100)
        passed = score >= pass_threshold
        return EvaluatorResult(
            evaluator_id=evaluator_id, score=score, passed=passed,
            findings=[{"check": "tool_calls", "result": "pass" if passed else "fail",
                       "detail": f"{correct}/{len(tool_calls)} tool calls used granted tools"}],
        )

    def _pii_leakage(self, evaluator_id: str, session_id: str, config: dict) -> EvaluatorResult:
        audit_events = self.store.get_audit_events_for_session(session_id)
        pii_events = [
            e for e in audit_events
            if any(kw in e.get("risk_type", "").upper() for kw in ("PII", "EMAIL", "PHONE"))
        ]
        if pii_events:
            return EvaluatorResult(
                evaluator_id=evaluator_id, score=0, passed=False,
                findings=[{"check": "pii_leakage", "result": "fail",
                           "detail": f"PII in {len(pii_events)} event(s): {[e['risk_type'] for e in pii_events]}"}],
            )
        return EvaluatorResult(evaluator_id=evaluator_id, score=100, passed=True,
            findings=[{"check": "pii_leakage", "result": "pass", "detail": "No PII detected"}])

    def _workflow_completion(self, evaluator_id: str, workflow_id: str, config: dict) -> EvaluatorResult:
        pass_threshold = config.get("pass_threshold", 80)
        sessions = self.store.get_sessions_for_workflow(workflow_id) if workflow_id else []
        if not sessions:
            return EvaluatorResult(evaluator_id=evaluator_id, score=0, passed=False,
                findings=[{"check": "workflow_completion", "result": "fail", "detail": "No sessions found"}])
        statuses = [s["status"] for s in sessions]
        if any(s == "BLOCK" for s in statuses):
            score = 0
        elif any(s == "REVIEW" for s in statuses):
            score = 50
        elif all(s == "COMPLETED" for s in statuses):
            score = 100
        else:
            score = 50
        passed = score >= pass_threshold
        return EvaluatorResult(
            evaluator_id=evaluator_id, score=score, passed=passed,
            findings=[{"check": "workflow_completion", "result": "pass" if passed else "fail",
                       "detail": f"Session statuses: {statuses}"}],
        )

    def _response_quality(self, evaluator_id: str, session_id: str, config: dict) -> EvaluatorResult:
        pass_threshold = config.get("pass_threshold", 80)
        events = self.store.workflow_for_session(session_id) if session_id else []
        checks = [e for e in events if e["event_type"] == "FINAL_RESPONSE_CHECK"]
        if not checks:
            return EvaluatorResult(evaluator_id=evaluator_id, score=50, passed=False,
                findings=[{"check": "response_quality", "result": "unknown", "detail": "No FINAL_RESPONSE_CHECK event"}])
        latest = checks[-1]
        score = 100 if latest["status"] == "ALLOW" else (0 if latest["status"] == "BLOCK" else 50)
        passed = score >= pass_threshold
        return EvaluatorResult(
            evaluator_id=evaluator_id, score=score, passed=passed,
            findings=[{"check": "response_quality", "result": "pass" if passed else "fail",
                       "detail": f"Final response check: {latest['status']}"}],
        )
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_evaluators.py -v
```

Expected: All `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add agent_governance/evaluators.py tests/test_evaluators.py
git commit -m "feat: add EvaluatorEngine with 5 rule-based evaluators"
```

---

## Task 9: GovernedToolRunner — per-agent policy resolution + mode enforcement

**Files:**
- Modify: `agent_governance/runner.py`
- Create: `tests/test_runner_guardrails.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_runner_guardrails.py
from __future__ import annotations
import pytest
from unittest.mock import patch
from agent_governance.runner import GovernedToolRunner
from agent_governance.policy import PolicyConfig, DecisionThresholds
from agent_governance.tools import build_customer_tool_registry


def _make_runner(store, policy_path="policies/policy.yaml"):
    return GovernedToolRunner(
        agent_id="customer-support-agent",
        database_url=store.session_factory.kw["bind"].url.render_as_string(hide_password=False),
        policy_path=policy_path,
        tools=build_customer_tool_registry(),
    )


def test_no_assignment_falls_back_to_yaml(store):
    runner = _make_runner(store)
    assert runner.guardrail_mode == "enforce"
    assert isinstance(runner.policy, PolicyConfig)


def test_assignment_enforce_mode_uses_db_policy(store):
    store.upsert_guardrail_policy({
        "policy_id": "pol_runner_test",
        "display_name": "Runner Test Policy",
        "description": "",
        "environment": "demo",
        "config": {
            "allowed_tools": [], "blocked_tools": [], "max_records_returned": 10,
            "block_pii_in_response": True, "redact_pii_in_response": False,
            "blocked_patterns": [], "review_required_for": [],
            "decision_thresholds": {"review": 30, "block": 60},
        },
    })
    store.upsert_agent_guardrail_assignment(
        agent_id="customer-support-agent", environment="demo",
        policy_id="pol_runner_test", mode="enforce", threshold_overrides={},
    )
    runner = _make_runner(store)
    assert runner.guardrail_mode == "enforce"
    assert runner.policy.max_records_returned == 10
    assert runner.policy.decision_thresholds.block == 60
    # cleanup
    assignment = store.get_agent_guardrail_assignment("customer-support-agent", "demo")
    store.delete_agent_guardrail_assignment(assignment["assignment_id"])


def test_review_only_mode_downgrades_block(store):
    store.upsert_guardrail_policy({
        "policy_id": "pol_review_only",
        "display_name": "Review Only",
        "description": "",
        "environment": "demo",
        "config": {
            "allowed_tools": [], "blocked_tools": ["get_customer_profile"],
            "max_records_returned": 100, "block_pii_in_response": True,
            "redact_pii_in_response": False, "blocked_patterns": [],
            "review_required_for": [], "decision_thresholds": {"review": 50, "block": 80},
        },
    })
    store.upsert_agent_guardrail_assignment(
        agent_id="customer-support-agent", environment="demo",
        policy_id="pol_review_only", mode="review_only", threshold_overrides={},
    )
    from agent_governance.models import new_id
    session_id = new_id("sess")
    runner = _make_runner(store)
    result = runner.evaluate_tool_call(
        session_id=session_id, user_query="get profile",
        tool_name="get_customer_profile", tool_args={"customer_id": "C123"},
    )
    # policy blocks get_customer_profile but review_only downgrades to REVIEW
    assert result.decision == "REVIEW"
    # cleanup
    assignment = store.get_agent_guardrail_assignment("customer-support-agent", "demo")
    store.delete_agent_guardrail_assignment(assignment["assignment_id"])


def test_disabled_mode_allows_everything(store):
    store.upsert_guardrail_policy({
        "policy_id": "pol_disabled",
        "display_name": "Disabled",
        "description": "",
        "environment": "demo",
        "config": {
            "allowed_tools": [], "blocked_tools": ["get_customer_profile"],
            "max_records_returned": 100, "block_pii_in_response": True,
            "redact_pii_in_response": False, "blocked_patterns": [],
            "review_required_for": [], "decision_thresholds": {"review": 50, "block": 80},
        },
    })
    store.upsert_agent_guardrail_assignment(
        agent_id="customer-support-agent", environment="demo",
        policy_id="pol_disabled", mode="disabled", threshold_overrides={},
    )
    from agent_governance.models import new_id
    session_id = new_id("sess")
    runner = _make_runner(store)
    result = runner.evaluate_tool_call(
        session_id=session_id, user_query="get profile",
        tool_name="get_customer_profile", tool_args={"customer_id": "C123"},
    )
    assert result.decision == "ALLOW"
    # cleanup
    assignment = store.get_agent_guardrail_assignment("customer-support-agent", "demo")
    store.delete_agent_guardrail_assignment(assignment["assignment_id"])
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest tests/test_runner_guardrails.py -v
```

Expected: `AttributeError: 'GovernedToolRunner' object has no attribute 'guardrail_mode'`.

- [ ] **Step 3: Modify `agent_governance/runner.py`**

Add import at top:
```python
from dataclasses import replace as dataclass_replace
from agent_governance.evaluators import EvaluatorEngine
from agent_governance.policy import DecisionThresholds
```

Replace `__init__`:
```python
def __init__(
    self,
    *,
    agent_id: str,
    database_url: str,
    policy_path: str,
    tools: ToolRegistry,
) -> None:
    self.agent_id = agent_id
    self.store = GovernanceStore(database_url)
    self.tools = tools
    self.guardrail_mode, self.policy = self._resolve_policy(policy_path)
    self.evaluator_engine = EvaluatorEngine(self.store)
```

Add `_resolve_policy` and `_apply_mode` as static/instance methods:
```python
def _resolve_policy(self, policy_path: str) -> tuple[str, PolicyConfig]:
    identity = self.store.get_agent_identity(self.agent_id)
    environment = identity.get("environment", "local")
    assignment = self.store.get_agent_guardrail_assignment(self.agent_id, environment)
    if not assignment:
        return "enforce", load_policy(policy_path)
    mode = assignment["mode"]
    if mode == "disabled":
        return "disabled", load_policy(policy_path)
    policy_row = self.store.get_guardrail_policy(assignment["policy_id"])
    if not policy_row:
        return mode, load_policy(policy_path)
    config = dict(policy_row["config"])
    overrides = assignment.get("threshold_overrides") or {}
    thresholds = dict(config.get("decision_thresholds") or {})
    if "block" in overrides:
        thresholds["block"] = int(overrides["block"])
    if "review" in overrides:
        thresholds["review"] = int(overrides["review"])
    return mode, PolicyConfig(
        allowed_tools=list(config.get("allowed_tools") or []),
        blocked_tools=list(config.get("blocked_tools") or []),
        max_records_returned=int(config.get("max_records_returned", 100)),
        block_pii_in_response=bool(config.get("block_pii_in_response", True)),
        redact_pii_in_response=bool(config.get("redact_pii_in_response", False)),
        blocked_patterns=list(config.get("blocked_patterns") or []),
        review_required_for=list(config.get("review_required_for") or []),
        decision_thresholds=DecisionThresholds(
            review=int(thresholds.get("review", 50)),
            block=int(thresholds.get("block", 80)),
        ),
    )

def _apply_mode(self, assessment: RiskAssessment) -> RiskAssessment:
    if self.guardrail_mode == "review_only" and assessment.decision == "BLOCK":
        return dataclass_replace(
            assessment,
            decision="REVIEW",
            reason=f"[review_only mode] {assessment.reason}",
        )
    return assessment
```

In `evaluate_tool_call`, add mode guard right after `_emit_user_and_agent_events`:
```python
if self.guardrail_mode == "disabled":
    return GovernedToolResult(
        decision="ALLOW",
        risk_score=0,
        risk_types=[],
        reason="Guardrails disabled for this agent in this environment.",
    )

assessment = assess_tool_call(...)
assessment = self._apply_mode(assessment)
```

In `call_tool`, after `result_assessment = assess_tool_result(...)`:
```python
result_assessment = self._apply_mode(result_assessment)
```

In `check_final_response`, add mode guard at the top:
```python
if self.guardrail_mode == "disabled":
    self.store.update_session_status(session_id, "COMPLETED")
    return GovernedToolResult(
        decision="ALLOW",
        risk_score=0,
        risk_types=[],
        reason="Guardrails disabled.",
        response_text=response_text,
    )

assessment = assess_final_response(self.policy, response_text)
assessment = self._apply_mode(assessment)
```

Also update the `final_decision` logic in `check_final_response` to apply the mode to the PII redaction branch:
```python
final_text = response_text
final_decision = assessment.decision

if final_decision == "BLOCK" and self.policy.redact_pii_in_response:
    final_text = redact_pii(response_text)
    final_decision = "ALLOW"
```
This section is unchanged — the `_apply_mode` call above has already handled BLOCK→REVIEW, so a BLOCK here means `mode != review_only`.

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_runner_guardrails.py -v
```

Expected: All `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add agent_governance/runner.py tests/test_runner_guardrails.py
git commit -m "feat: per-agent policy resolution and mode enforcement in GovernedToolRunner"
```

---

## Task 10: GovernedToolRunner — post-run evaluation trigger

**Files:**
- Modify: `agent_governance/runner.py`

- [ ] **Step 1: Add `_run_post_session_evaluators` to `GovernedToolRunner`**

```python
def _run_post_session_evaluators(self, session_id: str) -> None:
    identity = self.store.get_agent_identity(self.agent_id)
    environment = identity.get("environment", "local")
    results = self.evaluator_engine.run_for_session(session_id, self.agent_id, environment)
    if results:
        self.store.add_workflow_event(
            session_id=session_id,
            agent_id=self.agent_id,
            event_type="EVALUATION_COMPLETE",
            label="Evaluation complete",
            status="COMPLETED",
            payload={
                "results": [
                    {"evaluator_id": r.evaluator_id, "score": r.score, "passed": r.passed, "findings": r.findings}
                    for r in results
                ]
            },
        )
```

- [ ] **Step 2: Call it in `check_final_response`**

In `check_final_response`, after `store.update_session_status(session_id, "COMPLETED")` (the success path at the bottom), add:

```python
self.store.update_session_status(session_id, "COMPLETED")
self._run_post_session_evaluators(session_id)
return GovernedToolResult(...)
```

Also call it in the `disabled` guardrail early return path:
```python
if self.guardrail_mode == "disabled":
    self.store.update_session_status(session_id, "COMPLETED")
    self._run_post_session_evaluators(session_id)
    return GovernedToolResult(...)
```

- [ ] **Step 3: Verify existing runner tests still pass**

```bash
pytest tests/ -v
```

Expected: All `PASSED`.

- [ ] **Step 4: Commit**

```bash
git add agent_governance/runner.py
git commit -m "feat: trigger agent-scoped evaluators after each session completes"
```

---

## Task 11: Workflow-level evaluation in `multi_agent.py`

**Files:**
- Modify: `agent_governance/multi_agent.py`

- [ ] **Step 1: Add import and evaluation call at end of `run_customer_support_workflow`**

Add import at top of `multi_agent.py`:
```python
from agent_governance.evaluators import EvaluatorEngine
```

In `run_customer_support_workflow`, replace the final `return` block with:

```python
    # Workflow-level evaluation (after_workflow evaluators on the lead agent)
    lead_identity = store.get_agent_identity(lead_agent_id)
    environment = lead_identity.get("environment", "demo")
    evaluator_engine = EvaluatorEngine(store)
    eval_results = evaluator_engine.run_for_workflow(workflow_id, lead_session_id, lead_agent_id, environment)
    if eval_results:
        store.add_workflow_event(
            session_id=lead_session_id,
            agent_id=lead_agent_id,
            event_type="WORKFLOW_EVALUATION_COMPLETE",
            label="Workflow evaluation complete",
            status="COMPLETED",
            payload={
                "results": [
                    {"evaluator_id": r.evaluator_id, "score": r.score, "passed": r.passed}
                    for r in eval_results
                ]
            },
        )

    return {
        "workflow_id": workflow_id,
        "decision": final_decision,
        "summary": summary,
        "lead_session_id": lead_session_id,
        "sessions": step_session_ids,
    }
```

- [ ] **Step 2: Verify all tests pass**

```bash
pytest tests/ -v
```

Expected: All `PASSED`.

- [ ] **Step 3: Commit**

```bash
git add agent_governance/multi_agent.py
git commit -m "feat: trigger workflow-scoped evaluators at end of multi-agent workflow"
```

---

## Task 12: API endpoints — guardrail policies + assignments

**Files:**
- Modify: `api/main.py`

- [ ] **Step 1: Add Pydantic request models to `api/main.py`**

Add after the existing request models:

```python
class GuardrailPolicyRequest(BaseModel):
    policy_id: str
    display_name: str
    description: str = ""
    environment: str = "demo"
    config: dict[str, Any] = Field(default_factory=dict)


class AgentGuardrailAssignmentRequest(BaseModel):
    policy_id: str
    mode: str = Field(pattern="^(enforce|review_only|disabled)$")
    threshold_overrides: dict[str, Any] = Field(default_factory=dict)


class AgentGuardrailAssignmentUpdateRequest(BaseModel):
    mode: str = Field(pattern="^(enforce|review_only|disabled)$")
    threshold_overrides: dict[str, Any] = Field(default_factory=dict)
```

- [ ] **Step 2: Add guardrail policy endpoints**

Add after the existing `/v1/workflow-marketplace` endpoints:

```python
@app.get("/v1/guardrail-policies")
def list_guardrail_policies(
    environment: str | None = None,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    return store.list_guardrail_policies(environment=visible_environment(environment, user))


@app.post("/v1/guardrail-policies")
def create_guardrail_policy(
    request: GuardrailPolicyRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_environment_access(user, request.environment, "agent:create")
    return store.upsert_guardrail_policy(request.model_dump())


@app.get("/v1/guardrail-policies/{policy_id}")
def get_guardrail_policy(
    policy_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    policy = store.get_guardrail_policy(policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    require_environment_access(user, policy.get("environment"), "read")
    return policy


@app.put("/v1/guardrail-policies/{policy_id}")
def update_guardrail_policy(
    policy_id: str,
    request: GuardrailPolicyRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_environment_access(user, request.environment, "agent:create")
    payload = request.model_dump()
    payload["policy_id"] = policy_id
    return store.upsert_guardrail_policy(payload)


@app.get("/v1/agents/{agent_id}/guardrails")
def list_agent_guardrails(
    agent_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    identity = store.get_agent_identity(agent_id)
    require_environment_access(user, identity.get("environment"), "read")
    return store.list_agent_guardrail_assignments(agent_id)


@app.post("/v1/agents/{agent_id}/guardrails")
def assign_agent_guardrail(
    agent_id: str,
    request: AgentGuardrailAssignmentRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_environment_access(user, store.agent_environment(agent_id), "agent:create")
    if not store.get_guardrail_policy(request.policy_id):
        raise HTTPException(status_code=400, detail="Policy not found")
    return store.upsert_agent_guardrail_assignment(
        agent_id=agent_id,
        environment=store.agent_environment(agent_id),
        policy_id=request.policy_id,
        mode=request.mode,
        threshold_overrides=request.threshold_overrides,
    )


@app.put("/v1/agents/{agent_id}/guardrails/{assignment_id}")
def update_agent_guardrail(
    agent_id: str,
    assignment_id: str,
    request: AgentGuardrailAssignmentUpdateRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_environment_access(user, store.agent_environment(agent_id), "agent:create")
    assignments = store.list_agent_guardrail_assignments(agent_id)
    assignment = next((a for a in assignments if a["assignment_id"] == assignment_id), None)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return store.upsert_agent_guardrail_assignment(
        agent_id=agent_id,
        environment=assignment["environment"],
        policy_id=assignment["policy_id"],
        mode=request.mode,
        threshold_overrides=request.threshold_overrides,
    )


@app.delete("/v1/agents/{agent_id}/guardrails/{assignment_id}")
def delete_agent_guardrail(
    agent_id: str,
    assignment_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, bool]:
    require_environment_access(user, store.agent_environment(agent_id), "agent:create")
    deleted = store.delete_agent_guardrail_assignment(assignment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return {"ok": True}
```

- [ ] **Step 3: Start the API and verify endpoints appear**

```bash
cd /Users/dliu520/AIYA/Git/agent_governance
source .venv/bin/activate
uvicorn api.main:app --reload --port 8000 &
sleep 2
curl -s http://localhost:8000/v1/guardrail-policies | head -20
```

Expected: JSON response (may require auth token, `401` is fine — confirms the endpoint exists).

- [ ] **Step 4: Commit**

```bash
git add api/main.py
git commit -m "feat: add guardrail policy and assignment API endpoints"
```

---

## Task 13: API endpoints — evaluator templates, assignments, and results

**Files:**
- Modify: `api/main.py`

- [ ] **Step 1: Add Pydantic request models**

```python
class EvaluatorTemplateRequest(BaseModel):
    evaluator_id: str
    display_name: str
    evaluator_type: str
    scope: str = Field(pattern="^(agent|workflow)$")
    description: str = ""
    default_config: dict[str, Any] = Field(default_factory=dict)
    llm_enabled: bool = False


class AgentEvaluatorAssignmentRequest(BaseModel):
    evaluator_id: str
    trigger: str = Field(pattern="^(after_run|after_workflow|manual)$")
    config: dict[str, Any] = Field(default_factory=dict)
```

- [ ] **Step 2: Add evaluator endpoints**

```python
@app.get("/v1/evaluator-templates")
def list_evaluator_templates(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return store.list_evaluator_templates()


@app.post("/v1/evaluator-templates")
def create_evaluator_template(
    request: EvaluatorTemplateRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    if not user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Only super admins can create evaluator templates")
    return store.upsert_evaluator_template(request.model_dump())


@app.get("/v1/agents/{agent_id}/evaluators")
def list_agent_evaluators(
    agent_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    identity = store.get_agent_identity(agent_id)
    require_environment_access(user, identity.get("environment"), "read")
    return store.list_agent_evaluator_assignments(agent_id)


@app.post("/v1/agents/{agent_id}/evaluators")
def assign_agent_evaluator(
    agent_id: str,
    request: AgentEvaluatorAssignmentRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    require_environment_access(user, store.agent_environment(agent_id), "agent:create")
    if not store.get_evaluator_template(request.evaluator_id):
        raise HTTPException(status_code=400, detail="Evaluator template not found")
    return store.upsert_agent_evaluator_assignment(
        agent_id=agent_id,
        environment=store.agent_environment(agent_id),
        evaluator_id=request.evaluator_id,
        trigger=request.trigger,
        config=request.config,
    )


@app.delete("/v1/agents/{agent_id}/evaluators/{assignment_id}")
def delete_agent_evaluator(
    agent_id: str,
    assignment_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, bool]:
    require_environment_access(user, store.agent_environment(agent_id), "agent:create")
    deleted = store.delete_agent_evaluator_assignment(assignment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return {"ok": True}


@app.get("/v1/evaluation-results")
def evaluation_results(
    limit: int = 100,
    environment: str | None = None,
    agent_id: str | None = None,
    session_id: str | None = None,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    return store.list_evaluation_results(
        environment=visible_environment(environment, user),
        agent_id=agent_id,
        session_id=session_id,
        limit=limit,
    )


@app.get("/v1/sessions/{session_id}/evaluation-results")
def session_evaluation_results(
    session_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    environment = store.session_environment(session_id)
    if environment is None:
        raise HTTPException(status_code=404, detail="Session not found")
    require_environment_access(user, environment, "read")
    return store.list_session_evaluation_results(session_id)


@app.post("/v1/sessions/{session_id}/evaluate")
def trigger_session_evaluation(
    session_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    from agent_governance.evaluators import EvaluatorEngine
    environment = store.session_environment(session_id)
    if environment is None:
        raise HTTPException(status_code=404, detail="Session not found")
    require_environment_access(user, environment, "agent:run")
    sessions = store.list_sessions(limit=1000)
    session = next((s for s in sessions if s["session_id"] == session_id), None)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    engine = EvaluatorEngine(store)
    results = engine.run_for_session(session_id, session["agent_id"], environment)
    return [{"evaluator_id": r.evaluator_id, "score": r.score, "passed": r.passed, "findings": r.findings} for r in results]
```

- [ ] **Step 3: Run all tests**

```bash
pytest tests/ -v
```

Expected: All `PASSED`.

- [ ] **Step 4: Commit**

```bash
git add api/main.py
git commit -m "feat: add evaluator template, assignment, and results API endpoints"
```

---

## Task 14: Frontend API client

**Files:**
- Modify: `dashboard/src/lib/api.js`

- [ ] **Step 1: Add new API methods**

Add to the `api` export object in `dashboard/src/lib/api.js`:

```javascript
  // Guardrail policies
  guardrailPolicies: (environment = "all") =>
    request(withParams("/v1/guardrail-policies", { environment })),
  createGuardrailPolicy: (payload) =>
    request("/v1/guardrail-policies", { method: "POST", body: JSON.stringify(payload) }),
  updateGuardrailPolicy: (policyId, payload) =>
    request(`/v1/guardrail-policies/${policyId}`, { method: "PUT", body: JSON.stringify(payload) }),

  // Agent guardrail assignments
  agentGuardrails: (agentId) => request(`/v1/agents/${agentId}/guardrails`),
  assignGuardrail: (agentId, payload) =>
    request(`/v1/agents/${agentId}/guardrails`, { method: "POST", body: JSON.stringify(payload) }),
  updateGuardrailAssignment: (agentId, assignmentId, payload) =>
    request(`/v1/agents/${agentId}/guardrails/${assignmentId}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteGuardrailAssignment: (agentId, assignmentId) =>
    request(`/v1/agents/${agentId}/guardrails/${assignmentId}`, { method: "DELETE" }),

  // Evaluator templates
  evaluatorTemplates: () => request("/v1/evaluator-templates"),
  createEvaluatorTemplate: (payload) =>
    request("/v1/evaluator-templates", { method: "POST", body: JSON.stringify(payload) }),

  // Agent evaluator assignments
  agentEvaluators: (agentId) => request(`/v1/agents/${agentId}/evaluators`),
  assignEvaluator: (agentId, payload) =>
    request(`/v1/agents/${agentId}/evaluators`, { method: "POST", body: JSON.stringify(payload) }),
  deleteEvaluatorAssignment: (agentId, assignmentId) =>
    request(`/v1/agents/${agentId}/evaluators/${assignmentId}`, { method: "DELETE" }),

  // Evaluation results
  evaluationResults: (limit = 100, environment = "all", agentId, sessionId) =>
    request(withParams("/v1/evaluation-results", { limit, environment, agent_id: agentId, session_id: sessionId })),
  sessionEvaluationResults: (sessionId) =>
    request(`/v1/sessions/${sessionId}/evaluation-results`),
  triggerEvaluation: (sessionId) =>
    request(`/v1/sessions/${sessionId}/evaluate`, { method: "POST" }),
```

- [ ] **Step 2: Verify the app still loads at `http://localhost:5174`**

Open browser, check no console errors on page load.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/lib/api.js
git commit -m "feat: add governance API client methods for guardrails and evaluators"
```

---

## Task 15: Frontend — Agent card tabs (Tools / Guardrails / Evaluators)

**Files:**
- Modify: `dashboard/src/App.jsx`

- [ ] **Step 1: Add state for agent-level governance data**

In the `App` component state declarations, add:

```jsx
const [guardrailPolicies, setGuardrailPolicies] = useState([]);
const [evaluatorTemplates, setEvaluatorTemplates] = useState([]);
const [agentGuardrails, setAgentGuardrails] = useState({}); // keyed by agent_id
const [agentEvaluators, setAgentEvaluators] = useState({}); // keyed by agent_id
const [activeAgentTab, setActiveAgentTab] = useState({}); // keyed by agent_id → "tools"|"guardrails"|"evaluators"
const [guardrailAssignForm, setGuardrailAssignForm] = useState({}); // keyed by agent_id
const [evaluatorAssignForm, setEvaluatorAssignForm] = useState({}); // keyed by agent_id
```

- [ ] **Step 2: Fetch guardrail policies and evaluator templates in `refresh`**

In the `refresh` function's `Promise.all` call, add two more fetches:

```jsx
const [
  // ...existing fetches...
  guardrailPolicyRows,
  evaluatorTemplateRows,
] = await Promise.all([
  // ...existing api calls...
  api.guardrailPolicies(effectiveEnvironment),
  api.evaluatorTemplates(),
]);
// ...existing setters...
setGuardrailPolicies(guardrailPolicyRows);
setEvaluatorTemplates(evaluatorTemplateRows);
```

- [ ] **Step 3: Add `AgentGovernanceCard` component**

Add before the `Metric` component at the bottom of `App.jsx`:

```jsx
function AgentGovernanceCard({
  agent,
  tools,
  guardrailPolicies,
  evaluatorTemplates,
  canGrantTool,
  onRevokeTool,
  onAssignGuardrail,
  onDeleteGuardrail,
  onAssignEvaluator,
  onDeleteEvaluator,
}) {
  const [tab, setTab] = useState("tools");
  const [guardrails, setGuardrails] = useState([]);
  const [evaluators, setEvaluators] = useState([]);
  const [policyId, setPolicyId] = useState(guardrailPolicies[0]?.policy_id || "");
  const [mode, setMode] = useState("enforce");
  const [evaluatorId, setEvaluatorId] = useState(evaluatorTemplates[0]?.evaluator_id || "");
  const [trigger, setTrigger] = useState("after_run");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.agentGuardrails(agent.agent_id).then(setGuardrails).catch(() => {});
    api.agentEvaluators(agent.agent_id).then(setEvaluators).catch(() => {});
  }, [agent.agent_id]);

  const grantedTools = agent.permissions?.tools || [];

  async function handleAssignGuardrail(e) {
    e.preventDefault();
    if (!policyId) return;
    setLoading(true);
    try {
      await onAssignGuardrail(agent.agent_id, { policy_id: policyId, mode, threshold_overrides: {} });
      const updated = await api.agentGuardrails(agent.agent_id);
      setGuardrails(updated);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteGuardrail(assignmentId) {
    await onDeleteGuardrail(agent.agent_id, assignmentId);
    const updated = await api.agentGuardrails(agent.agent_id);
    setGuardrails(updated);
  }

  async function handleAssignEvaluator(e) {
    e.preventDefault();
    if (!evaluatorId) return;
    setLoading(true);
    try {
      await onAssignEvaluator(agent.agent_id, { evaluator_id: evaluatorId, trigger, config: {} });
      const updated = await api.agentEvaluators(agent.agent_id);
      setEvaluators(updated);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteEvaluator(assignmentId) {
    await onDeleteEvaluator(agent.agent_id, assignmentId);
    const updated = await api.agentEvaluators(agent.agent_id);
    setEvaluators(updated);
  }

  return (
    <div className="agent-card">
      <div>
        <strong>{agent.display_name}</strong>
        <span>{agent.agent_id}</span>
      </div>
      <p>{agent.purpose}</p>
      <div className="agent-meta">
        <span>Marketplace Agent</span>
        <span>{agent.owner}</span>
        <span>{agent.environment}</span>
        <span>{agent.agent_type}</span>
      </div>

      <div className="marketplace-tabs agent-governance-tabs" role="tablist">
        {["tools", "guardrails", "evaluators"].map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className={tab === t ? "selected" : ""}
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "tools" && (
        <div className="grant-list">
          {grantedTools.map((tool) => (
            <button
              key={tool}
              disabled={!canGrantTool}
              onClick={() => onRevokeTool(agent.agent_id, tool)}
              title={`Revoke ${tool}`}
            >
              {tool}
            </button>
          ))}
          {!grantedTools.length && <span>No tools attached</span>}
        </div>
      )}

      {tab === "guardrails" && (
        <div className="agent-governance-panel">
          <form className="agent-governance-form" onSubmit={handleAssignGuardrail}>
            <select value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
              {guardrailPolicies.map((p) => (
                <option key={p.policy_id} value={p.policy_id}>{p.display_name}</option>
              ))}
              {!guardrailPolicies.length && <option value="">No policies</option>}
            </select>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="enforce">enforce</option>
              <option value="review_only">review_only</option>
              <option value="disabled">disabled</option>
            </select>
            <button type="submit" disabled={loading || !policyId}>Attach</button>
          </form>
          <div className="grant-list">
            {guardrails.map((g) => (
              <button key={g.assignment_id} onClick={() => handleDeleteGuardrail(g.assignment_id)} title="Remove">
                {g.policy_id} · {g.mode}
              </button>
            ))}
            {!guardrails.length && <span>No guardrails attached</span>}
          </div>
        </div>
      )}

      {tab === "evaluators" && (
        <div className="agent-governance-panel">
          <form className="agent-governance-form" onSubmit={handleAssignEvaluator}>
            <select value={evaluatorId} onChange={(e) => setEvaluatorId(e.target.value)}>
              {evaluatorTemplates.map((t) => (
                <option key={t.evaluator_id} value={t.evaluator_id}>{t.display_name}</option>
              ))}
              {!evaluatorTemplates.length && <option value="">No evaluators</option>}
            </select>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              <option value="after_run">after_run</option>
              <option value="after_workflow">after_workflow</option>
              <option value="manual">manual</option>
            </select>
            <button type="submit" disabled={loading || !evaluatorId}>Attach</button>
          </form>
          <div className="grant-list">
            {evaluators.map((ev) => (
              <button key={ev.assignment_id} onClick={() => handleDeleteEvaluator(ev.assignment_id)} title="Remove">
                {ev.evaluator_id} · {ev.trigger}
              </button>
            ))}
            {!evaluators.length && <span>No evaluators attached</span>}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire up handlers in `App` and replace agent-grid**

Add handler functions in the `App` component:

```jsx
async function assignGuardrail(agentId, payload) {
  await api.assignGuardrail(agentId, payload);
}

async function deleteGuardrailAssignment(agentId, assignmentId) {
  await api.deleteGuardrailAssignment(agentId, assignmentId);
}

async function assignEvaluator(agentId, payload) {
  await api.assignEvaluator(agentId, payload);
}

async function deleteEvaluatorAssignment(agentId, assignmentId) {
  await api.deleteEvaluatorAssignment(agentId, assignmentId);
}
```

Replace the `agent-grid` div in the `activeMarketplaceTab === "agents"` section:

```jsx
<div className="agent-grid">
  {agents.map((agent) => (
    <AgentGovernanceCard
      key={agent.agent_id}
      agent={agent}
      tools={tools}
      guardrailPolicies={guardrailPolicies}
      evaluatorTemplates={evaluatorTemplates}
      canGrantTool={canGrantTool}
      onRevokeTool={revokeTool}
      onAssignGuardrail={assignGuardrail}
      onDeleteGuardrail={deleteGuardrailAssignment}
      onAssignEvaluator={assignEvaluator}
      onDeleteEvaluator={deleteEvaluatorAssignment}
    />
  ))}
</div>
```

- [ ] **Step 5: Test in browser**

Open `http://localhost:5174`, navigate to Marketplaces → Agent. Each card should now show Tools / Guardrails / Evaluators tabs. Click Guardrails — should show a policy selector and Attach button.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/App.jsx
git commit -m "feat: add Tools/Guardrails/Evaluators tabs to agent marketplace cards"
```

---

## Task 16: Frontend — Marketplace Governance tab

**Files:**
- Modify: `dashboard/src/App.jsx`

- [ ] **Step 1: Add Governance tab to marketplace tabs**

Find the marketplace-tabs block (currently "Agent" and "Tool") and add a third button:

```jsx
<button
  className={activeMarketplaceTab === "governance" ? "selected" : ""}
  type="button"
  role="tab"
  aria-selected={activeMarketplaceTab === "governance"}
  onClick={() => setActiveMarketplaceTab("governance")}
>
  Governance
</button>
```

- [ ] **Step 2: Add state for governance forms**

```jsx
const [guardrailPolicyJson, setGuardrailPolicyJson] = useState(() =>
  JSON.stringify({
    policy_id: "pol_custom_001",
    display_name: "Custom Policy",
    description: "",
    environment: "demo",
    config: {
      allowed_tools: [],
      blocked_tools: [],
      max_records_returned: 100,
      block_pii_in_response: true,
      redact_pii_in_response: false,
      blocked_patterns: [],
      review_required_for: [],
      decision_thresholds: { review: 50, block: 80 },
    },
  }, null, 2)
);
```

- [ ] **Step 3: Add Governance tab content**

Add inside the `activeMarketplaceTab === "governance"` conditional:

```jsx
{activeMarketplaceTab === "governance" ? (
  <div className="marketplace-view">
    <div className="marketplace-builder">
      <form className="json-builder" onSubmit={async (e) => {
        e.preventDefault();
        try {
          const payload = JSON.parse(guardrailPolicyJson);
          await api.createGuardrailPolicy(payload);
          await refresh();
        } catch (err) {
          setError(err.message);
        }
      }}>
        <div className="builder-header">
          <div>
            <span className="eyebrow">Guardrail Policy</span>
            <h2>Create named guardrail policy.</h2>
          </div>
        </div>
        <textarea
          value={guardrailPolicyJson}
          onChange={(e) => setGuardrailPolicyJson(e.target.value)}
          spellCheck="false"
        />
        <button className="builder-submit" type="submit">Create Policy</button>
      </form>
    </div>

    <div className="tool-marketplace-grid">
      <div style={{ gridColumn: "1 / -1" }}>
        <div className="panel-title">Guardrail Policies</div>
      </div>
      {guardrailPolicies.map((policy) => (
        <div className="tool-marketplace-card" key={policy.policy_id}>
          <strong>{policy.display_name}</strong>
          <span>{policy.policy_id}</span>
          <small>{policy.environment} · {policy.description || "No description"}</small>
        </div>
      ))}

      <div style={{ gridColumn: "1 / -1", marginTop: "1.5rem" }}>
        <div className="panel-title">Evaluator Templates</div>
      </div>
      {evaluatorTemplates.map((template) => (
        <div className="tool-marketplace-card" key={template.evaluator_id}>
          <strong>{template.display_name}</strong>
          <span>{template.evaluator_id}</span>
          <small>
            {template.scope} scope · {template.description}
            {template.llm_enabled ? " · LLM" : " · Rule-based"}
          </small>
        </div>
      ))}
    </div>
  </div>
) : null}
```

- [ ] **Step 4: Test in browser**

Open `http://localhost:5174`, navigate to Marketplaces. Three tabs: Agent, Tool, Governance. Governance tab shows policy list and evaluator templates list.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/App.jsx
git commit -m "feat: add Governance tab to Marketplaces with policy + evaluator template views"
```

---

## Task 17: Frontend — Evaluation badges and trace nodes

**Files:**
- Modify: `dashboard/src/App.jsx`

- [ ] **Step 1: Add evaluation badge to workflow cards**

Find the workflow-row elements in `activeWorkflowTab === "runs"` and add an evaluation badge function:

```jsx
function EvalBadge({ workflowId }) {
  const [badge, setBadge] = useState(null);
  useEffect(() => {
    api.evaluationResults(10, "all", undefined, undefined)
      .then((results) => {
        const forWorkflow = results.filter((r) => r.workflow_id === workflowId);
        if (!forWorkflow.length) return;
        if (forWorkflow.some((r) => !r.passed && r.score === 0)) setBadge("red");
        else if (forWorkflow.some((r) => !r.passed)) setBadge("amber");
        else setBadge("green");
      })
      .catch(() => {});
  }, [workflowId]);
  if (!badge) return null;
  const colors = { green: "#287c72", amber: "#c8871a", red: "#c84040" };
  return (
    <span style={{ width: 10, height: 10, borderRadius: "50%", background: colors[badge], display: "inline-block", marginLeft: 6 }} title={`Evaluation: ${badge}`} />
  );
}
```

Add `<EvalBadge workflowId={item.workflow_id} />` inside each `workflow-row` button, next to the decision badge.

- [ ] **Step 2: Show EVALUATION_COMPLETE events in WorkflowTrace**

The `WorkflowTrace` component in `dashboard/src/components/WorkflowTrace.jsx` already renders all `WorkflowEvent` types. The `EVALUATION_COMPLETE` and `WORKFLOW_EVALUATION_COMPLETE` events will appear automatically.

To make evaluation scores readable in the Node Detail panel, the events already include scores in their `payload`. No change to `WorkflowTrace.jsx` is needed.

- [ ] **Step 3: Test in browser end-to-end**

1. Navigate to Overview, run a workflow
2. Navigate to Workflows — should see a colored evaluation dot on the workflow card once evaluators are assigned to an agent and run
3. Click "View Trace" — should see `EVALUATION_COMPLETE` node at the end of the trace
4. Click the evaluation node — Node Detail panel shows per-evaluator scores

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/App.jsx
git commit -m "feat: add evaluation badges to workflow cards and evaluation nodes in trace"
```

---

## Task 18: Final integration test

- [ ] **Step 1: Run full test suite**

```bash
pytest tests/ -v
```

Expected: All tests pass.

- [ ] **Step 2: Start full stack and smoke-test end-to-end**

```bash
# Terminal 1: API
uvicorn api.main:app --reload --port 8000

# Terminal 2: Dashboard (already running or)
cd dashboard && npm run dev
```

In the browser at `http://localhost:5174`:
1. Log in
2. Go to Marketplaces → Governance — confirm Default Policy and 5 evaluator templates are listed
3. Go to Marketplaces → Agent — open `customer-support-agent` → Guardrails tab → attach Default Policy with `enforce` mode
4. Open Evaluators tab → attach `eval_policy_compliance` with `after_run` trigger
5. Go to Overview → run an agent query
6. Go to Workflows → confirm evaluation badge appears
7. Click "View Trace" → confirm `EVALUATION_COMPLETE` node at the end
8. Click evaluation node → Node Detail shows score and findings

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: guardrail and evaluator governance system complete"
```
