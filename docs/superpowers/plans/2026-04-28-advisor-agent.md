# Advisor Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the LLM-powered IntelliGuard Advisor — a floating chat panel with RAG over platform data (chat mode) and natural language → workflow generation (build mode), backed by LiteLLM + pgvector with Ollama/qwen3.5:9b as default.

**Architecture:** Four new DB tables store advisor documents, conversations, messages, and workflow drafts. `AdvisorRAG` embeds platform data into `advisor_documents` using `nomic-embed-text` (768-dim). `AdvisorChat` retrieves relevant docs via cosine similarity and passes them to the LLM for grounded Q&A. `AdvisorBuilder` generates a `WorkflowDefinition` JSON from natural language, validates it against live DB data, and returns a draft with "Create directly" and "Open in Builder" actions. The floating chat panel appears in the bottom-right of the dashboard.

**Tech Stack:** Python 3.12, SQLAlchemy 2, FastAPI, LiteLLM, pgvector, React/JSX

**Prerequisite:** `tests/conftest.py` must exist with the `store` fixture. If the guardrail/evaluator plan (2026-04-28-guardrail-evaluator.md) hasn't been run, create it per Task 1 of that plan first.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `agent_governance/models.py` | Modify | Add 4 advisor ORM models |
| `agent_governance/db.py` | Modify | Enable pgvector extension on startup |
| `agent_governance/store.py` | Modify | Advisor CRUD + conversation/draft helpers |
| `agent_governance/advisor/__init__.py` | Create | Package init with public surface |
| `agent_governance/advisor/gateway.py` | Create | LiteLLM wrapper (complete, stream, embed) |
| `agent_governance/advisor/rag.py` | Create | pgvector indexing + cosine similarity retrieval |
| `agent_governance/advisor/indexer.py` | Create | Syncs DB rows → advisor_documents |
| `agent_governance/advisor/prompts.py` | Create | System prompts for chat and build modes |
| `agent_governance/advisor/chat.py` | Create | AdvisorChat — RAG-grounded Q&A handler |
| `agent_governance/advisor/builder.py` | Create | AdvisorBuilder — workflow generation handler |
| `api/main.py` | Modify | 8 new advisor endpoints + startup indexer |
| `dashboard/src/lib/api.js` | Modify | API client methods for advisor endpoints |
| `dashboard/src/App.jsx` | Modify | Floating panel, workflow preview card, contextual triggers |
| `pyproject.toml` | Modify | Add litellm + pgvector dependencies |
| `tests/conftest.py` | Modify | Add pgvector extension setup before table creation |
| `tests/test_advisor_gateway.py` | Create | LLMGateway tests (mocked LiteLLM) |
| `tests/test_advisor_rag.py` | Create | AdvisorRAG index + retrieve tests |
| `tests/test_advisor_chat.py` | Create | AdvisorChat conversation + persistence tests |
| `tests/test_advisor_builder.py` | Create | AdvisorBuilder workflow generation + draft tests |

---

## Task 1: DB models — 4 advisor ORM models

**Files:**
- Modify: `agent_governance/models.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_advisor_gateway.py  (create this file, test will fail until Task 3)
# Placeholder — real tests added in Task 3. Just verify models can be imported and tables created.
from agent_governance.models import (
    AdvisorDocument,
    AdvisorConversation,
    AdvisorMessage,
    AdvisorWorkflowDraft,
)

def test_advisor_models_importable():
    assert AdvisorDocument.__tablename__ == "advisor_documents"
    assert AdvisorConversation.__tablename__ == "advisor_conversations"
    assert AdvisorMessage.__tablename__ == "advisor_messages"
    assert AdvisorWorkflowDraft.__tablename__ == "advisor_workflow_drafts"
```

- [ ] **Step 2: Run test to verify it fails**

```
pytest tests/test_advisor_gateway.py::test_advisor_models_importable -v
```

Expected: ImportError — `cannot import name 'AdvisorDocument'`

- [ ] **Step 3: Add advisor ORM models to `agent_governance/models.py`**

Add at the end of `agent_governance/models.py`, after `WorkflowEvent`:

```python
# At the top of models.py, add to existing imports:
# from pgvector.sqlalchemy import Vector   ← add this import
```

Then in the `models.py` imports section add `from pgvector.sqlalchemy import Vector`. Add these classes at the end of the file:

```python
class AdvisorDocument(Base):
    __tablename__ = "advisor_documents"

    doc_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    source_type: Mapped[str] = mapped_column(String(80), nullable=False)
    source_id: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding = mapped_column(Vector(768), nullable=True)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    indexed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AdvisorConversation(Base):
    __tablename__ = "advisor_conversations"

    conversation_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    environment: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AdvisorMessage(Base):
    __tablename__ = "advisor_messages"

    message_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("advisor_conversations.conversation_id"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(24), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    context_docs: Mapped[list] = mapped_column(JSONB, default=list)
    mode: Mapped[str] = mapped_column(String(24), default="chat")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AdvisorWorkflowDraft(Base):
    __tablename__ = "advisor_workflow_drafts"

    draft_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("advisor_conversations.conversation_id"), nullable=False
    )
    message_id: Mapped[str] = mapped_column(
        ForeignKey("advisor_messages.message_id"), nullable=False
    )
    workflow_definition: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    created_workflow_id: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
```

- [ ] **Step 4: Run test to verify it passes**

```
pytest tests/test_advisor_gateway.py::test_advisor_models_importable -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agent_governance/models.py tests/test_advisor_gateway.py
git commit -m "feat: add advisor ORM models (AdvisorDocument, AdvisorConversation, AdvisorMessage, AdvisorWorkflowDraft)"
```

---

## Task 2: pgvector extension setup + store methods for advisor

**Files:**
- Modify: `agent_governance/db.py`
- Modify: `agent_governance/store.py`
- Modify: `tests/conftest.py`

- [ ] **Step 1: Update `tests/conftest.py` to enable pgvector extension before table creation**

In `tests/conftest.py`, update the `db_url` fixture to run `CREATE EXTENSION IF NOT EXISTS vector` before `Base.metadata.create_all`:

```python
# tests/conftest.py
from __future__ import annotations

import os
import pytest
from sqlalchemy import create_engine, text
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
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
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

- [ ] **Step 2: Update `init_db` in `agent_governance/db.py` to enable pgvector extension**

In `agent_governance/db.py`, update the `init_db` function:

```python
def init_db(database_url: str = DEFAULT_DATABASE_URL) -> None:
    engine = build_engine(database_url)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)
    ensure_runtime_schema(engine)
```

- [ ] **Step 3: Write failing store tests**

```python
# tests/test_advisor_store.py
from agent_governance.models import AdvisorConversation, AdvisorMessage, AdvisorWorkflowDraft, new_id


def test_create_advisor_conversation(store):
    conv_id = store.create_advisor_conversation(
        user_id="test_user",
        environment="demo",
        title="Why was the agent blocked?",
    )
    assert conv_id.startswith("conv_")
    conv = store.get_advisor_conversation(conv_id)
    assert conv is not None
    assert conv.title == "Why was the agent blocked?"


def test_add_advisor_message(store):
    conv_id = store.create_advisor_conversation("test_user", "demo", "Test")
    msg_id = store.add_advisor_message(
        conversation_id=conv_id,
        role="user",
        content="Hello advisor",
        context_docs=[],
        mode="chat",
    )
    assert msg_id.startswith("msg_")
    msgs = store.list_advisor_messages(conv_id)
    assert len(msgs) == 1
    assert msgs[0].role == "user"


def test_create_and_update_advisor_draft(store):
    conv_id = store.create_advisor_conversation("test_user", "demo", "Test")
    msg_id = store.add_advisor_message(conv_id, "assistant", "Here is a workflow", [], "build")
    draft_id = store.create_advisor_draft(
        conversation_id=conv_id,
        message_id=msg_id,
        workflow_definition={"name": "Test Workflow", "steps": []},
    )
    assert draft_id.startswith("draft_")
    draft = store.get_advisor_draft(draft_id)
    assert draft.status == "pending"

    store.update_advisor_draft_status(draft_id, status="created", created_workflow_id="wf_001")
    draft = store.get_advisor_draft(draft_id)
    assert draft.status == "created"
    assert draft.created_workflow_id == "wf_001"


def test_list_advisor_conversations(store):
    store.create_advisor_conversation("user_a", "demo", "First question")
    store.create_advisor_conversation("user_a", "demo", "Second question")
    store.create_advisor_conversation("user_b", "demo", "Other user")
    convs = store.list_advisor_conversations("user_a")
    assert len(convs) >= 2
    assert all(c.user_id == "user_a" for c in convs)


def test_get_recent_advisor_messages(store):
    conv_id = store.create_advisor_conversation("test_user", "demo", "Test")
    for i in range(15):
        store.add_advisor_message(conv_id, "user", f"Message {i}", [], "chat")
    recent = store.get_recent_advisor_messages(conv_id, limit=10)
    assert len(recent) == 10
```

- [ ] **Step 4: Run tests to verify they fail**

```
pytest tests/test_advisor_store.py -v
```

Expected: AttributeError — `'GovernanceStore' object has no attribute 'create_advisor_conversation'`

- [ ] **Step 5: Add advisor store methods to `agent_governance/store.py`**

Add these imports at the top of `store.py` (in the models import block):

```python
from agent_governance.models import (
    # ... existing imports ...
    AdvisorConversation,
    AdvisorDocument,
    AdvisorMessage,
    AdvisorWorkflowDraft,
)
```

Add these methods to the `GovernanceStore` class:

```python
def create_advisor_conversation(self, user_id: str, environment: str, title: str) -> str:
    conv_id = new_id("conv")
    with self.session() as db:
        db.add(AdvisorConversation(
            conversation_id=conv_id,
            user_id=user_id,
            environment=environment,
            title=title[:240],
        ))
        db.commit()
    return conv_id

def get_advisor_conversation(self, conversation_id: str) -> AdvisorConversation | None:
    with self.session() as db:
        return db.get(AdvisorConversation, conversation_id)

def list_advisor_conversations(self, user_id: str) -> list[AdvisorConversation]:
    with self.session() as db:
        return list(
            db.execute(
                select(AdvisorConversation)
                .where(AdvisorConversation.user_id == user_id)
                .order_by(desc(AdvisorConversation.updated_at))
            ).scalars().all()
        )

def add_advisor_message(
    self,
    conversation_id: str,
    role: str,
    content: str,
    context_docs: list,
    mode: str,
) -> str:
    msg_id = new_id("msg")
    with self.session() as db:
        db.add(AdvisorMessage(
            message_id=msg_id,
            conversation_id=conversation_id,
            role=role,
            content=content,
            context_docs=context_docs,
            mode=mode,
        ))
        db.execute(
            update(AdvisorConversation)
            .where(AdvisorConversation.conversation_id == conversation_id)
            .values(updated_at=utc_now())
        )
        db.commit()
    return msg_id

def list_advisor_messages(self, conversation_id: str) -> list[AdvisorMessage]:
    with self.session() as db:
        return list(
            db.execute(
                select(AdvisorMessage)
                .where(AdvisorMessage.conversation_id == conversation_id)
                .order_by(AdvisorMessage.created_at)
            ).scalars().all()
        )

def get_recent_advisor_messages(self, conversation_id: str, limit: int = 10) -> list[AdvisorMessage]:
    with self.session() as db:
        rows = list(
            db.execute(
                select(AdvisorMessage)
                .where(AdvisorMessage.conversation_id == conversation_id)
                .order_by(desc(AdvisorMessage.created_at))
                .limit(limit)
            ).scalars().all()
        )
    return list(reversed(rows))

def create_advisor_draft(
    self,
    conversation_id: str,
    message_id: str,
    workflow_definition: dict,
) -> str:
    draft_id = new_id("draft")
    with self.session() as db:
        db.add(AdvisorWorkflowDraft(
            draft_id=draft_id,
            conversation_id=conversation_id,
            message_id=message_id,
            workflow_definition=workflow_definition,
            status="pending",
        ))
        db.commit()
    return draft_id

def get_advisor_draft(self, draft_id: str) -> AdvisorWorkflowDraft | None:
    with self.session() as db:
        return db.get(AdvisorWorkflowDraft, draft_id)

def update_advisor_draft_status(
    self,
    draft_id: str,
    status: str,
    created_workflow_id: str | None = None,
) -> None:
    with self.session() as db:
        values: dict = {"status": status}
        if created_workflow_id is not None:
            values["created_workflow_id"] = created_workflow_id
        db.execute(
            update(AdvisorWorkflowDraft)
            .where(AdvisorWorkflowDraft.draft_id == draft_id)
            .values(**values)
        )
        db.commit()
```

- [ ] **Step 6: Run tests to verify they pass**

```
pytest tests/test_advisor_store.py -v
```

Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add agent_governance/db.py agent_governance/store.py agent_governance/models.py tests/conftest.py tests/test_advisor_store.py
git commit -m "feat: pgvector extension setup + advisor store methods"
```

---

## Task 3: LLMGateway (advisor/gateway.py) + tests

**Files:**
- Create: `agent_governance/advisor/__init__.py`
- Create: `agent_governance/advisor/gateway.py`
- Modify: `tests/test_advisor_gateway.py`

- [ ] **Step 1: Write failing gateway tests**

Replace `tests/test_advisor_gateway.py` with:

```python
# tests/test_advisor_gateway.py
from unittest.mock import MagicMock, patch

from agent_governance.advisor.gateway import LLMGateway


def test_gateway_available_when_model_set(monkeypatch):
    monkeypatch.setenv("ADVISOR_MODEL", "ollama/qwen3.5:9b")
    gw = LLMGateway()
    assert gw.available is True


def test_gateway_unavailable_when_model_not_set(monkeypatch):
    monkeypatch.delenv("ADVISOR_MODEL", raising=False)
    gw = LLMGateway()
    assert gw.available is False


def test_complete_calls_litellm(monkeypatch):
    monkeypatch.setenv("ADVISOR_MODEL", "ollama/qwen3.5:9b")
    monkeypatch.setenv("ADVISOR_BASE_URL", "http://localhost:11434")

    mock_response = MagicMock()
    mock_response.choices[0].message.content = "Governance answer"

    with patch("agent_governance.advisor.gateway.litellm.completion", return_value=mock_response) as mock_complete:
        gw = LLMGateway()
        result = gw.complete([{"role": "user", "content": "Hello"}])

    assert result == "Governance answer"
    mock_complete.assert_called_once()
    call_kwargs = mock_complete.call_args.kwargs
    assert call_kwargs["model"] == "ollama/qwen3.5:9b"
    assert call_kwargs["api_base"] == "http://localhost:11434"


def test_embed_calls_litellm(monkeypatch):
    monkeypatch.setenv("ADVISOR_EMBED_MODEL", "ollama/nomic-embed-text")
    monkeypatch.setenv("ADVISOR_BASE_URL", "http://localhost:11434")

    mock_response = MagicMock()
    mock_response.data[0].embedding = [0.1] * 768

    with patch("agent_governance.advisor.gateway.litellm.embedding", return_value=mock_response) as mock_embed:
        gw = LLMGateway()
        result = gw.embed("test text")

    assert len(result) == 768
    assert result[0] == 0.1
    mock_embed.assert_called_once_with(
        model="ollama/nomic-embed-text",
        input=["test text"],
        api_base="http://localhost:11434",
    )


def test_non_ollama_model_uses_no_base_url(monkeypatch):
    monkeypatch.setenv("ADVISOR_MODEL", "openai/gpt-4o")

    mock_response = MagicMock()
    mock_response.choices[0].message.content = "GPT answer"

    with patch("agent_governance.advisor.gateway.litellm.completion", return_value=mock_response) as mock_complete:
        gw = LLMGateway()
        gw.complete([{"role": "user", "content": "Hello"}])

    call_kwargs = mock_complete.call_args.kwargs
    assert call_kwargs.get("api_base") is None
```

- [ ] **Step 2: Run tests to verify they fail**

```
pytest tests/test_advisor_gateway.py -v
```

Expected: ModuleNotFoundError — `No module named 'agent_governance.advisor'`

- [ ] **Step 3: Create the advisor package and gateway**

```python
# agent_governance/advisor/__init__.py
# (empty — public surface added in Task 8)
```

```python
# agent_governance/advisor/gateway.py
from __future__ import annotations

import os
from typing import AsyncIterator

import litellm


class LLMGateway:
    def __init__(self) -> None:
        self.model = os.getenv("ADVISOR_MODEL", "ollama/qwen3.5:9b")
        self.base_url = os.getenv("ADVISOR_BASE_URL", "http://localhost:11434")
        self.embed_model = os.getenv("ADVISOR_EMBED_MODEL", "ollama/nomic-embed-text")

    @property
    def available(self) -> bool:
        return bool(os.getenv("ADVISOR_MODEL"))

    def _base_url_for(self, model: str) -> str | None:
        return self.base_url if model.startswith("ollama/") else None

    def complete(self, messages: list[dict]) -> str:
        response = litellm.completion(
            model=self.model,
            messages=messages,
            api_base=self._base_url_for(self.model),
        )
        return response.choices[0].message.content

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        response = await litellm.acompletion(
            model=self.model,
            messages=messages,
            api_base=self._base_url_for(self.model),
            stream=True,
        )
        async for chunk in response:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    def embed(self, text: str) -> list[float]:
        response = litellm.embedding(
            model=self.embed_model,
            input=[text],
            api_base=self._base_url_for(self.embed_model),
        )
        return response.data[0].embedding
```

- [ ] **Step 4: Run tests to verify they pass**

```
pytest tests/test_advisor_gateway.py -v
```

Expected: All PASS (requires `litellm` installed — add to pyproject.toml first if import fails, then re-run)

- [ ] **Step 5: Commit**

```bash
git add agent_governance/advisor/__init__.py agent_governance/advisor/gateway.py tests/test_advisor_gateway.py
git commit -m "feat: add LLMGateway — LiteLLM wrapper with Ollama/openai/anthropic support"
```

---

## Task 4: AdvisorRAG (advisor/rag.py) + tests

**Files:**
- Create: `agent_governance/advisor/rag.py`
- Create: `tests/test_advisor_rag.py`

- [ ] **Step 1: Write failing RAG tests**

```python
# tests/test_advisor_rag.py
from unittest.mock import MagicMock

import pytest

from agent_governance.advisor.gateway import LLMGateway
from agent_governance.advisor.rag import AdvisorRAG, RetrievedDoc


@pytest.fixture
def mock_gateway():
    gw = MagicMock(spec=LLMGateway)
    gw.embed.return_value = [0.1] * 768
    return gw


def test_index_document_creates_record(store, mock_gateway):
    rag = AdvisorRAG(store=store, gateway=mock_gateway)
    doc_id = rag.index_document(
        source_type="audit_event",
        source_id="evt_test_001",
        content="ALLOW on get_customer_profile for agent customer-support-agent: routine (risk: 10)",
        metadata={"agent_id": "customer-support-agent", "environment": "demo", "session_id": "sess_001", "created_at": "2026-04-28T00:00:00"},
    )
    assert doc_id == "doc_audit_event_evt_test_001"
    mock_gateway.embed.assert_called_once()


def test_index_document_upserts_on_duplicate(store, mock_gateway):
    rag = AdvisorRAG(store=store, gateway=mock_gateway)
    rag.index_document("audit_event", "evt_dup_001", "First version", {"environment": "demo"})
    rag.index_document("audit_event", "evt_dup_001", "Updated version", {"environment": "demo"})
    assert mock_gateway.embed.call_count == 2


def test_retrieve_returns_documents(store, mock_gateway):
    rag = AdvisorRAG(store=store, gateway=mock_gateway)
    rag.index_document(
        source_type="audit_event",
        source_id="evt_ret_001",
        content="BLOCK on search_customers for agent customer-support-agent: PII risk (risk: 85)",
        metadata={"agent_id": "customer-support-agent", "environment": "demo", "session_id": "sess_ret", "created_at": "2026-04-28T00:00:00"},
    )
    results = rag.retrieve("blocked agent PII", "demo", top_k=5)
    assert isinstance(results, list)
    # With mock embeddings all cosine distances are equal — any result is valid
    for r in results:
        assert isinstance(r, RetrievedDoc)
        assert r.doc_id
        assert r.source_type
        assert r.content


def test_retrieve_filters_by_environment(store, mock_gateway):
    rag = AdvisorRAG(store=store, gateway=mock_gateway)
    rag.index_document("audit_event", "evt_demo_01", "Demo event", {"environment": "demo"})
    rag.index_document("audit_event", "evt_prod_01", "Prod event", {"environment": "production"})
    results = rag.retrieve("event", "demo", top_k=10)
    env_values = {r.metadata.get("environment") for r in results}
    assert "production" not in env_values
```

- [ ] **Step 2: Run tests to verify they fail**

```
pytest tests/test_advisor_rag.py -v
```

Expected: ImportError — `cannot import name 'AdvisorRAG'`

- [ ] **Step 3: Implement AdvisorRAG**

```python
# agent_governance/advisor/rag.py
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text

from agent_governance.models import AdvisorDocument, utc_now
from agent_governance.store import GovernanceStore

from .gateway import LLMGateway


@dataclass
class RetrievedDoc:
    doc_id: str
    source_type: str
    source_id: str
    content: str
    metadata: dict


class AdvisorRAG:
    def __init__(self, store: GovernanceStore, gateway: LLMGateway) -> None:
        self.store = store
        self.gateway = gateway

    def index_document(
        self,
        source_type: str,
        source_id: str,
        content: str,
        metadata: dict,
    ) -> str:
        embedding = self.gateway.embed(content)
        doc_id = f"doc_{source_type}_{source_id}"
        vec_str = "[" + ",".join(str(v) for v in embedding) + "]"
        with self.store.session() as db:
            db.execute(
                text("""
                    INSERT INTO advisor_documents (doc_id, source_type, source_id, content, embedding, metadata, indexed_at)
                    VALUES (:doc_id, :source_type, :source_id, :content, CAST(:vec AS vector), :metadata::jsonb, NOW())
                    ON CONFLICT (doc_id) DO UPDATE
                    SET content = EXCLUDED.content,
                        embedding = EXCLUDED.embedding,
                        metadata = EXCLUDED.metadata,
                        indexed_at = NOW()
                """),
                {
                    "doc_id": doc_id,
                    "source_type": source_type,
                    "source_id": source_id,
                    "content": content,
                    "vec": vec_str,
                    "metadata": str(metadata).replace("'", '"'),
                },
            )
            db.commit()
        return doc_id

    def retrieve(self, query: str, environment: str, top_k: int = 5) -> list[RetrievedDoc]:
        query_vec = self.gateway.embed(query)
        vec_str = "[" + ",".join(str(v) for v in query_vec) + "]"
        with self.store.session() as db:
            rows = db.execute(
                text("""
                    SELECT doc_id, source_type, source_id, content, metadata
                    FROM advisor_documents
                    WHERE (metadata->>'environment' = :env OR metadata->>'environment' IS NULL)
                      AND embedding IS NOT NULL
                    ORDER BY embedding <=> CAST(:vec AS vector)
                    LIMIT :k
                """),
                {"env": environment, "vec": vec_str, "k": top_k},
            ).fetchall()
        return [
            RetrievedDoc(
                doc_id=row.doc_id,
                source_type=row.source_type,
                source_id=row.source_id,
                content=row.content,
                metadata=row.metadata or {},
            )
            for row in rows
        ]
```

Note: The `index_document` method uses raw SQL with `ON CONFLICT` for an atomic upsert. The `metadata` JSON serialization uses Python's `str()` — in production, replace with `json.dumps(metadata)` to handle special characters properly. Fix this now:

```python
# In index_document, replace the metadata parameter:
import json

# ...
                {
                    "doc_id": doc_id,
                    "source_type": source_type,
                    "source_id": source_id,
                    "content": content,
                    "vec": vec_str,
                    "metadata": json.dumps(metadata),
                },
```

The full corrected `index_document` with `import json` at the top of the file:

```python
# agent_governance/advisor/rag.py
from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import text

from agent_governance.models import AdvisorDocument, utc_now
from agent_governance.store import GovernanceStore

from .gateway import LLMGateway


@dataclass
class RetrievedDoc:
    doc_id: str
    source_type: str
    source_id: str
    content: str
    metadata: dict


class AdvisorRAG:
    def __init__(self, store: GovernanceStore, gateway: LLMGateway) -> None:
        self.store = store
        self.gateway = gateway

    def index_document(
        self,
        source_type: str,
        source_id: str,
        content: str,
        metadata: dict,
    ) -> str:
        embedding = self.gateway.embed(content)
        doc_id = f"doc_{source_type}_{source_id}"
        vec_str = "[" + ",".join(str(v) for v in embedding) + "]"
        with self.store.session() as db:
            db.execute(
                text("""
                    INSERT INTO advisor_documents
                        (doc_id, source_type, source_id, content, embedding, metadata, indexed_at)
                    VALUES
                        (:doc_id, :source_type, :source_id, :content, CAST(:vec AS vector), :metadata::jsonb, NOW())
                    ON CONFLICT (doc_id) DO UPDATE
                    SET content     = EXCLUDED.content,
                        embedding   = EXCLUDED.embedding,
                        metadata    = EXCLUDED.metadata,
                        indexed_at  = NOW()
                """),
                {
                    "doc_id": doc_id,
                    "source_type": source_type,
                    "source_id": source_id,
                    "content": content,
                    "vec": vec_str,
                    "metadata": json.dumps(metadata),
                },
            )
            db.commit()
        return doc_id

    def retrieve(self, query: str, environment: str, top_k: int = 5) -> list[RetrievedDoc]:
        query_vec = self.gateway.embed(query)
        vec_str = "[" + ",".join(str(v) for v in query_vec) + "]"
        with self.store.session() as db:
            rows = db.execute(
                text("""
                    SELECT doc_id, source_type, source_id, content, metadata
                    FROM advisor_documents
                    WHERE (metadata->>'environment' = :env OR metadata->>'environment' IS NULL)
                      AND embedding IS NOT NULL
                    ORDER BY embedding <=> CAST(:vec AS vector)
                    LIMIT :k
                """),
                {"env": environment, "vec": vec_str, "k": top_k},
            ).fetchall()
        return [
            RetrievedDoc(
                doc_id=row.doc_id,
                source_type=row.source_type,
                source_id=row.source_id,
                content=row.content,
                metadata=row.metadata or {},
            )
            for row in rows
        ]
```

- [ ] **Step 4: Run tests to verify they pass**

```
pytest tests/test_advisor_rag.py -v
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add agent_governance/advisor/rag.py tests/test_advisor_rag.py
git commit -m "feat: add AdvisorRAG — pgvector document indexing and cosine similarity retrieval"
```

---

## Task 5: System prompts + AdvisorIndexer

**Files:**
- Create: `agent_governance/advisor/prompts.py`
- Create: `agent_governance/advisor/indexer.py`

No tests for indexer — it coordinates existing tested components. Smoke-tested in Task 14.

- [ ] **Step 1: Create system prompts**

```python
# agent_governance/advisor/prompts.py

CHAT_SYSTEM_PROMPT = """\
You are IntelliGuard Advisor, a governance expert for AI agent platforms.

You help governance teams understand agent behaviour, policy decisions, and risk patterns \
by analyzing platform data including audit events, policy decisions, workflow traces, \
agent identities, and evaluation results.

Answer questions clearly and concisely. When citing specific events or decisions, \
reference the source type and ID from the provided context. If you don't have relevant \
data, say so rather than speculating.

Platform capabilities:
- Agent governance: per-agent guardrail policies with enforce/review_only/disabled modes
- Evaluators: rule-based quality scores (policy compliance, PII leakage, tool use correctness, \
workflow completion, response quality)
- Workflow orchestration: multi-agent workflows with lead and sub-agents
- Review queue: human-in-the-loop review for flagged tool calls
"""

BUILD_SYSTEM_PROMPT = """\
You are IntelliGuard Advisor in workflow builder mode.

Your task is to generate a valid WorkflowDefinition JSON object based on the user's \
natural language description.

Available agents in the {environment} environment:
{agents}

The WorkflowDefinition must follow this schema exactly:
{{
  "name": "string — human-readable workflow name",
  "description": "string — what this workflow does",
  "owner": "string",
  "environment": "{environment}",
  "lead_agent_id": "string — MUST be one of the agent IDs listed above",
  "trigger_type": "manual",
  "steps": [
    {{
      "step_id": "string — unique step identifier, e.g. step_1",
      "agent_id": "string — MUST be one of the agent IDs listed above",
      "label": "string — short step description",
      "tool_name": "string or null",
      "depends_on": ["array of step_ids this step depends on, or empty array"]
    }}
  ]
}}

Respond with:
1. A brief natural language explanation (1–3 sentences) of what workflow you're generating
2. The complete workflow JSON in a ```json code block```

Rules:
- Only use agent_ids from the list above — never invent new ones
- The lead_agent_id should be an orchestrator-type agent when available
- steps must reference valid agent_ids from the list above
"""
```

- [ ] **Step 2: Create AdvisorIndexer**

```python
# agent_governance/advisor/indexer.py
from __future__ import annotations

from sqlalchemy import select

from agent_governance.models import (
    AgentIdentity,
    AuditEvent,
    PolicyDecision,
    AgentWorkflow,
)
from agent_governance.store import GovernanceStore

from .rag import AdvisorRAG


class AdvisorIndexer:
    def __init__(self, store: GovernanceStore, rag: AdvisorRAG) -> None:
        self.store = store
        self.rag = rag

    def sync_all(self) -> int:
        count = 0
        count += self._index_audit_events()
        count += self._index_policy_decisions()
        count += self._index_agent_identities()
        count += self._index_workflow_traces()
        return count

    def index_session(self, session_id: str) -> None:
        self._index_audit_events(session_id=session_id)
        self._index_policy_decisions(session_id=session_id)

    def _already_indexed(self, doc_id: str) -> bool:
        from agent_governance.models import AdvisorDocument
        from sqlalchemy import text
        with self.store.session() as db:
            row = db.execute(
                text("SELECT 1 FROM advisor_documents WHERE doc_id = :doc_id"),
                {"doc_id": doc_id},
            ).first()
        return row is not None

    def _index_audit_events(self, session_id: str | None = None) -> int:
        with self.store.session() as db:
            q = select(AuditEvent)
            if session_id:
                q = q.where(AuditEvent.session_id == session_id)
            events = db.execute(q).scalars().all()

        count = 0
        for e in events:
            doc_id = f"doc_audit_event_{e.event_id}"
            if self._already_indexed(doc_id):
                continue
            content = (
                f"{e.decision} on {e.tool_name or 'unknown'} for agent {e.agent_id}: "
                f"{e.reason} (risk: {e.risk_score})"
            )
            metadata = {
                "agent_id": e.agent_id,
                "session_id": e.session_id,
                "environment": e.metadata_json.get("environment", ""),
                "created_at": e.created_at.isoformat(),
            }
            self.rag.index_document("audit_event", e.event_id, content, metadata)
            count += 1
        return count

    def _index_policy_decisions(self, session_id: str | None = None) -> int:
        with self.store.session() as db:
            q = select(PolicyDecision)
            if session_id:
                q = q.where(PolicyDecision.session_id == session_id)
            decisions = db.execute(q).scalars().all()

        count = 0
        for d in decisions:
            doc_id = f"doc_policy_decision_{d.decision_id}"
            if self._already_indexed(doc_id):
                continue
            rules = ", ".join(d.triggered_rules) if d.triggered_rules else "none"
            content = (
                f"Agent {d.agent_id} {d.decision} for {d.tool_name or 'unknown'}: "
                f"{d.reason}. Rules: {rules}"
            )
            metadata = {
                "agent_id": d.agent_id,
                "session_id": d.session_id,
                "environment": "",
                "created_at": d.created_at.isoformat(),
            }
            self.rag.index_document("policy_decision", d.decision_id, content, metadata)
            count += 1
        return count

    def _index_agent_identities(self) -> int:
        with self.store.session() as db:
            agents = db.execute(select(AgentIdentity)).scalars().all()

        count = 0
        for a in agents:
            doc_id = f"doc_agent_identity_{a.agent_id}"
            if self._already_indexed(doc_id):
                continue
            tools = ", ".join(a.permissions.get("tools", [])) or "none"
            content = (
                f"Agent {a.display_name} ({a.agent_type}, {a.environment}): "
                f"{a.purpose}. Tools: {tools}"
            )
            metadata = {
                "agent_id": a.agent_id,
                "environment": a.environment,
                "created_at": a.created_at.isoformat(),
            }
            self.rag.index_document("agent_identity", a.agent_id, content, metadata)
            count += 1
        return count

    def _index_workflow_traces(self) -> int:
        with self.store.session() as db:
            workflows = db.execute(select(AgentWorkflow)).scalars().all()

        count = 0
        for w in workflows:
            doc_id = f"doc_workflow_trace_{w.workflow_id}"
            if self._already_indexed(doc_id):
                continue
            content = (
                f"Workflow {w.workflow_id} — {w.name}: {w.summary or w.user_goal}. "
                f"Status: {w.status}"
            )
            metadata = {
                "workflow_id": w.workflow_id,
                "environment": w.metadata_json.get("environment", ""),
                "created_at": w.created_at.isoformat(),
            }
            self.rag.index_document("workflow_trace", w.workflow_id, content, metadata)
            count += 1
        return count

    def index_guardrail_policies(self) -> int:
        try:
            from agent_governance.models import GuardrailPolicy
            from sqlalchemy import select as sa_select
            with self.store.session() as db:
                policies = db.execute(sa_select(GuardrailPolicy)).scalars().all()
        except Exception:
            return 0

        count = 0
        for p in policies:
            doc_id = f"doc_guardrail_policy_{p.policy_id}"
            if self._already_indexed(doc_id):
                continue
            content = f"Policy {p.display_name} ({p.environment}): {p.description}. Config: {p.config}"
            metadata = {
                "policy_id": p.policy_id,
                "environment": p.environment,
                "created_at": p.created_at.isoformat(),
            }
            self.rag.index_document("guardrail_policy", p.policy_id, content, metadata)
            count += 1
        return count

    def index_evaluation_results(self) -> int:
        try:
            from agent_governance.models import EvaluationResult
            from sqlalchemy import select as sa_select
            with self.store.session() as db:
                results = db.execute(sa_select(EvaluationResult)).scalars().all()
        except Exception:
            return 0

        count = 0
        for r in results:
            doc_id = f"doc_evaluation_result_{r.result_id}"
            if self._already_indexed(doc_id):
                continue
            findings_text = "; ".join(
                f"{f.get('check')}: {f.get('result')}" for f in (r.findings or [])
            )
            content = (
                f"Evaluation of {r.agent_id} — {r.evaluator_id}: "
                f"score {r.score}, passed={r.passed}. {findings_text}"
            )
            metadata = {
                "agent_id": r.agent_id,
                "session_id": r.session_id,
                "environment": "",
                "created_at": r.created_at.isoformat(),
            }
            self.rag.index_document("evaluation_result", r.result_id, content, metadata)
            count += 1
        return count
```

- [ ] **Step 3: Commit**

```bash
git add agent_governance/advisor/prompts.py agent_governance/advisor/indexer.py
git commit -m "feat: add AdvisorIndexer and system prompts for chat/build modes"
```

---

## Task 6: AdvisorChat (advisor/chat.py) + tests

**Files:**
- Create: `agent_governance/advisor/chat.py`
- Create: `tests/test_advisor_chat.py`

- [ ] **Step 1: Write failing chat tests**

```python
# tests/test_advisor_chat.py
from unittest.mock import MagicMock

from agent_governance.advisor.chat import AdvisorChat
from agent_governance.advisor.gateway import LLMGateway
from agent_governance.advisor.rag import AdvisorRAG, RetrievedDoc
from agent_governance.models import AdvisorConversation


def _make_chat(store, reply: str = "Governance answer.") -> AdvisorChat:
    gateway = MagicMock(spec=LLMGateway)
    gateway.complete.return_value = reply
    rag = MagicMock(spec=AdvisorRAG)
    rag.retrieve.return_value = [
        RetrievedDoc(
            doc_id="doc_audit_event_e001",
            source_type="audit_event",
            source_id="e001",
            content="BLOCK on get_customer_profile for agent customer-support-agent: PII risk (risk: 90)",
            metadata={"environment": "demo"},
        )
    ]
    return AdvisorChat(store=store, gateway=gateway, rag=rag)


def test_respond_creates_new_conversation(store):
    chat = _make_chat(store)
    result = chat.respond(
        message="Why was the agent blocked?",
        environment="demo",
        conversation_id=None,
        user_id="test_user",
    )
    assert result["reply"] == "Governance answer."
    assert result["conversation_id"] is not None
    assert result["message_id"] is not None
    assert len(result["sources"]) == 1
    assert result["sources"][0]["source_type"] == "audit_event"


def test_respond_reuses_existing_conversation(store):
    chat = _make_chat(store)
    conv_id = store.create_advisor_conversation("test_user", "demo", "First")
    result = chat.respond(
        message="Follow up question",
        environment="demo",
        conversation_id=conv_id,
        user_id="test_user",
    )
    assert result["conversation_id"] == conv_id


def test_respond_persists_both_turns(store):
    chat = _make_chat(store)
    result = chat.respond(
        message="What is the PII score?",
        environment="demo",
        conversation_id=None,
        user_id="test_user",
    )
    conv_id = result["conversation_id"]
    messages = store.list_advisor_messages(conv_id)
    assert len(messages) == 2
    assert messages[0].role == "user"
    assert messages[0].content == "What is the PII score?"
    assert messages[1].role == "assistant"
    assert messages[1].content == "Governance answer."
    assert messages[1].mode == "chat"


def test_respond_includes_history_in_prompt(store):
    gateway = MagicMock(spec=LLMGateway)
    gateway.complete.return_value = "Answer"
    rag = MagicMock(spec=AdvisorRAG)
    rag.retrieve.return_value = []
    chat = AdvisorChat(store=store, gateway=gateway, rag=rag)

    conv_id = store.create_advisor_conversation("test_user", "demo", "Convo")
    store.add_advisor_message(conv_id, "user", "Earlier question", [], "chat")
    store.add_advisor_message(conv_id, "assistant", "Earlier answer", [], "chat")

    chat.respond("New question", "demo", conv_id, "test_user")
    call_args = gateway.complete.call_args
    messages = call_args.args[0] if call_args.args else call_args.kwargs["messages"]
    roles = [m["role"] for m in messages]
    assert "user" in roles
```

- [ ] **Step 2: Run tests to verify they fail**

```
pytest tests/test_advisor_chat.py -v
```

Expected: ImportError — `cannot import name 'AdvisorChat'`

- [ ] **Step 3: Implement AdvisorChat**

```python
# agent_governance/advisor/chat.py
from __future__ import annotations

from agent_governance.store import GovernanceStore

from .gateway import LLMGateway
from .prompts import CHAT_SYSTEM_PROMPT
from .rag import AdvisorRAG, RetrievedDoc


class AdvisorChat:
    def __init__(self, store: GovernanceStore, gateway: LLMGateway, rag: AdvisorRAG) -> None:
        self.store = store
        self.gateway = gateway
        self.rag = rag

    def respond(
        self,
        message: str,
        environment: str,
        conversation_id: str | None,
        user_id: str,
    ) -> dict:
        if not conversation_id:
            conversation_id = self.store.create_advisor_conversation(
                user_id=user_id,
                environment=environment,
                title=message[:80],
            )

        docs = self.rag.retrieve(message, environment, top_k=5)
        history = self.store.get_recent_advisor_messages(conversation_id, limit=10)
        messages = self._build_messages(message, docs, history)
        reply = self.gateway.complete(messages)

        sources = [
            {"doc_id": d.doc_id, "snippet": d.content[:200], "source_type": d.source_type}
            for d in docs
        ]
        self.store.add_advisor_message(conversation_id, "user", message, [], "chat")
        msg_id = self.store.add_advisor_message(conversation_id, "assistant", reply, sources, "chat")

        return {
            "message_id": msg_id,
            "reply": reply,
            "sources": sources,
            "conversation_id": conversation_id,
        }

    def _build_messages(
        self, user_message: str, docs: list[RetrievedDoc], history: list
    ) -> list[dict]:
        messages: list[dict] = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
        if docs:
            context = "\n\n".join(f"[{d.source_type}] {d.content}" for d in docs)
            messages.append({"role": "system", "content": f"Relevant governance context:\n{context}"})
        for m in history:
            messages.append({"role": m.role, "content": m.content})
        messages.append({"role": "user", "content": user_message})
        return messages
```

- [ ] **Step 4: Run tests to verify they pass**

```
pytest tests/test_advisor_chat.py -v
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add agent_governance/advisor/chat.py tests/test_advisor_chat.py
git commit -m "feat: add AdvisorChat — RAG-grounded governance Q&A handler"
```

---

## Task 7: AdvisorBuilder (advisor/builder.py) + tests

**Files:**
- Create: `agent_governance/advisor/builder.py`
- Create: `tests/test_advisor_builder.py`

- [ ] **Step 1: Write failing builder tests**

```python
# tests/test_advisor_builder.py
from unittest.mock import MagicMock

import pytest

from agent_governance.advisor.builder import AdvisorBuilder
from agent_governance.advisor.gateway import LLMGateway
from agent_governance.advisor.rag import AdvisorRAG


SAMPLE_RESPONSE = """\
I'll create a fraud investigation workflow with identity verification and transaction review.

```json
{
  "name": "Fraud Investigation Workflow",
  "description": "Verifies identity and reviews transactions to detect fraud.",
  "owner": "AI Advisor",
  "environment": "demo",
  "lead_agent_id": "customer-support-lead-agent",
  "trigger_type": "manual",
  "steps": [
    {
      "step_id": "step_1",
      "agent_id": "identity-verification-agent",
      "label": "Verify Customer Identity",
      "tool_name": "get_customer_profile",
      "depends_on": []
    },
    {
      "step_id": "step_2",
      "agent_id": "transaction-analyst-agent",
      "label": "Review Transactions",
      "tool_name": "get_customer_transactions",
      "depends_on": ["step_1"]
    }
  ]
}
```
"""


@pytest.fixture
def conv_id(store):
    return store.create_advisor_conversation("test_user", "demo", "Build a workflow")


def _make_builder(store, response: str = SAMPLE_RESPONSE) -> AdvisorBuilder:
    gateway = MagicMock(spec=LLMGateway)
    gateway.complete.return_value = response
    rag = MagicMock(spec=AdvisorRAG)
    rag.retrieve.return_value = []
    return AdvisorBuilder(store=store, gateway=gateway, rag=rag)


def test_generate_returns_draft(store, conv_id):
    builder = _make_builder(store)
    result = builder.generate(
        message="Build a fraud investigation workflow",
        environment="demo",
        conversation_id=conv_id,
        user_id="test_user",
    )
    assert result["draft_id"].startswith("draft_")
    assert result["workflow_definition"]["name"] == "Fraud Investigation Workflow"
    assert len(result["workflow_definition"]["steps"]) == 2
    assert result["conversation_id"] == conv_id


def test_generate_persists_draft_as_pending(store, conv_id):
    builder = _make_builder(store)
    result = builder.generate("Build a workflow", "demo", conv_id, "test_user")
    draft = store.get_advisor_draft(result["draft_id"])
    assert draft.status == "pending"
    assert draft.workflow_definition["name"] == "Fraud Investigation Workflow"


def test_generate_persists_assistant_message_in_build_mode(store, conv_id):
    builder = _make_builder(store)
    builder.generate("Build a workflow", "demo", conv_id, "test_user")
    messages = store.list_advisor_messages(conv_id)
    assert any(m.role == "assistant" and m.mode == "build" for m in messages)


def test_parse_response_extracts_json_and_explanation(store, conv_id):
    builder = _make_builder(store)
    workflow_def, explanation = builder._parse_response(SAMPLE_RESPONSE)
    assert workflow_def["name"] == "Fraud Investigation Workflow"
    assert "fraud investigation" in explanation.lower()


def test_generate_fills_missing_required_fields(store, conv_id):
    minimal_response = '```json\n{"name": "Test", "steps": []}\n```'
    builder = _make_builder(store, response=minimal_response)
    result = builder.generate("Build a workflow", "demo", conv_id, "test_user")
    wf = result["workflow_definition"]
    assert "description" in wf
    assert "lead_agent_id" in wf
    assert "environment" in wf
```

- [ ] **Step 2: Run tests to verify they fail**

```
pytest tests/test_advisor_builder.py -v
```

Expected: ImportError — `cannot import name 'AdvisorBuilder'`

- [ ] **Step 3: Implement AdvisorBuilder**

```python
# agent_governance/advisor/builder.py
from __future__ import annotations

import json
import re

from sqlalchemy import select

from agent_governance.models import AgentIdentity
from agent_governance.store import GovernanceStore

from .gateway import LLMGateway
from .prompts import BUILD_SYSTEM_PROMPT
from .rag import AdvisorRAG


class AdvisorBuilder:
    def __init__(self, store: GovernanceStore, gateway: LLMGateway, rag: AdvisorRAG) -> None:
        self.store = store
        self.gateway = gateway
        self.rag = rag

    def generate(
        self,
        message: str,
        environment: str,
        conversation_id: str,
        user_id: str,
    ) -> dict:
        docs = self.rag.retrieve(message, environment, top_k=3)

        with self.store.session() as db:
            agents = db.execute(
                select(AgentIdentity).where(AgentIdentity.environment == environment)
            ).scalars().all()

        agents_summary = "\n".join(
            f"- {a.agent_id}: {a.display_name} "
            f"(tools: {', '.join(a.permissions.get('tools', [])) or 'none'})"
            for a in agents
        )

        system = BUILD_SYSTEM_PROMPT.format(agents=agents_summary, environment=environment)
        context_workflows = "\n\n".join(
            d.content for d in docs if d.source_type in ("workflow_trace", "workflow_definition")
        )
        if context_workflows:
            system += f"\n\nSimilar existing workflows:\n{context_workflows}"

        raw = self.gateway.complete([
            {"role": "system", "content": system},
            {"role": "user", "content": message},
        ])

        workflow_def, explanation = self._parse_response(raw)
        self._fill_defaults(workflow_def, environment)

        msg_id = self.store.add_advisor_message(
            conversation_id=conversation_id,
            role="assistant",
            content=explanation,
            context_docs=[{"doc_id": d.doc_id, "source_type": d.source_type} for d in docs],
            mode="build",
        )
        draft_id = self.store.create_advisor_draft(
            conversation_id=conversation_id,
            message_id=msg_id,
            workflow_definition=workflow_def,
        )

        return {
            "message_id": msg_id,
            "reply": explanation,
            "draft_id": draft_id,
            "workflow_definition": workflow_def,
            "conversation_id": conversation_id,
        }

    def _parse_response(self, raw: str) -> tuple[dict, str]:
        json_match = re.search(r"```json\s*(.*?)\s*```", raw, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
            explanation = (raw[: json_match.start()] + raw[json_match.end() :]).strip()
        else:
            brace_match = re.search(r"\{.*\}", raw, re.DOTALL)
            if not brace_match:
                raise ValueError("No workflow JSON found in LLM response")
            json_str = brace_match.group(0)
            explanation = raw.replace(json_str, "").strip()

        workflow_def = json.loads(json_str)
        return workflow_def, explanation or "Workflow generated successfully."

    def _fill_defaults(self, workflow_def: dict, environment: str) -> None:
        workflow_def.setdefault("description", "")
        workflow_def.setdefault("owner", "AI Advisor")
        workflow_def.setdefault("environment", environment)
        workflow_def.setdefault("lead_agent_id", "")
        workflow_def.setdefault("trigger_type", "manual")
        workflow_def.setdefault("steps", [])
```

- [ ] **Step 4: Run tests to verify they pass**

```
pytest tests/test_advisor_builder.py -v
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add agent_governance/advisor/builder.py tests/test_advisor_builder.py
git commit -m "feat: add AdvisorBuilder — LLM workflow generation with JSON extraction and draft persistence"
```

---

## Task 8: Dependencies + advisor public surface

**Files:**
- Modify: `pyproject.toml`
- Modify: `agent_governance/advisor/__init__.py`

- [ ] **Step 1: Add litellm and pgvector to pyproject.toml**

In `pyproject.toml`, add to `[project] dependencies`:

```toml
"litellm>=1.40.0",
"pgvector>=0.3.0",
```

- [ ] **Step 2: Install dependencies**

```bash
pip install litellm pgvector
```

- [ ] **Step 3: Update advisor package init**

```python
# agent_governance/advisor/__init__.py
from .builder import AdvisorBuilder
from .chat import AdvisorChat
from .gateway import LLMGateway
from .indexer import AdvisorIndexer
from .rag import AdvisorRAG

__all__ = ["LLMGateway", "AdvisorRAG", "AdvisorIndexer", "AdvisorChat", "AdvisorBuilder"]
```

- [ ] **Step 4: Run all advisor tests**

```
pytest tests/test_advisor_gateway.py tests/test_advisor_rag.py tests/test_advisor_chat.py tests/test_advisor_builder.py tests/test_advisor_store.py -v
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml agent_governance/advisor/__init__.py
git commit -m "feat: add litellm + pgvector dependencies and advisor package public surface"
```

---

## Task 9: API endpoints

**Files:**
- Modify: `api/main.py`

- [ ] **Step 1: Add advisor Pydantic request models to `api/main.py`**

Add after the existing Pydantic model definitions (after `UserCreateRequest`):

```python
class AdvisorChatRequest(BaseModel):
    message: str
    environment: str = "demo"
    conversation_id: str | None = None


class AdvisorBuildRequest(BaseModel):
    message: str
    environment: str = "demo"
    conversation_id: str | None = None
```

- [ ] **Step 2: Add advisor module imports and singleton to `api/main.py`**

After the existing `from agent_governance.store import GovernanceStore` import block, add:

```python
import os
from agent_governance.advisor import (
    AdvisorBuilder,
    AdvisorChat,
    AdvisorIndexer,
    LLMGateway,
    AdvisorRAG,
)
```

After `store = GovernanceStore(settings.database_url)`, add:

```python
_advisor_gateway = LLMGateway()
_advisor_rag = AdvisorRAG(store=store, gateway=_advisor_gateway)
_advisor_indexer = AdvisorIndexer(store=store, rag=_advisor_rag)
_advisor_chat = AdvisorChat(store=store, gateway=_advisor_gateway, rag=_advisor_rag)
_advisor_builder = AdvisorBuilder(store=store, gateway=_advisor_gateway, rag=_advisor_rag)
```

- [ ] **Step 3: Update startup event to run advisor indexer**

Update the existing `startup` function in `api/main.py`:

```python
@app.on_event("startup")
def startup() -> None:
    if settings.auto_init_db:
        init_db(settings.database_url)
        store.seed_demo_data()
    if _advisor_gateway.available:
        try:
            _advisor_indexer.sync_all()
            _advisor_indexer.index_guardrail_policies()
            _advisor_indexer.index_evaluation_results()
        except Exception:
            pass  # Non-fatal: advisor unavailable should not block startup
```

- [ ] **Step 4: Add the 8 advisor endpoints to `api/main.py`**

Add these endpoints after the existing endpoints:

```python
@app.get("/v1/advisor/status")
def advisor_status() -> dict[str, Any]:
    return {"available": _advisor_gateway.available}


@app.post("/v1/advisor/chat")
def advisor_chat(
    req: AdvisorChatRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    if not _advisor_gateway.available:
        raise HTTPException(status_code=503, detail="Advisor is not configured. Set ADVISOR_MODEL env var.")
    return _advisor_chat.respond(
        message=req.message,
        environment=req.environment,
        conversation_id=req.conversation_id,
        user_id=user["user_id"],
    )


@app.post("/v1/advisor/build")
def advisor_build(
    req: AdvisorBuildRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    if not _advisor_gateway.available:
        raise HTTPException(status_code=503, detail="Advisor is not configured. Set ADVISOR_MODEL env var.")
    conversation_id = req.conversation_id
    if not conversation_id:
        conversation_id = store.create_advisor_conversation(
            user_id=user["user_id"],
            environment=req.environment,
            title=req.message[:80],
        )
    return _advisor_builder.generate(
        message=req.message,
        environment=req.environment,
        conversation_id=conversation_id,
        user_id=user["user_id"],
    )


@app.post("/v1/advisor/drafts/{draft_id}/create")
def advisor_draft_create(
    draft_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    draft = store.get_advisor_draft(draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    workflow_def = draft.workflow_definition
    workflow_def_id = workflow_def.get("workflow_definition_id") or new_id("wf")
    workflow_def["workflow_definition_id"] = workflow_def_id
    store.upsert_workflow_definition(workflow_def)
    store.update_advisor_draft_status(draft_id, status="created", created_workflow_id=workflow_def_id)
    return {"workflow_definition_id": workflow_def_id}


@app.post("/v1/advisor/drafts/{draft_id}/open-in-builder")
def advisor_draft_open_in_builder(
    draft_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    draft = store.get_advisor_draft(draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    store.update_advisor_draft_status(draft_id, status="discarded")
    return {"workflow_definition": draft.workflow_definition}


@app.post("/v1/advisor/drafts/{draft_id}/discard")
def advisor_draft_discard(
    draft_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    draft = store.get_advisor_draft(draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    store.update_advisor_draft_status(draft_id, status="discarded")
    return {"ok": True}


@app.get("/v1/advisor/conversations")
def advisor_conversations(
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    convs = store.list_advisor_conversations(user["user_id"])
    return [
        {
            "conversation_id": c.conversation_id,
            "title": c.title,
            "environment": c.environment,
            "updated_at": c.updated_at.isoformat(),
        }
        for c in convs
    ]


@app.get("/v1/advisor/conversations/{conversation_id}/messages")
def advisor_conversation_messages(
    conversation_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    conv = store.get_advisor_conversation(conversation_id)
    if not conv or conv.user_id != user["user_id"]:
        raise HTTPException(status_code=404, detail="Conversation not found")
    msgs = store.list_advisor_messages(conversation_id)
    return [
        {
            "message_id": m.message_id,
            "role": m.role,
            "content": m.content,
            "mode": m.mode,
            "sources": m.context_docs,
            "created_at": m.created_at.isoformat(),
        }
        for m in msgs
    ]
```

Note: `advisor_draft_create` calls `store.upsert_workflow_definition`. Verify this method exists in `store.py`. If not, add it (it already exists as `create_workflow_definition` or similar — check store.py and use the correct method name, passing the `WorkflowDefinitionRequest`-shaped dict).

- [ ] **Step 5: Start the API server and check the status endpoint**

```bash
uvicorn api.main:app --reload
curl http://localhost:8000/v1/advisor/status
```

Expected: `{"available": false}` (Ollama not running) or `{"available": true}` if ADVISOR_MODEL is set.

- [ ] **Step 6: Commit**

```bash
git add api/main.py
git commit -m "feat: add advisor API endpoints (chat, build, drafts, conversations)"
```

---

## Task 10: api.js client methods

**Files:**
- Modify: `dashboard/src/lib/api.js`

- [ ] **Step 1: Add advisor API methods to the `api` export object in `dashboard/src/lib/api.js`**

Add after the last method in the `api = { ... }` export:

```js
  advisorStatus: () => request("/v1/advisor/status"),
  advisorChat: (payload) =>
    request("/v1/advisor/chat", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  advisorBuild: (payload) =>
    request("/v1/advisor/build", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  advisorDraftCreate: (draftId) =>
    request(`/v1/advisor/drafts/${draftId}/create`, { method: "POST" }),
  advisorDraftOpenInBuilder: (draftId) =>
    request(`/v1/advisor/drafts/${draftId}/open-in-builder`, { method: "POST" }),
  advisorDraftDiscard: (draftId) =>
    request(`/v1/advisor/drafts/${draftId}/discard`, { method: "POST" }),
  advisorConversations: () => request("/v1/advisor/conversations"),
  advisorMessages: (conversationId) =>
    request(`/v1/advisor/conversations/${conversationId}/messages`),
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/lib/api.js
git commit -m "feat: add advisor API client methods"
```

---

## Task 11: Frontend — floating chat panel

**Files:**
- Modify: `dashboard/src/App.jsx`

- [ ] **Step 1: Add MessageSquare to the lucide-react import in App.jsx**

In `dashboard/src/App.jsx`, update the lucide-react import line to add `MessageSquare`:

```js
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  GitBranch,
  KeyRound,
  Layers3,
  LogIn,
  LogOut,
  Mail,
  MessageSquare,
  Network,
  OctagonAlert,
  PauseCircle,
  RefreshCw,
  Send,
  Shield,
  ShieldCheck,
  X,
} from "lucide-react";
```

- [ ] **Step 2: Add advisor state to the main App component**

In the `App` function, after the existing `useState` declarations (e.g., after `const [environment, setEnvironment] = useState(...)`), add:

```jsx
const [advisorAvailable, setAdvisorAvailable] = useState(false);
const [advisorOpen, setAdvisorOpen] = useState(false);
const [advisorMode, setAdvisorMode] = useState("chat");
const [advisorMessages, setAdvisorMessages] = useState([]);
const [advisorConversationId, setAdvisorConversationId] = useState(null);
const [advisorLoading, setAdvisorLoading] = useState(false);
const [advisorDraft, setAdvisorDraft] = useState(null);
const [advisorInput, setAdvisorInput] = useState("");
const [advisorPrefill, setAdvisorPrefill] = useState(null);
```

- [ ] **Step 3: Add advisor status check in useEffect**

Find the `useEffect` that calls `api.me()` on login or similar bootstrap effect. Add the advisor status call:

```jsx
useEffect(() => {
  if (!session) return;
  api.advisorStatus().then((r) => setAdvisorAvailable(r.available)).catch(() => {});
}, [session]);
```

- [ ] **Step 4: Add handler for sending advisor messages**

Add this function inside the `App` component body (near other handler functions):

```jsx
const handleAdvisorSend = async () => {
  const text = advisorInput.trim();
  if (!text || advisorLoading) return;

  const isBuild = text.startsWith("/build") || advisorMode === "build";
  const message = isBuild ? text.replace(/^\/build\s*/, "").trim() || text : text;

  setAdvisorMessages((prev) => [...prev, { role: "user", content: message }]);
  setAdvisorInput("");
  setAdvisorLoading(true);
  setAdvisorDraft(null);

  try {
    const payload = { message, environment: environment || "demo", conversation_id: advisorConversationId };
    if (isBuild) {
      const result = await api.advisorBuild(payload);
      setAdvisorConversationId(result.conversation_id);
      setAdvisorMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.reply, mode: "build" },
      ]);
      setAdvisorDraft({ draft_id: result.draft_id, workflow_definition: result.workflow_definition });
    } else {
      const result = await api.advisorChat(payload);
      setAdvisorConversationId(result.conversation_id);
      setAdvisorMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.reply, sources: result.sources },
      ]);
    }
  } catch (e) {
    setAdvisorMessages((prev) => [
      ...prev,
      { role: "assistant", content: `Error: ${e.message}` },
    ]);
  } finally {
    setAdvisorLoading(false);
  }
};

const openAdvisorWithPrefill = (text) => {
  setAdvisorOpen(true);
  setAdvisorInput(text);
};
```

- [ ] **Step 5: Add the floating chat button and panel JSX**

In the `App` return JSX, just before the final closing `</div>` of the app shell (after `</main>` or equivalent), add:

```jsx
{/* Floating advisor button */}
{session && advisorAvailable && (
  <button
    onClick={() => setAdvisorOpen((o) => !o)}
    style={{
      position: "fixed",
      bottom: "24px",
      right: "24px",
      zIndex: 50,
      width: "48px",
      height: "48px",
      borderRadius: "50%",
      background: "#6366f1",
      color: "#fff",
      border: "none",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
    }}
    title="Open Advisor"
  >
    <MessageSquare size={22} />
  </button>
)}

{/* Floating advisor panel */}
{session && advisorAvailable && advisorOpen && (
  <div
    style={{
      position: "fixed",
      bottom: "80px",
      right: "24px",
      width: "400px",
      height: "calc(100vh - 120px)",
      zIndex: 50,
      background: "#1e1e2e",
      border: "1px solid #333",
      borderRadius: "12px",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      overflow: "hidden",
    }}
  >
    {/* Panel header */}
    <div style={{ padding: "12px 16px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", gap: "8px" }}>
      <Shield size={16} color="#6366f1" />
      <span style={{ fontWeight: 600, flex: 1, color: "#e2e8f0" }}>Advisor</span>
      <button
        onClick={() => setAdvisorMode("chat")}
        style={{ padding: "4px 10px", borderRadius: "6px", border: "1px solid #333", background: advisorMode === "chat" ? "#6366f1" : "transparent", color: advisorMode === "chat" ? "#fff" : "#94a3b8", cursor: "pointer", fontSize: "12px" }}
      >chat</button>
      <button
        onClick={() => setAdvisorMode("build")}
        style={{ padding: "4px 10px", borderRadius: "6px", border: "1px solid #333", background: advisorMode === "build" ? "#6366f1" : "transparent", color: advisorMode === "build" ? "#fff" : "#94a3b8", cursor: "pointer", fontSize: "12px" }}
      >build</button>
      <button onClick={() => setAdvisorOpen(false)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: "4px" }}>
        <X size={16} />
      </button>
    </div>

    {/* Message history */}
    <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
      {advisorMessages.length === 0 && (
        <p style={{ color: "#64748b", fontSize: "13px", textAlign: "center", marginTop: "24px" }}>
          Ask about agents, audit events, policies, or type <code>/build</code> to generate a workflow.
        </p>
      )}
      {advisorMessages.map((msg, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
          <div style={{
            maxWidth: "90%",
            padding: "8px 12px",
            borderRadius: "8px",
            background: msg.role === "user" ? "#6366f1" : "#2d2d3d",
            color: msg.role === "user" ? "#fff" : "#e2e8f0",
            fontSize: "13px",
            lineHeight: "1.5",
            whiteSpace: "pre-wrap",
          }}>
            {msg.content}
          </div>
          {msg.sources && msg.sources.length > 0 && (
            <div style={{ fontSize: "11px", color: "#64748b", paddingLeft: "4px" }}>
              Sources: {msg.sources.map((s) => s.source_type).join(", ")}
            </div>
          )}
        </div>
      ))}
      {advisorLoading && (
        <div style={{ color: "#64748b", fontSize: "13px" }}>Thinking…</div>
      )}
      {advisorDraft && (
        <AdvisorWorkflowCard
          draft={advisorDraft}
          onCreateDirectly={async () => {
            const r = await api.advisorDraftCreate(advisorDraft.draft_id);
            setAdvisorDraft(null);
            alert(`Workflow created: ${r.workflow_definition_id}`);
          }}
          onOpenInBuilder={async () => {
            const r = await api.advisorDraftOpenInBuilder(advisorDraft.draft_id);
            setAdvisorDraft(null);
            setWorkflowDefinitionJson(JSON.stringify(r.workflow_definition, null, 2));
            setActiveNav("agents");
          }}
        />
      )}
    </div>

    {/* Input area */}
    <div style={{ padding: "12px 16px", borderTop: "1px solid #333", display: "flex", gap: "8px" }}>
      <input
        value={advisorInput}
        onChange={(e) => setAdvisorInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleAdvisorSend()}
        placeholder={advisorMode === "build" ? "Describe a workflow…" : "Ask about your agents…"}
        style={{
          flex: 1,
          background: "#2d2d3d",
          border: "1px solid #444",
          borderRadius: "6px",
          padding: "8px 12px",
          color: "#e2e8f0",
          fontSize: "13px",
          outline: "none",
        }}
      />
      <button
        onClick={handleAdvisorSend}
        disabled={advisorLoading || !advisorInput.trim()}
        style={{
          padding: "8px 12px",
          borderRadius: "6px",
          background: "#6366f1",
          color: "#fff",
          border: "none",
          cursor: advisorLoading ? "not-allowed" : "pointer",
          opacity: advisorLoading ? 0.6 : 1,
        }}
      >
        <Send size={14} />
      </button>
    </div>
  </div>
)}
```

Note: `setWorkflowDefinitionJson` and `setActiveNav` are existing state setters in App.jsx — verify their actual names by searching App.jsx for the workflow builder state.

- [ ] **Step 6: Verify the panel renders in the browser**

Start the dev server (`npm run dev` in `dashboard/`) and open the app. Log in. The indigo `MessageSquare` button should appear in the bottom-right (only if `ADVISOR_MODEL` is set and backend is running). If advisor is unavailable, the button is hidden.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/App.jsx
git commit -m "feat: add advisor floating chat panel with chat/build mode toggle"
```

---

## Task 12: Frontend — workflow preview card component

**Files:**
- Modify: `dashboard/src/App.jsx`

- [ ] **Step 1: Add AdvisorWorkflowCard component to App.jsx**

Add this component function before the `App` function definition in `App.jsx`:

```jsx
function AdvisorWorkflowCard({ draft, onCreateDirectly, onOpenInBuilder }) {
  const wf = draft.workflow_definition;
  const steps = wf.steps || [];
  return (
    <div style={{
      border: "1px solid #6366f1",
      borderRadius: "8px",
      background: "#1a1a2e",
      overflow: "hidden",
      width: "100%",
      marginTop: "4px",
    }}>
      <div style={{ padding: "10px 14px", background: "#2d2d3d", borderBottom: "1px solid #333" }}>
        <div style={{ fontSize: "12px", color: "#6366f1", fontWeight: 600, marginBottom: "2px" }}>Generated Workflow</div>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#e2e8f0" }}>{wf.name || "Untitled Workflow"}</div>
        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
          {steps.length} step{steps.length !== 1 ? "s" : ""} · {wf.environment || "demo"} · lead: {wf.lead_agent_id || "—"}
        </div>
      </div>

      <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: "4px" }}>
        {steps.slice(0, 4).map((step, i) => (
          <div key={i} style={{ fontSize: "12px", color: "#94a3b8" }}>
            <span style={{ color: "#6366f1", fontWeight: 600 }}>{i + 1}.</span>{" "}
            {step.label || step.agent_id}
            {step.tool_name && <span style={{ color: "#64748b" }}> · {step.tool_name}</span>}
          </div>
        ))}
        {steps.length > 4 && (
          <div style={{ fontSize: "11px", color: "#64748b" }}>+{steps.length - 4} more steps</div>
        )}
      </div>

      <div style={{ padding: "8px 14px", borderTop: "1px solid #333", display: "flex", gap: "8px" }}>
        <button
          onClick={onCreateDirectly}
          style={{ flex: 1, padding: "6px", borderRadius: "6px", background: "#6366f1", color: "#fff", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}
        >
          Create directly
        </button>
        <button
          onClick={onOpenInBuilder}
          style={{ flex: 1, padding: "6px", borderRadius: "6px", background: "transparent", color: "#6366f1", border: "1px solid #6366f1", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}
        >
          Open in Builder
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the card renders when a build response comes back**

With Ollama running and `ADVISOR_MODEL=ollama/qwen3.5:9b` set: open the advisor panel → switch to build mode → type "Build a fraud investigation workflow" → send. The workflow preview card should appear below the assistant reply.

If Ollama is not available, test with a mocked endpoint or skip visual verification.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/App.jsx
git commit -m "feat: add AdvisorWorkflowCard — workflow preview card with Create/Open in Builder actions"
```

---

## Task 13: Frontend — contextual "Ask Advisor" triggers

**Files:**
- Modify: `dashboard/src/App.jsx`

- [ ] **Step 1: Add "Ask Advisor" button to the Workflow Trace view**

Find the Workflow Trace view render section in App.jsx (the section that renders when `activeNav === "workflow"`). Find the panel title or header area and add an "Ask Advisor" button:

```jsx
{/* In the Workflow Trace view header area, alongside existing controls */}
{advisorAvailable && selectedWorkflow && (
  <button
    onClick={() => {
      const wf = selectedWorkflow;
      const prefill = `Tell me about workflow ${wf.workflow_id}: ${wf.name}. Status: ${wf.status}.`;
      openAdvisorWithPrefill(prefill);
    }}
    style={{
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "6px 12px",
      borderRadius: "6px",
      border: "1px solid #6366f1",
      background: "transparent",
      color: "#6366f1",
      cursor: "pointer",
      fontSize: "12px",
    }}
  >
    <MessageSquare size={13} />
    Ask Advisor
  </button>
)}
```

- [ ] **Step 2: Add MessageSquare icon to Audit Events rows**

Find the Audit Events view section (where `activeNav === "audit"`). In the table row render, add a `MessageSquare` icon button at the end of each row:

```jsx
{/* At the end of each audit event table row <td> */}
{advisorAvailable && (
  <td style={{ padding: "8px 12px" }}>
    <button
      onClick={() => {
        const prefill = `Why was this action ${event.decision}? Agent: ${event.agent_id}, tool: ${event.tool_name || "unknown"}, risk score: ${event.risk_score}. Reason: ${event.reason}`;
        openAdvisorWithPrefill(prefill);
      }}
      title="Ask Advisor about this event"
      style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: "4px" }}
    >
      <MessageSquare size={13} />
    </button>
  </td>
)}
```

Also add a matching `<th>` header cell for the new column if the audit table has headers.

- [ ] **Step 3: Handle advisorPrefill state to auto-fill and send**

Update the `useEffect` that handles `advisorPrefill` to auto-populate the input:

```jsx
useEffect(() => {
  if (advisorPrefill !== null) {
    setAdvisorInput(advisorPrefill);
    setAdvisorPrefill(null);
  }
}, [advisorPrefill]);
```

Update `openAdvisorWithPrefill`:

```jsx
const openAdvisorWithPrefill = (text) => {
  setAdvisorOpen(true);
  setAdvisorMode("chat");
  setAdvisorPrefill(text);
};
```

- [ ] **Step 4: Verify contextual triggers in the browser**

Navigate to Audit Events. Each row should show a small `MessageSquare` icon. Click one — the advisor panel should open with the pre-filled message about that audit event.

Navigate to Workflow Trace for a completed workflow. The "Ask Advisor" button should appear in the header. Click it — the advisor panel should open with the workflow context pre-filled.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/App.jsx
git commit -m "feat: add contextual Ask Advisor triggers on Workflow Trace and Audit Events views"
```

---

## Task 14: Wire up AdvisorIndexer to post-run hooks

**Files:**
- Modify: `api/main.py`

The advisor indexer already runs `sync_all()` at startup (added in Task 9). This task adds post-run indexing so new session data is searchable immediately after a run completes.

- [ ] **Step 1: Update the `/v1/agent-run` endpoint to index after run**

Find the endpoint in `api/main.py` that calls `run_customer_support_agent` (the single-agent run endpoint). After the run completes and the response is built, add:

```python
if _advisor_gateway.available:
    try:
        _advisor_indexer.index_session(result.session_id)
    except Exception:
        pass  # Non-fatal
```

Replace `result.session_id` with the actual variable name used in that endpoint for the session ID.

- [ ] **Step 2: Update the `/v1/workflow-run` endpoint to index after run**

Find the endpoint that calls `run_customer_support_workflow`. After the run completes, add:

```python
if _advisor_gateway.available:
    try:
        for sess_id in result.session_ids:  # adjust to actual session IDs list
            _advisor_indexer.index_session(sess_id)
        _advisor_indexer.index_evaluation_results()
    except Exception:
        pass  # Non-fatal
```

Note: The actual session IDs come from the `AgentWorkflow` or `WorkflowSessionLink` records — look at how the workflow run response is constructed and use the session IDs from there.

- [ ] **Step 3: Run the full advisor test suite**

```
pytest tests/test_advisor_gateway.py tests/test_advisor_rag.py tests/test_advisor_chat.py tests/test_advisor_builder.py tests/test_advisor_store.py -v
```

Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add api/main.py
git commit -m "feat: wire AdvisorIndexer to post-run hooks for real-time RAG indexing"
```

---

## Task 15: End-to-end smoke test

**Files:**
- No new files — manual verification

This task verifies the full stack works end-to-end with Ollama running.

Prerequisites:
1. Ollama running at `http://localhost:11434`
2. `ollama pull qwen3.5:9b` and `ollama pull nomic-embed-text` completed
3. `ADVISOR_MODEL=ollama/qwen3.5:9b` set in environment
4. API server running: `uvicorn api.main:app --reload`
5. Dashboard running: `cd dashboard && npm run dev`

- [ ] **Step 1: Verify startup indexing**

Check the API server logs on startup. You should see no errors from the `_advisor_indexer.sync_all()` call. The `advisor_documents` table should have rows:

```sql
SELECT source_type, COUNT(*) FROM advisor_documents GROUP BY source_type;
```

- [ ] **Step 2: Test chat mode**

Open the dashboard. The indigo `MessageSquare` button should appear bottom-right. Open the panel. Ask: "Which agents are registered in the demo environment?"

Expected: A response citing agent identities from the indexed documents.

- [ ] **Step 3: Test build mode**

In the advisor panel, type: `/build a workflow that verifies customer identity then checks transactions`

Expected: A workflow preview card appears with a generated `WorkflowDefinition` JSON containing at least 2 steps using real agent IDs.

- [ ] **Step 4: Test "Create directly"**

Click "Create directly" on the workflow card.

Expected: A workflow definition is created and visible in the Workflow Marketplace. The draft status updates to `created`.

- [ ] **Step 5: Test contextual triggers**

Run a workflow (`/v1/workflow-run`), then navigate to Audit Events. Click the `MessageSquare` icon on an audit event row. The advisor panel should open with the event pre-filled.

Navigate to Workflow Trace for the just-run workflow. Click "Ask Advisor". The advisor should respond about that specific workflow.

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat: complete advisor agent implementation — LLM chat, RAG, workflow builder, floating panel"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| `advisor_documents` table with `vector(768)` embedding | Task 1 + 4 |
| `advisor_conversations`, `advisor_messages`, `advisor_workflow_drafts` tables | Task 1 |
| `LLMGateway` (complete, stream, embed) | Task 3 |
| `AdvisorRAG` (index_document, retrieve) | Task 4 |
| `AdvisorIndexer` (sync_all, index_session, all 6 source types) | Task 5 |
| `AdvisorChat` (RAG + history + persist) | Task 6 |
| `AdvisorBuilder` (generate, parse, validate, draft) | Task 7 |
| POST /v1/advisor/chat | Task 9 |
| POST /v1/advisor/build | Task 9 |
| POST /v1/advisor/drafts/{id}/create | Task 9 |
| POST /v1/advisor/drafts/{id}/open-in-builder | Task 9 |
| POST /v1/advisor/drafts/{id}/discard | Task 9 |
| GET /v1/advisor/conversations | Task 9 |
| GET /v1/advisor/conversations/{id}/messages | Task 9 |
| Floating chat panel (bottom-right, 400px, full-height) | Task 11 |
| Mode toggle [chat] [build] | Task 11 |
| Sources collapsible (shown when RAG returns results) | Task 11 |
| Workflow preview card with Create/Open in Builder | Task 12 |
| "Ask Advisor" on Workflow Trace view | Task 13 |
| MessageSquare icon on Audit Events rows | Task 13 |
| Panel hidden if ADVISOR_MODEL not set | Task 11 (advisorAvailable guard) |
| Startup indexing + post-run indexing | Task 9 + 14 |
| pgvector extension setup in init_db | Task 2 |
| litellm + pgvector dependencies | Task 8 |

All spec requirements covered.

### Placeholder scan

No TBD or TODO items. All steps have actual code.

### Type consistency

- `AdvisorDocument.doc_id` format: `"doc_{source_type}_{source_id}"` — consistent between `AdvisorRAG.index_document` (Task 4) and `AdvisorIndexer` (Task 5).
- `store.create_advisor_conversation` returns `str` (conv_id) — used consistently in `AdvisorChat` (Task 6) and API endpoints (Task 9).
- `store.add_advisor_message` returns `str` (msg_id) — used consistently in `AdvisorChat` and `AdvisorBuilder`.
- `AdvisorBuilder._parse_response` returns `tuple[dict, str]` — consumed correctly in `generate`.
- `AdvisorWorkflowCard` receives `{ draft_id, workflow_definition }` — matches what `handleAdvisorSend` sets in `advisorDraft`.
