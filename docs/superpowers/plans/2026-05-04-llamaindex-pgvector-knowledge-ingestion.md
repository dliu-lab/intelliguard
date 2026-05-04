# LlamaIndex Pgvector Knowledge Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build working file upload, LlamaIndex ingestion/indexing, Ollama embeddings, pgvector storage, and governed KB retrieval for IntelliGuard.

**Architecture:** LlamaIndex runs as Python library code inside the API and KB worker containers. IntelliGuard owns upload storage, metadata, access policy, status, and citations; pgvector stores chunk embeddings in the existing Postgres database. The sync endpoint processes pending documents synchronously for a working UI path, while the worker command reuses the same service for unattended queued work.

**Tech Stack:** FastAPI, SQLAlchemy, pgvector, LlamaIndex, Ollama embeddings, Postgres/pgvector Docker image, React/TypeScript dashboard.

---

## Impact Baseline

GitNexus checks already run before writing this plan:

- `KnowledgeBase`: MEDIUM risk, 6 direct imports, no affected execution flows. Direct files include `tests/test_knowledge_bases.py`, `tests/conftest.py`, and `agent_governance/tools.py`.
- `GovernanceStore`: LOW risk, no indexed upstream dependents.
- `KBRetrieval`: LOW risk, no indexed upstream dependents.
- `KnowledgeBasesWorkspace`: LOW risk, no indexed upstream dependents.
- `/v1/knowledge-bases/{kb_id}/sync`: LOW API impact, no indexed consumers.
- `/v1/knowledge-bases/{kb_id}/query`: LOW API impact, no indexed consumers.

Implementation workers must still run GitNexus impact immediately before editing each symbol, because the index may change while work is in progress.

## File Structure

- Modify `pyproject.toml`: add LlamaIndex, pgvector, multipart upload, and document parser dependencies.
- Modify `docker-compose.yml`: switch Postgres to pgvector image, add upload volume, environment variables, and `kb-worker`.
- Modify `Dockerfile.api`: copy worker modules and install runtime dependencies once for API and worker.
- Modify `agent_governance/settings.py`: add KB/Ollama settings helpers.
- Modify `agent_governance/models.py`: add `KnowledgeDocument` and `KnowledgeChunk` SQLAlchemy models.
- Modify `agent_governance/db.py`: create pgvector extension before table creation and patch new runtime tables.
- Modify `agent_governance/store.py`: add document/chunk CRUD, status transitions, and aggregate count refresh.
- Create `agent_governance/knowledge_storage.py`: file validation, checksum, safe path creation, and storage.
- Create `agent_governance/knowledge_indexing.py`: LlamaIndex parser/chunker, Ollama embedding adapter, fake test embedding adapter, ingestion service.
- Modify `agent_governance/knowledge.py`: replace old `AdvisorRAG` wrapper path with pgvector-backed retrieval service.
- Create `agent_governance/knowledge_worker.py`: command entry point for queued ingestion processing.
- Modify `api/main.py`: add file upload/documents endpoints, wire sync/query to ingestion and retrieval services.
- Modify `dashboard/lib/api.ts`: add upload and document-list client helpers.
- Modify `dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx`: show file input, upload files, display documents, and show citation metadata.
- Modify `tests/test_knowledge_bases.py`: extend existing KB tests for models, API, ingestion, retrieval, and upload validation.
- Add `tests/test_knowledge_ingestion.py`: focused service tests for storage, ingestion, and retrieval filters.

## Task 1: Dependencies And Docker Runtime

**Files:**
- Modify: `pyproject.toml`
- Modify: `docker-compose.yml`
- Modify: `Dockerfile.api`
- Modify: `agent_governance/settings.py`

- [ ] **Step 1: Run impact/context checks**

Run GitNexus MCP impact:

```text
mcp__gitnexus__.impact({"repo":"intelliguard","target":"DEFAULT_DATABASE_URL","direction":"upstream"})
```

Expected: continue if risk is LOW or MEDIUM. Warn before editing if risk is HIGH or CRITICAL.

- [ ] **Step 2: Add dependency declarations**

In `pyproject.toml`, extend `[project].dependencies` with these exact packages:

```toml
  "llama-index-core>=0.12.0",
  "llama-index-readers-file>=0.4.0",
  "llama-index-embeddings-ollama>=0.5.0",
  "pgvector>=0.3.6",
  "python-multipart>=0.0.20",
  "pypdf>=5.0.0",
  "python-docx>=1.1.2",
```

- [ ] **Step 3: Add KB settings helpers**

Append to `agent_governance/settings.py`:

```python
import os

DEFAULT_OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
DEFAULT_OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
DEFAULT_KB_UPLOAD_DIR = os.getenv("KB_UPLOAD_DIR", "data/kb_uploads")
DEFAULT_KB_EMBED_DIMENSION = int(os.getenv("KB_EMBED_DIMENSION", "768"))
DEFAULT_KB_CHUNK_SIZE = int(os.getenv("KB_CHUNK_SIZE", "1024"))
DEFAULT_KB_CHUNK_OVERLAP = int(os.getenv("KB_CHUNK_OVERLAP", "160"))
DEFAULT_KB_INGESTION_BATCH_SIZE = int(os.getenv("KB_INGESTION_BATCH_SIZE", "32"))
```

- [ ] **Step 4: Update Docker Compose**

Change `docker-compose.yml` so Postgres uses pgvector and the API/worker share uploads:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: governance
      POSTGRES_USER: governance
      POSTGRES_PASSWORD: governance
    ports:
      - "55432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U governance -d governance"]
      interval: 5s
      timeout: 3s
      retries: 20

  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    environment:
      DATABASE_URL: postgresql+psycopg://governance:governance@postgres:5432/governance
      POLICY_PATH: policies/policy.yaml
      AUTO_INIT_DB: "true"
      SEED_DEMO_DATA: "false"
      OLLAMA_BASE_URL: http://host.docker.internal:11434
      OLLAMA_EMBED_MODEL: nomic-embed-text
      KB_UPLOAD_DIR: /app/data/kb_uploads
      KB_EMBED_DIMENSION: "768"
    volumes:
      - kb_uploads:/app/data/kb_uploads
    ports:
      - "8000:8000"
    depends_on:
      postgres:
        condition: service_healthy

  kb-worker:
    build:
      context: .
      dockerfile: Dockerfile.api
    command: ["python", "-m", "agent_governance.knowledge_worker"]
    environment:
      DATABASE_URL: postgresql+psycopg://governance:governance@postgres:5432/governance
      OLLAMA_BASE_URL: http://host.docker.internal:11434
      OLLAMA_EMBED_MODEL: nomic-embed-text
      KB_UPLOAD_DIR: /app/data/kb_uploads
      KB_EMBED_DIMENSION: "768"
    volumes:
      - kb_uploads:/app/data/kb_uploads
    depends_on:
      postgres:
        condition: service_healthy

  dashboard:
    build:
      context: ./dashboard
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_BASE_URL: http://localhost:8000
    ports:
      - "5175:80"
    depends_on:
      - api

volumes:
  postgres_data:
  kb_uploads:
```

- [ ] **Step 5: Run dependency and compose validation**

Run:

```bash
uv lock
docker compose config >/tmp/intelliguard-compose.yml
```

Expected: both commands exit 0. If `uv lock` rewrites `uv.lock`, include it in the commit.

- [ ] **Step 6: Commit**

Run:

```bash
git add pyproject.toml uv.lock docker-compose.yml Dockerfile.api agent_governance/settings.py
git commit -m "chore: add llamaindex pgvector runtime"
```

Before the commit, run GitNexus MCP `detect_changes({"repo":"intelliguard","scope":"staged"})`; expected risk is LOW because this task changes config and settings only.

## Task 2: Knowledge Document And Chunk Schema

**Files:**
- Modify: `agent_governance/models.py`
- Modify: `agent_governance/db.py`
- Modify: `tests/conftest.py`
- Modify: `tests/test_knowledge_bases.py`

- [ ] **Step 1: Run impact analysis**

Run GitNexus MCP impact before editing:

```text
mcp__gitnexus__.impact({"repo":"intelliguard","target":"KnowledgeBase","direction":"upstream"})
mcp__gitnexus__.impact({"repo":"intelliguard","target":"ensure_runtime_schema","direction":"upstream"})
```

Expected baseline: `KnowledgeBase` MEDIUM, `ensure_runtime_schema` LOW or MEDIUM. Warn before editing if a result is HIGH or CRITICAL.

- [ ] **Step 2: Write failing model tests**

Add imports in `tests/test_knowledge_bases.py`:

```python
from pgvector.sqlalchemy import Vector
```

Extend the model import list:

```python
    KnowledgeChunk,
    KnowledgeDocument,
```

Extend `test_knowledge_models_are_declared`:

```python
    assert KnowledgeDocument.__tablename__ == "knowledge_documents"
    assert KnowledgeChunk.__tablename__ == "knowledge_chunks"
```

Add this test after `test_knowledge_source_and_index_version_columns_are_declared`:

```python
def test_knowledge_document_and_chunk_columns_are_declared() -> None:
    assert _column(KnowledgeDocument, "document_id").primary_key is True
    assert _column(KnowledgeDocument, "kb_id").nullable is False
    assert [fk.target_fullname for fk in _column(KnowledgeDocument, "kb_id").foreign_keys] == [
        "knowledge_bases.kb_id"
    ]
    assert [fk.target_fullname for fk in _column(KnowledgeDocument, "source_id").foreign_keys] == [
        "knowledge_sources.source_id"
    ]
    assert isinstance(_column(KnowledgeDocument, "file_name").type, String)
    assert isinstance(_column(KnowledgeDocument, "storage_uri").type, Text)
    assert isinstance(_column(KnowledgeDocument, "size_bytes").type, Integer)
    assert _default_arg(KnowledgeDocument, "status") == "uploaded"
    assert _default_arg(KnowledgeDocument, "chunk_count") == 0

    assert _column(KnowledgeChunk, "chunk_id").primary_key is True
    assert [fk.target_fullname for fk in _column(KnowledgeChunk, "document_id").foreign_keys] == [
        "knowledge_documents.document_id"
    ]
    assert isinstance(_column(KnowledgeChunk, "content").type, Text)
    assert isinstance(_column(KnowledgeChunk, "metadata_json").type, JSONB)
    assert isinstance(_column(KnowledgeChunk, "embedding").type, Vector)
```

- [ ] **Step 3: Run the failing test**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py::test_knowledge_document_and_chunk_columns_are_declared -q
```

Expected: FAIL with import or name error for `KnowledgeDocument`.

- [ ] **Step 4: Add models**

In `agent_governance/models.py`, import `os` and `Vector`:

```python
import os
from pgvector.sqlalchemy import Vector
```

Add this module constant near `new_id`:

```python
KNOWLEDGE_EMBEDDING_DIMENSION = int(os.getenv("KB_EMBED_DIMENSION", "768"))
```

Add these models after `KnowledgeIndexVersion` or immediately before it if the class order there is more natural:

```python
class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    document_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.kb_id"), nullable=False)
    source_id: Mapped[str] = mapped_column(ForeignKey("knowledge_sources.source_id"), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), default="")
    storage_uri: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    checksum: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="uploaded")
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"

    chunk_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.kb_id"), nullable=False)
    source_id: Mapped[str] = mapped_column(ForeignKey("knowledge_sources.source_id"), nullable=False)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("knowledge_documents.document_id"), nullable=False
    )
    index_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("knowledge_index_versions.index_version_id")
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(KNOWLEDGE_EMBEDDING_DIMENSION))
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
```

- [ ] **Step 5: Ensure pgvector extension before creating tables**

In `agent_governance/db.py`, update `init_db`:

```python
def init_db(database_url: str = DEFAULT_DATABASE_URL) -> None:
    engine = build_engine(database_url)
    ensure_vector_extension(engine)
    Base.metadata.create_all(engine)
    ensure_runtime_schema(engine)
```

Add this helper above `init_db`:

```python
def ensure_vector_extension(engine) -> None:
    with engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
```

At the start of `ensure_runtime_schema`, call the helper:

```python
    ensure_vector_extension(engine)
```

- [ ] **Step 6: Patch existing runtime schemas**

Inside `ensure_runtime_schema`, add table creation for existing databases that do not yet have the new tables:

```python
    table_names = set(inspector.get_table_names())
    if "knowledge_documents" not in table_names:
        KnowledgeDocument.__table__.create(engine, checkfirst=True)
    if "knowledge_chunks" not in table_names:
        KnowledgeChunk.__table__.create(engine, checkfirst=True)
```

Also import `KnowledgeDocument` and `KnowledgeChunk` from `agent_governance.models`.

- [ ] **Step 7: Update schema patch test**

In `test_runtime_schema_patches_existing_knowledge_tables`, add `"knowledge_sources"` to `get_table_names` and add source columns in `get_columns`. Assert these snippets appear:

```python
    monkeypatch.setattr(
        KnowledgeDocument.__table__,
        "create",
        lambda engine, checkfirst=True: engine.connection.statements.append(
            "CREATE TABLE knowledge_documents"
        ),
    )
    monkeypatch.setattr(
        KnowledgeChunk.__table__,
        "create",
        lambda engine, checkfirst=True: engine.connection.statements.append(
            "CREATE TABLE knowledge_chunks"
        ),
    )

    assert any("CREATE EXTENSION IF NOT EXISTS vector" in statement for statement in engine.connection.statements)
    assert "CREATE TABLE knowledge_documents" in statements
    assert "CREATE TABLE knowledge_chunks" in statements
```

- [ ] **Step 8: Ensure test databases load pgvector before create_all**

In `tests/conftest.py`, import `ensure_vector_extension`:

```python
from agent_governance.db import ensure_vector_extension, seed_demo_data
```

Before `Base.metadata.create_all(engine)`, add:

```python
    ensure_vector_extension(engine)
```

The fixture section should read:

```python
    engine = create_engine(TEST_DATABASE_URL)
    ensure_vector_extension(engine)
    Base.metadata.create_all(engine)
    engine.dispose()
```

- [ ] **Step 9: Run tests**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py -q
```

Expected: all KB tests pass.

- [ ] **Step 10: Commit**

Run:

```bash
git add agent_governance/models.py agent_governance/db.py tests/conftest.py tests/test_knowledge_bases.py
git commit -m "feat: add knowledge document chunk schema"
```

Run GitNexus MCP `detect_changes({"repo":"intelliguard","scope":"staged"})` after `git add` and before `git commit`.

Expected GitNexus risk: MEDIUM because `KnowledgeBase` model imports are broad. Review changed symbols before committing.

## Task 3: Store Methods For Documents, Chunks, And Counts

**Files:**
- Modify: `agent_governance/store.py`
- Modify: `tests/test_knowledge_bases.py`

- [ ] **Step 1: Run impact analysis**

Run GitNexus MCP impact:

```text
mcp__gitnexus__.impact({"repo":"intelliguard","target":"GovernanceStore","direction":"upstream"})
```

Expected baseline: LOW. If HIGH or CRITICAL, stop and warn before editing.

- [ ] **Step 2: Write failing store lifecycle tests**

Add a test to `tests/test_knowledge_bases.py`:

```python
def test_knowledge_document_and_chunk_lifecycle_updates_counts(store: GovernanceStore) -> None:
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-doc-kb",
            "display_name": "Claims Doc KB",
            "description": "",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )
    source = store.upsert_knowledge_source(
        "claims-doc-kb",
        {
            "source_type": "file",
            "display_name": "Claims SOP",
            "uri": "file://claims-sop.txt",
            "content_type": "text/plain",
            "source_config": {},
        },
    )

    document = store.create_knowledge_document(
        "claims-doc-kb",
        source["source_id"],
        {
            "file_name": "claims-sop.txt",
            "content_type": "text/plain",
            "storage_uri": "file:///tmp/claims-sop.txt",
            "size_bytes": 42,
            "checksum": "abc123",
        },
    )

    assert document["status"] == "uploaded"
    assert store.list_knowledge_documents("claims-doc-kb")[0]["file_name"] == "claims-sop.txt"

    index = store.create_knowledge_index_version(
        "claims-doc-kb",
        {
            "status": "indexing",
            "source_count": 1,
            "document_count": 1,
            "chunk_count": 0,
            "embedding_model": "nomic-embed-text",
            "vector_backend": "pgvector",
        },
    )
    store.replace_knowledge_chunks(
        document["document_id"],
        index["index_version_id"],
        [
            {
                "chunk_index": 0,
                "content": "Claims must be reviewed within two business days.",
                "content_hash": "chunk-a",
                "embedding": [0.1] * 768,
                "metadata": {"kb_id": "claims-doc-kb", "file_name": "claims-sop.txt"},
            },
            {
                "chunk_index": 1,
                "content": "Escalate claims over the authority threshold.",
                "content_hash": "chunk-b",
                "embedding": [0.2] * 768,
                "metadata": {"kb_id": "claims-doc-kb", "file_name": "claims-sop.txt"},
            },
        ],
    )
    updated = store.mark_knowledge_document_indexed(document["document_id"], 2)
    aggregate = store.refresh_knowledge_base_index_state("claims-doc-kb", index["index_version_id"])

    assert updated["status"] == "indexed"
    assert updated["chunk_count"] == 2
    assert aggregate["document_count"] == 1
    assert aggregate["chunk_count"] == 2
    assert aggregate["status"] == "ready"
```

- [ ] **Step 3: Run failing test**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py::test_knowledge_document_and_chunk_lifecycle_updates_counts -q
```

Expected: FAIL because store methods do not exist.

- [ ] **Step 4: Import new models**

In `agent_governance/store.py`, add `KnowledgeDocument` and `KnowledgeChunk` to the model import list.

- [ ] **Step 5: Add document store methods**

Add methods near existing KB methods:

```python
    def create_knowledge_document(
        self, kb_id: str, source_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        with self.session() as db:
            if not db.get(KnowledgeBase, kb_id):
                raise ValueError(f"Knowledge base {kb_id!r} not found")
            source = db.get(KnowledgeSource, source_id)
            if not source or source.kb_id != kb_id:
                raise ValueError(f"Knowledge source {source_id!r} not found for {kb_id!r}")
            row = KnowledgeDocument(
                document_id=new_id("kbd"),
                kb_id=kb_id,
                source_id=source_id,
                file_name=payload["file_name"],
                content_type=payload.get("content_type") or "",
                storage_uri=payload["storage_uri"],
                size_bytes=int(payload.get("size_bytes") or 0),
                checksum=payload["checksum"],
                status=payload.get("status") or "uploaded",
            )
            db.add(row)
            source.status = "pending"
            source.checksum = row.checksum
            source.updated_at = utc_now()
            db.flush()
            return self._kb_document_to_dict(row)

    def list_knowledge_documents(self, kb_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(KnowledgeDocument)
                .where(KnowledgeDocument.kb_id == kb_id)
                .order_by(KnowledgeDocument.created_at.desc())
            ).all()
            return [self._kb_document_to_dict(row) for row in rows]

    def get_knowledge_document(self, document_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            row = db.get(KnowledgeDocument, document_id)
            return self._kb_document_to_dict(row) if row else None
```

- [ ] **Step 6: Add chunk and status methods**

Add:

```python
    def mark_knowledge_document_status(
        self, document_id: str, status: str, error: str | None = None
    ) -> dict[str, Any]:
        with self.session() as db:
            row = db.get(KnowledgeDocument, document_id)
            if not row:
                raise ValueError(f"Knowledge document {document_id!r} not found")
            row.status = status
            row.last_error = error
            row.updated_at = utc_now()
            source = db.get(KnowledgeSource, row.source_id)
            if source:
                source.status = "failed" if status == "failed" else status
                source.last_error = error
                source.updated_at = utc_now()
            db.flush()
            return self._kb_document_to_dict(row)

    def mark_knowledge_document_indexed(
        self, document_id: str, chunk_count: int
    ) -> dict[str, Any]:
        with self.session() as db:
            row = db.get(KnowledgeDocument, document_id)
            if not row:
                raise ValueError(f"Knowledge document {document_id!r} not found")
            row.status = "indexed"
            row.chunk_count = chunk_count
            row.last_error = None
            row.indexed_at = utc_now()
            row.updated_at = utc_now()
            source = db.get(KnowledgeSource, row.source_id)
            if source:
                source.status = "ready"
                source.last_error = None
                source.last_synced_at = row.indexed_at
                source.updated_at = utc_now()
            db.flush()
            return self._kb_document_to_dict(row)

    def replace_knowledge_chunks(
        self, document_id: str, index_version_id: str | None, chunks: list[dict[str, Any]]
    ) -> int:
        with self.session() as db:
            document = db.get(KnowledgeDocument, document_id)
            if not document:
                raise ValueError(f"Knowledge document {document_id!r} not found")
            db.query(KnowledgeChunk).filter(KnowledgeChunk.document_id == document_id).delete()
            for chunk in chunks:
                db.add(
                    KnowledgeChunk(
                        chunk_id=new_id("kbc"),
                        kb_id=document.kb_id,
                        source_id=document.source_id,
                        document_id=document.document_id,
                        index_version_id=index_version_id,
                        chunk_index=int(chunk["chunk_index"]),
                        content=chunk["content"],
                        content_hash=chunk["content_hash"],
                        embedding=chunk["embedding"],
                        metadata_json=chunk.get("metadata") or {},
                    )
                )
            db.flush()
            return len(chunks)
```

- [ ] **Step 7: Add aggregate refresh**

Add:

```python
    def refresh_knowledge_base_index_state(
        self, kb_id: str, index_version_id: str | None = None
    ) -> dict[str, Any]:
        with self.session() as db:
            kb = db.get(KnowledgeBase, kb_id)
            if not kb:
                raise ValueError(f"Knowledge base {kb_id!r} not found")
            document_count = int(
                db.scalar(
                    select(func.count())
                    .select_from(KnowledgeDocument)
                    .where(
                        KnowledgeDocument.kb_id == kb_id,
                        KnowledgeDocument.status == "indexed",
                    )
                )
                or 0
            )
            chunk_count = int(
                db.scalar(
                    select(func.count())
                    .select_from(KnowledgeChunk)
                    .where(KnowledgeChunk.kb_id == kb_id)
                )
                or 0
            )
            failed_count = int(
                db.scalar(
                    select(func.count())
                    .select_from(KnowledgeDocument)
                    .where(
                        KnowledgeDocument.kb_id == kb_id,
                        KnowledgeDocument.status == "failed",
                    )
                )
                or 0
            )
            kb.document_count = document_count
            kb.chunk_count = chunk_count
            kb.status = "failed" if failed_count and not chunk_count else "ready" if chunk_count else "draft"
            kb.last_error = None if kb.status != "failed" else "One or more documents failed ingestion"
            kb.last_indexed_at = utc_now() if chunk_count else kb.last_indexed_at
            kb.updated_at = utc_now()
            if index_version_id:
                index = db.get(KnowledgeIndexVersion, index_version_id)
                if index:
                    index.status = "ready" if chunk_count else "failed"
                    index.document_count = document_count
                    index.chunk_count = chunk_count
                    index.completed_at = utc_now()
                    index.error = kb.last_error
            db.flush()
            return self._kb_to_dict(kb)
```

- [ ] **Step 8: Add document serializer**

Add near existing serializers:

```python
    @staticmethod
    def _kb_document_to_dict(row: KnowledgeDocument | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "document_id": row.document_id,
            "kb_id": row.kb_id,
            "source_id": row.source_id,
            "file_name": row.file_name,
            "content_type": row.content_type,
            "storage_uri": row.storage_uri,
            "size_bytes": row.size_bytes,
            "checksum": row.checksum,
            "status": row.status,
            "chunk_count": row.chunk_count,
            "last_error": row.last_error,
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
            "indexed_at": row.indexed_at.isoformat() if row.indexed_at else None,
        }
```

- [ ] **Step 9: Run tests**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py -q
```

Expected: all KB tests pass.

- [ ] **Step 10: Commit**

Run:

```bash
git add agent_governance/store.py tests/test_knowledge_bases.py
git commit -m "feat: store knowledge documents and chunks"
```

Run GitNexus MCP `detect_changes({"repo":"intelliguard","scope":"staged"})` after `git add` and before `git commit`.

## Task 4: File Upload Storage

**Files:**
- Create: `agent_governance/knowledge_storage.py`
- Modify: `tests/test_knowledge_ingestion.py`

- [ ] **Step 1: Write failing storage tests**

Create `tests/test_knowledge_ingestion.py`:

```python
from __future__ import annotations

from pathlib import Path

import pytest

from agent_governance.knowledge_storage import KnowledgeFileStorage


def test_file_storage_writes_safe_upload(tmp_path: Path) -> None:
    storage = KnowledgeFileStorage(tmp_path)
    stored = storage.save_upload(
        kb_id="claims-kb",
        file_name="../Claims SOP.txt",
        content_type="text/plain",
        data=b"Claims must be reviewed within two business days.",
    )

    assert stored.file_name == "Claims SOP.txt"
    assert stored.content_type == "text/plain"
    assert stored.size_bytes == 49
    assert stored.checksum
    assert Path(stored.storage_uri.replace("file://", "")).read_bytes() == b"Claims must be reviewed within two business days."
    assert str(tmp_path / "claims-kb") in stored.path


def test_file_storage_rejects_empty_files(tmp_path: Path) -> None:
    storage = KnowledgeFileStorage(tmp_path)

    with pytest.raises(ValueError, match="Uploaded file is empty"):
        storage.save_upload(
            kb_id="claims-kb",
            file_name="empty.txt",
            content_type="text/plain",
            data=b"",
        )


def test_file_storage_rejects_unsupported_files(tmp_path: Path) -> None:
    storage = KnowledgeFileStorage(tmp_path)

    with pytest.raises(ValueError, match="Unsupported file type"):
        storage.save_upload(
            kb_id="claims-kb",
            file_name="image.png",
            content_type="image/png",
            data=b"not a supported document",
        )
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
uv run pytest tests/test_knowledge_ingestion.py -q
```

Expected: FAIL because `agent_governance.knowledge_storage` does not exist.

- [ ] **Step 3: Implement file storage**

Create `agent_governance/knowledge_storage.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from uuid import uuid4


SUPPORTED_CONTENT_TYPES = {
    "text/plain": ".txt",
    "text/markdown": ".md",
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
}

SUPPORTED_SUFFIXES = {".txt", ".md", ".pdf", ".docx"}


@dataclass(frozen=True)
class StoredKnowledgeFile:
    file_name: str
    content_type: str
    storage_uri: str
    path: str
    size_bytes: int
    checksum: str


class KnowledgeFileStorage:
    def __init__(self, upload_dir: str | Path) -> None:
        self.upload_dir = Path(upload_dir)

    def save_upload(
        self, *, kb_id: str, file_name: str, content_type: str, data: bytes
    ) -> StoredKnowledgeFile:
        if not data:
            raise ValueError("Uploaded file is empty")
        safe_name = self._safe_file_name(file_name)
        suffix = Path(safe_name).suffix.lower()
        normalized_content_type = content_type or self._content_type_for_suffix(suffix)
        if suffix not in SUPPORTED_SUFFIXES or normalized_content_type not in SUPPORTED_CONTENT_TYPES:
            raise ValueError("Unsupported file type")
        digest = sha256(data).hexdigest()
        target_dir = self.upload_dir / kb_id
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{uuid4().hex}_{safe_name}"
        target.write_bytes(data)
        return StoredKnowledgeFile(
            file_name=safe_name,
            content_type=normalized_content_type,
            storage_uri=f"file://{target}",
            path=str(target),
            size_bytes=len(data),
            checksum=digest,
        )

    @staticmethod
    def _safe_file_name(file_name: str) -> str:
        name = Path(file_name or "upload.txt").name.strip()
        return name or "upload.txt"

    @staticmethod
    def _content_type_for_suffix(suffix: str) -> str:
        if suffix == ".txt":
            return "text/plain"
        if suffix == ".md":
            return "text/markdown"
        if suffix == ".pdf":
            return "application/pdf"
        if suffix == ".docx":
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        return ""
```

- [ ] **Step 4: Run storage tests**

Run:

```bash
uv run pytest tests/test_knowledge_ingestion.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add agent_governance/knowledge_storage.py tests/test_knowledge_ingestion.py
git commit -m "feat: store uploaded knowledge files"
```

Run GitNexus MCP `detect_changes({"repo":"intelliguard","scope":"staged"})` after `git add` and before `git commit`.

## Task 5: LlamaIndex Ingestion Service

**Files:**
- Create: `agent_governance/knowledge_indexing.py`
- Modify: `tests/test_knowledge_ingestion.py`

- [ ] **Step 1: Write failing ingestion service test**

Append to `tests/test_knowledge_ingestion.py`:

```python
from agent_governance.knowledge_indexing import (
    DeterministicEmbeddingProvider,
    KnowledgeIngestionService,
    LlamaIndexKnowledgeIndexer,
)
from agent_governance.store import GovernanceStore


def test_ingestion_service_indexes_text_file(store: GovernanceStore, tmp_path: Path) -> None:
    source_path = tmp_path / "claims.txt"
    source_path.write_text("Claims must be reviewed within two business days.", encoding="utf-8")
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-ingest-kb",
            "display_name": "Claims Ingest KB",
            "description": "",
            "source_type": "file",
            "source_config": {"embedding_model": "nomic-embed-text"},
            "environment": "demo",
        }
    )
    source = store.upsert_knowledge_source(
        "claims-ingest-kb",
        {
            "source_type": "file",
            "display_name": "Claims Text",
            "uri": f"file://{source_path}",
            "content_type": "text/plain",
            "source_config": {},
        },
    )
    document = store.create_knowledge_document(
        "claims-ingest-kb",
        source["source_id"],
        {
            "file_name": "claims.txt",
            "content_type": "text/plain",
            "storage_uri": f"file://{source_path}",
            "size_bytes": source_path.stat().st_size,
            "checksum": "test-checksum",
        },
    )
    indexer = LlamaIndexKnowledgeIndexer(
        embedding_provider=DeterministicEmbeddingProvider(dimension=768),
        chunk_size=128,
        chunk_overlap=20,
    )
    service = KnowledgeIngestionService(store, indexer)

    result = service.process_pending_documents("claims-ingest-kb")

    assert result["status"] == "ready"
    assert result["document_count"] == 1
    assert result["chunk_count"] >= 1
    indexed = store.get_knowledge_document(document["document_id"])
    assert indexed["status"] == "indexed"
    assert indexed["chunk_count"] >= 1
```

- [ ] **Step 2: Run failing test**

Run:

```bash
uv run pytest tests/test_knowledge_ingestion.py::test_ingestion_service_indexes_text_file -q
```

Expected: FAIL because `knowledge_indexing` does not exist.

- [ ] **Step 3: Implement embedding providers and indexer**

Create `agent_governance/knowledge_indexing.py` with:

```python
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Protocol

from llama_index.core import SimpleDirectoryReader
from llama_index.core.node_parser import SentenceSplitter
from llama_index.embeddings.ollama import OllamaEmbedding

from agent_governance.settings import (
    DEFAULT_KB_CHUNK_OVERLAP,
    DEFAULT_KB_CHUNK_SIZE,
    DEFAULT_OLLAMA_BASE_URL,
    DEFAULT_OLLAMA_EMBED_MODEL,
)
from agent_governance.store import GovernanceStore


class EmbeddingProvider(Protocol):
    model_name: str

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError

    def embed_query(self, text: str) -> list[float]:
        raise NotImplementedError


class OllamaEmbeddingProvider:
    def __init__(
        self,
        model_name: str = DEFAULT_OLLAMA_EMBED_MODEL,
        base_url: str = DEFAULT_OLLAMA_BASE_URL,
    ) -> None:
        self.model_name = model_name
        self._embedding = OllamaEmbedding(model_name=model_name, base_url=base_url)

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return self._embedding.get_text_embedding_batch(texts)

    def embed_query(self, text: str) -> list[float]:
        return self._embedding.get_query_embedding(text)


class DeterministicEmbeddingProvider:
    def __init__(self, dimension: int = 768) -> None:
        self.model_name = "test/deterministic"
        self.dimension = dimension

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [self._embed(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._embed(text)

    def _embed(self, text: str) -> list[float]:
        digest = sha256(text.encode("utf-8")).digest()
        values = [(digest[index % len(digest)] / 255.0) for index in range(self.dimension)]
        return values


@dataclass(frozen=True)
class IndexedChunk:
    chunk_index: int
    content: str
    content_hash: str
    embedding: list[float]
    metadata: dict


class LlamaIndexKnowledgeIndexer:
    def __init__(
        self,
        *,
        embedding_provider: EmbeddingProvider | None = None,
        chunk_size: int = DEFAULT_KB_CHUNK_SIZE,
        chunk_overlap: int = DEFAULT_KB_CHUNK_OVERLAP,
    ) -> None:
        self.embedding_provider = embedding_provider or OllamaEmbeddingProvider()
        self.splitter = SentenceSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    def index_file(self, document: dict, kb: dict, source: dict) -> list[dict]:
        path = self._path_from_storage_uri(document["storage_uri"])
        documents = SimpleDirectoryReader(input_files=[path]).load_data()
        if not documents:
            raise ValueError("Parser produced no text")
        for parsed in documents:
            parsed.metadata.update(
                {
                    "kb_id": document["kb_id"],
                    "source_id": document["source_id"],
                    "document_id": document["document_id"],
                    "file_name": document["file_name"],
                    "source_display_name": source.get("display_name") or document["file_name"],
                    "environment": kb.get("environment"),
                    "sensitivity": kb.get("sensitivity"),
                    "embedding_model": self.embedding_provider.model_name,
                }
            )
        nodes = self.splitter.get_nodes_from_documents(documents)
        texts = [node.get_content().strip() for node in nodes if node.get_content().strip()]
        if not texts:
            raise ValueError("Parser produced no text")
        embeddings = self.embedding_provider.embed_texts(texts)
        chunks: list[dict] = []
        for index, (text, embedding) in enumerate(zip(texts, embeddings, strict=True)):
            metadata = dict(nodes[index].metadata)
            chunks.append(
                {
                    "chunk_index": index,
                    "content": text,
                    "content_hash": sha256(text.encode("utf-8")).hexdigest(),
                    "embedding": embedding,
                    "metadata": metadata,
                }
            )
        return chunks

    @staticmethod
    def _path_from_storage_uri(storage_uri: str) -> str:
        if not storage_uri.startswith("file://"):
            raise ValueError("Only local file storage URIs are supported")
        return str(Path(storage_uri.removeprefix("file://")))
```

- [ ] **Step 4: Implement ingestion service**

Append to `agent_governance/knowledge_indexing.py`:

```python
class KnowledgeIngestionService:
    def __init__(self, store: GovernanceStore, indexer: LlamaIndexKnowledgeIndexer) -> None:
        self.store = store
        self.indexer = indexer

    def process_pending_documents(self, kb_id: str) -> dict:
        kb = self.store.get_knowledge_base(kb_id)
        if not kb:
            raise ValueError(f"Knowledge base {kb_id!r} not found")
        documents = [
            document
            for document in self.store.list_knowledge_documents(kb_id)
            if document["status"] in {"uploaded", "queued", "failed"}
        ]
        sources = self.store.list_knowledge_sources(kb_id)
        if not documents:
            return self.store.create_knowledge_index_version(
                kb_id,
                {
                    "status": "pending",
                    "source_count": len(sources),
                    "document_count": 0,
                    "chunk_count": 0,
                    "embedding_model": self.indexer.embedding_provider.model_name,
                    "vector_backend": "pgvector",
                },
            )
        index = self.store.create_knowledge_index_version(
            kb_id,
            {
                "status": "indexing",
                "source_count": len(sources),
                "document_count": len(documents),
                "chunk_count": 0,
                "embedding_model": self.indexer.embedding_provider.model_name,
                "vector_backend": "pgvector",
            },
        )
        sources_by_id = {source["source_id"]: source for source in sources}
        for document in documents:
            try:
                self.store.mark_knowledge_document_status(document["document_id"], "parsing")
                source = sources_by_id[document["source_id"]]
                chunks = self.indexer.index_file(document, kb, source)
                self.store.mark_knowledge_document_status(document["document_id"], "embedding")
                self.store.replace_knowledge_chunks(
                    document["document_id"], index["index_version_id"], chunks
                )
                self.store.mark_knowledge_document_indexed(document["document_id"], len(chunks))
            except Exception as exc:
                self.store.mark_knowledge_document_status(
                    document["document_id"], "failed", str(exc)
                )
        return self.store.refresh_knowledge_base_index_state(kb_id, index["index_version_id"])
```

- [ ] **Step 5: Run ingestion service tests**

Run:

```bash
uv run pytest tests/test_knowledge_ingestion.py -q
```

Expected: all ingestion tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add agent_governance/knowledge_indexing.py tests/test_knowledge_ingestion.py
git commit -m "feat: index knowledge files with llamaindex"
```

Run GitNexus MCP `detect_changes({"repo":"intelliguard","scope":"staged"})` after `git add` and before `git commit`.

## Task 6: Pgvector Retrieval Service

**Files:**
- Modify: `agent_governance/knowledge.py`
- Modify: `tests/test_knowledge_ingestion.py`

- [ ] **Step 1: Run impact analysis**

Run GitNexus MCP impact:

```text
mcp__gitnexus__.impact({"repo":"intelliguard","target":"KBRetrieval","direction":"upstream"})
```

Expected baseline: LOW.

- [ ] **Step 2: Write failing retrieval filter test**

Append to `tests/test_knowledge_ingestion.py`:

```python
from agent_governance.knowledge import KnowledgeRetrievalService


def test_retrieval_service_filters_by_kb(store: GovernanceStore, tmp_path: Path) -> None:
    for kb_id, content in {
        "claims-kb-a": "Claims must be reviewed within two business days.",
        "claims-kb-b": "Travel expenses require manager approval.",
    }.items():
        path = tmp_path / f"{kb_id}.txt"
        path.write_text(content, encoding="utf-8")
        store.upsert_knowledge_base(
            {
                "kb_id": kb_id,
                "display_name": kb_id,
                "description": "",
                "source_type": "file",
                "source_config": {},
                "environment": "demo",
            }
        )
        source = store.upsert_knowledge_source(
            kb_id,
            {
                "source_type": "file",
                "display_name": kb_id,
                "uri": f"file://{path}",
                "content_type": "text/plain",
                "source_config": {},
            },
        )
        document = store.create_knowledge_document(
            kb_id,
            source["source_id"],
            {
                "file_name": path.name,
                "content_type": "text/plain",
                "storage_uri": f"file://{path}",
                "size_bytes": path.stat().st_size,
                "checksum": kb_id,
            },
        )
        indexer = LlamaIndexKnowledgeIndexer(
            embedding_provider=DeterministicEmbeddingProvider(dimension=768),
            chunk_size=128,
            chunk_overlap=20,
        )
        KnowledgeIngestionService(store, indexer).process_pending_documents(kb_id)
        assert store.get_knowledge_document(document["document_id"])["status"] == "indexed"

    retrieval = KnowledgeRetrievalService(
        store,
        embedding_provider=DeterministicEmbeddingProvider(dimension=768),
    )

    results = retrieval.query("claims-kb-a", "claims review", "demo", top_k=5)

    assert results
    assert {result.metadata["kb_id"] for result in results} == {"claims-kb-a"}
    assert all("claims-kb-b" not in result.metadata.get("file_name", "") for result in results)
```

- [ ] **Step 3: Run failing retrieval test**

Run:

```bash
uv run pytest tests/test_knowledge_ingestion.py::test_retrieval_service_filters_by_kb -q
```

Expected: FAIL because `KnowledgeRetrievalService` does not exist.

- [ ] **Step 4: Implement retrieval service**

Replace `agent_governance/knowledge.py` with a pgvector-backed service while preserving `RetrievedDoc`:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from agent_governance.knowledge_indexing import EmbeddingProvider, OllamaEmbeddingProvider
from agent_governance.models import KnowledgeChunk
from agent_governance.store import GovernanceStore


@dataclass
class RetrievedDoc:
    content: str
    score: float
    metadata: dict[str, Any]


class KnowledgeRetrievalService:
    def __init__(
        self,
        store: GovernanceStore,
        embedding_provider: EmbeddingProvider | None = None,
    ) -> None:
        self.store = store
        self.embedding_provider = embedding_provider or OllamaEmbeddingProvider()

    def query(
        self,
        kb_id: str,
        query: str,
        environment: str,
        top_k: int = 5,
        metadata_filters: dict[str, Any] | None = None,
        score_threshold: float | None = None,
    ) -> list[RetrievedDoc]:
        query_embedding = self.embedding_provider.embed_query(query)
        filters = metadata_filters or {}
        with self.store.session() as db:
            distance = KnowledgeChunk.embedding.cosine_distance(query_embedding)
            stmt = (
                select(
                    KnowledgeChunk,
                    distance.label("distance"),
                )
                .where(KnowledgeChunk.kb_id == kb_id)
                .order_by(distance)
                .limit(top_k * 3)
            )
            rows = db.execute(stmt).all()
        docs: list[RetrievedDoc] = []
        for chunk, distance in rows:
            metadata = dict(chunk.metadata_json or {})
            if metadata.get("environment") != environment:
                continue
            if not self._metadata_matches(metadata, filters):
                continue
            score = max(0.0, 1.0 - float(distance or 0.0))
            if score_threshold is not None and score < score_threshold:
                continue
            docs.append(
                RetrievedDoc(
                    content=chunk.content,
                    score=score,
                    metadata={
                        **metadata,
                        "kb_id": chunk.kb_id,
                        "source_id": chunk.source_id,
                        "document_id": chunk.document_id,
                        "chunk_id": chunk.chunk_id,
                    },
                )
            )
            if len(docs) >= top_k:
                break
        return docs

    @staticmethod
    def _metadata_matches(metadata: dict[str, Any], filters: dict[str, Any]) -> bool:
        return all(metadata.get(key) == value for key, value in filters.items())


class KBRetrieval(KnowledgeRetrievalService):
    """Backward-compatible alias for existing imports."""
```

- [ ] **Step 5: Run retrieval tests**

Run:

```bash
uv run pytest tests/test_knowledge_ingestion.py tests/test_knowledge_bases.py -q
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add agent_governance/knowledge.py tests/test_knowledge_ingestion.py
git commit -m "feat: retrieve knowledge chunks from pgvector"
```

Run GitNexus MCP `detect_changes({"repo":"intelliguard","scope":"staged"})` after `git add` and before `git commit`.

## Task 7: API Upload, Documents, Sync, And Query

**Files:**
- Modify: `api/main.py`
- Modify: `tests/test_knowledge_bases.py`

- [ ] **Step 1: Run API impact analysis**

Run GitNexus MCP API impact before editing route handlers:

```text
mcp__gitnexus__.api_impact({"repo":"intelliguard","route":"/v1/knowledge-bases/{kb_id}/sync"})
mcp__gitnexus__.api_impact({"repo":"intelliguard","route":"/v1/knowledge-bases/{kb_id}/query"})
```

Expected baseline: LOW. Also run impact for `create_knowledge_sync_status` and `query_knowledge_base` if GitNexus resolves them.

- [ ] **Step 2: Write failing API tests**

Append to `tests/test_knowledge_bases.py`:

```python
from starlette.datastructures import UploadFile
from starlette.datastructures import Headers
from io import BytesIO
import anyio


def test_upload_knowledge_file_creates_source_and_document(monkeypatch, store: GovernanceStore, tmp_path) -> None:
    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "DEFAULT_KB_UPLOAD_DIR", str(tmp_path))
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-upload-kb",
            "display_name": "Claims Upload KB",
            "description": "",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )
    upload = UploadFile(
        filename="claims.txt",
        file=BytesIO(b"Claims upload text."),
        headers=Headers({"content-type": "text/plain"}),
    )

    document = anyio.run(
        api_main.upload_knowledge_file,
        "claims-upload-kb",
        upload,
        _super_admin_user(),
    )

    assert document["file_name"] == "claims.txt"
    assert document["status"] == "uploaded"
    assert store.list_knowledge_sources("claims-upload-kb")[0]["source_type"] == "file"


def test_query_knowledge_base_uses_retrieval_service(monkeypatch, store: GovernanceStore) -> None:
    class FakeRetrieval:
        def __init__(self, _store):
            pass

        def query(self, kb_id, query, environment, top_k=5):
            return [
                api_main.RetrievedDoc(
                    content=f"{kb_id}:{query}:{environment}",
                    score=0.9,
                    metadata={"kb_id": kb_id, "chunk_id": "chunk_1"},
                )
            ]

    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "KnowledgeRetrievalService", FakeRetrieval)
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-query-kb",
            "display_name": "Claims Query KB",
            "description": "",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )

    results = api_main.query_knowledge_base(
        "claims-query-kb",
        api_main.KBQueryRequest(query="review", top_k=3),
        _super_admin_user(),
    )

    assert results == [
        {
            "content": "claims-query-kb:review:demo",
            "score": 0.9,
            "metadata": {"kb_id": "claims-query-kb", "chunk_id": "chunk_1"},
        }
    ]
```

- [ ] **Step 3: Run failing API tests**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py::test_upload_knowledge_file_creates_source_and_document tests/test_knowledge_bases.py::test_query_knowledge_base_uses_retrieval_service -q
```

Expected: FAIL because upload route and module imports are missing.

- [ ] **Step 4: Add imports and upload route**

In `api/main.py`, import:

```python
from fastapi import File, UploadFile
from agent_governance.knowledge import KnowledgeRetrievalService, RetrievedDoc
from agent_governance.knowledge_indexing import KnowledgeIngestionService, LlamaIndexKnowledgeIndexer
from agent_governance.knowledge_storage import KnowledgeFileStorage
from agent_governance.settings import DEFAULT_KB_UPLOAD_DIR
```

Add endpoint near other KB endpoints:

```python
@app.post("/v1/knowledge-bases/{kb_id}/files")
async def upload_knowledge_file(
    kb_id: str,
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "agent:create")
    data = await file.read()
    try:
        stored = KnowledgeFileStorage(DEFAULT_KB_UPLOAD_DIR).save_upload(
            kb_id=kb_id,
            file_name=file.filename or "upload.txt",
            content_type=file.content_type or "",
            data=data,
        )
        source = store.upsert_knowledge_source(
            kb_id,
            {
                "source_type": "file",
                "display_name": stored.file_name,
                "uri": stored.storage_uri,
                "content_type": stored.content_type,
                "source_config": {"checksum": stored.checksum},
                "status": "pending",
            },
        )
        return store.create_knowledge_document(
            kb_id,
            source["source_id"],
            {
                "file_name": stored.file_name,
                "content_type": stored.content_type,
                "storage_uri": stored.storage_uri,
                "size_bytes": stored.size_bytes,
                "checksum": stored.checksum,
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
```

If direct unit tests call this async function awkwardly, split the body into a synchronous helper `_create_knowledge_file_record` and test that helper.

- [ ] **Step 5: Add documents endpoint**

Add:

```python
@app.get("/v1/knowledge-bases/{kb_id}/documents")
def list_knowledge_documents(
    kb_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "read")
    return store.list_knowledge_documents(kb_id)
```

- [ ] **Step 6: Wire sync to ingestion**

Replace the body of `create_knowledge_sync_status` after permission checks:

```python
    try:
        return KnowledgeIngestionService(
            store,
            LlamaIndexKnowledgeIndexer(),
        ).process_pending_documents(kb_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
```

- [ ] **Step 7: Wire query to retrieval**

Replace the try/import block in `query_knowledge_base` with:

```python
    docs = KnowledgeRetrievalService(store).query(
        kb_id, body.query, kb["environment"], top_k=body.top_k
    )
    return [{"content": d.content, "score": d.score, "metadata": d.metadata} for d in docs]
```

- [ ] **Step 8: Run API tests**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py tests/test_knowledge_ingestion.py -q
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add api/main.py tests/test_knowledge_bases.py
git commit -m "feat: expose knowledge file ingestion api"
```

Run GitNexus MCP `detect_changes({"repo":"intelliguard","scope":"staged"})` after `git add` and before `git commit`.

## Task 8: Worker Command

**Files:**
- Create: `agent_governance/knowledge_worker.py`
- Modify: `tests/test_knowledge_ingestion.py`

- [ ] **Step 1: Write worker unit test**

Append to `tests/test_knowledge_ingestion.py`:

```python
import agent_governance.knowledge_worker as knowledge_worker


def test_worker_process_once_invokes_ingestion(monkeypatch) -> None:
    calls: list[str] = []

    class FakeStore:
        def list_knowledge_bases(self, environment=None):
            return [{"kb_id": "claims-worker-kb"}]

    class FakeService:
        def __init__(self, store, indexer):
            pass

        def process_pending_documents(self, kb_id: str):
            calls.append(kb_id)
            return {"kb_id": kb_id, "status": "ready"}

    monkeypatch.setattr(knowledge_worker, "GovernanceStore", lambda _url: FakeStore())
    monkeypatch.setattr(knowledge_worker, "KnowledgeIngestionService", FakeService)
    monkeypatch.setattr(knowledge_worker, "LlamaIndexKnowledgeIndexer", lambda: object())

    processed = knowledge_worker.process_once("postgresql://example")

    assert processed == 1
    assert calls == ["claims-worker-kb"]
```

- [ ] **Step 2: Create worker module**

Create `agent_governance/knowledge_worker.py`:

```python
from __future__ import annotations

import os
import time

from agent_governance.db import init_db
from agent_governance.knowledge_indexing import KnowledgeIngestionService, LlamaIndexKnowledgeIndexer
from agent_governance.settings import DEFAULT_DATABASE_URL
from agent_governance.store import GovernanceStore


def process_once(database_url: str = DEFAULT_DATABASE_URL) -> int:
    store = GovernanceStore(database_url)
    service = KnowledgeIngestionService(store, LlamaIndexKnowledgeIndexer())
    processed = 0
    for kb in store.list_knowledge_bases():
        result = service.process_pending_documents(kb["kb_id"])
        if result.get("document_count") or result.get("chunk_count"):
            processed += 1
    return processed


def main() -> None:
    database_url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
    init_db(database_url)
    interval_seconds = int(os.getenv("KB_WORKER_INTERVAL_SECONDS", "15"))
    while True:
        process_once(database_url)
        time.sleep(interval_seconds)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run worker test**

Run:

```bash
uv run pytest tests/test_knowledge_ingestion.py::test_worker_process_once_invokes_ingestion -q
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add agent_governance/knowledge_worker.py tests/test_knowledge_ingestion.py
git commit -m "feat: add knowledge ingestion worker"
```

Run GitNexus MCP `detect_changes({"repo":"intelliguard","scope":"staged"})` after `git add` and before `git commit`.

## Task 9: Dashboard Upload And Document Status

**Files:**
- Modify: `dashboard/lib/api.ts`
- Modify: `dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx`

- [ ] **Step 1: Run impact analysis**

Run GitNexus MCP impact:

```text
mcp__gitnexus__.impact({"repo":"intelliguard","target":"KnowledgeBasesWorkspace","direction":"upstream"})
```

Expected baseline: LOW.

- [ ] **Step 2: Add API helpers**

In `dashboard/lib/api.ts`, add:

```ts
export function listKnowledgeDocuments(token: string, kbId: string) {
  return request<ApiRecord[]>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents`, {
    headers: authHeaders(token),
  });
}

export function uploadKnowledgeFile(token: string, kbId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return request<ApiRecord>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/files`, {
    method: "POST",
    headers: authHeaders(token),
    body,
  });
}
```

If `request` forces `Content-Type: application/json`, update it so FormData requests do not set a JSON content type:

```ts
const isFormData = options.body instanceof FormData;
const headers = {
  ...(isFormData ? {} : { "Content-Type": "application/json" }),
  ...(options.headers || {}),
};
```

- [ ] **Step 3: Update imports and state**

In `KnowledgeBasesWorkspace.tsx`, import `listKnowledgeDocuments` and `uploadKnowledgeFile`. Add state:

```tsx
const [selectedDocuments, setSelectedDocuments] = useState<ApiRecord[]>([]);
const [selectedFile, setSelectedFile] = useState<File | null>(null);
```

Add documents to the detail loader:

```tsx
Promise.all([
  getKnowledgeBaseDetail(session.token, selectedKbId),
  listKnowledgeSources(session.token, selectedKbId),
  listKnowledgeDocuments(session.token, selectedKbId),
])
  .then(([detail, sources, documents]) => {
    if (requestId !== detailRequestIdRef.current || selectedKbIdRef.current !== selectedKbId) {
      return;
    }
    setSelectedKbDetail(detail);
    setSelectedSources(sources);
    setSelectedDocuments(documents);
  })
```

Clear documents when selection changes:

```tsx
setSelectedDocuments([]);
```

- [ ] **Step 4: Add upload handler**

Add:

```tsx
async function uploadSelectedFile() {
  if (!selectedKbIdValue || !selectedFile) {
    setMessage("Select a knowledge base and file before uploading.");
    return;
  }

  await withToken(async (token) => {
    await uploadKnowledgeFile(token, selectedKbIdValue, selectedFile);
    setMessage("File uploaded. Refresh the index to ingest it.");
    setSelectedFile(null);
    await onRefresh();
    setDetailRefreshNonce((value) => value + 1);
  });
}
```

- [ ] **Step 5: Replace file source URI input with file picker**

In the source form area, when `sourceForm.source_type === "file"`, render:

```tsx
<label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
  File
  <input
    className="field-input"
    type="file"
    accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
  />
</label>
<button
  className="inline-flex w-fit items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
  type="button"
  onClick={uploadSelectedFile}
  disabled={!selectedKb || !selectedFile}
>
  <UploadCloud size={16} aria-hidden="true" />
  Upload file
</button>
```

Keep the existing URI/content-type fields only for `url` and `vector_store` source types.

- [ ] **Step 6: Show documents**

Add a "Documents" block next to "Sources":

```tsx
<div className="rounded-2xl border border-line bg-white/[0.035] p-4">
  <p className="font-semibold text-textPrimary">Documents</p>
  <div className="mt-3 grid gap-2">
    {selectedDocuments.length ? (
      selectedDocuments.map((document) => (
        <ComponentRow
          key={readText(document, ["document_id"]) || readText(document, ["file_name"])}
          title={readText(document, ["file_name"]) || "Knowledge document"}
          detail={
            joinParts([
              readText(document, ["content_type"]),
              formatCount(numberValue(document, ["chunk_count"]), "chunk"),
              readText(document, ["last_error"]),
            ]) || "Waiting for ingestion."
          }
          meta={readText(document, ["status"])}
        />
      ))
    ) : (
      <ComponentRow title="No documents uploaded" detail="Upload a file source before refreshing the index." />
    )}
  </div>
</div>
```

- [ ] **Step 7: Show citation metadata in query results**

Change query result metadata:

```tsx
meta={joinParts([
  readText(readRecord(result, "metadata") || {}, ["file_name", "source_display_name"]),
  readText(readRecord(result, "metadata") || {}, ["chunk_id"]),
  readText(result, ["score"]),
])}
```

- [ ] **Step 8: Run frontend checks**

Run:

```bash
cd dashboard && npx tsc --noEmit
cd dashboard && npm run build
```

Expected: both pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add dashboard/lib/api.ts dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx
git commit -m "feat: upload and inspect knowledge documents"
```

Run GitNexus MCP `detect_changes({"repo":"intelliguard","scope":"staged"})` after `git add` and before `git commit`.

## Task 10: Full Verification And Docker Smoke Test

**Files:**
- No planned source edits unless verification exposes a defect.

- [ ] **Step 1: Run backend tests**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py tests/test_knowledge_ingestion.py tests/test_store_governance.py tests/evaluation/test_agent_evaluators.py -q
```

Expected: all tests pass.

- [ ] **Step 2: Run lint**

Run:

```bash
uv run ruff check .
```

Expected: `All checks passed!`

- [ ] **Step 3: Run frontend checks**

Run:

```bash
cd dashboard && npx tsc --noEmit
cd dashboard && npm run build
```

Expected: both pass.

- [ ] **Step 4: Ensure Ollama model exists**

Run on the host:

```bash
ollama pull nomic-embed-text
ollama list | rg nomic-embed-text
```

Expected: `nomic-embed-text` appears in `ollama list`.

- [ ] **Step 5: Rebuild Docker stack**

Run:

```bash
docker compose up -d --build postgres api kb-worker dashboard
docker compose ps
```

Expected: `postgres`, `api`, `kb-worker`, and `dashboard` are running or healthy. If Postgres was previously created from `postgres:16-alpine`, recreate the volume after confirming with the user because changing the database image may require a clean volume for extension availability.

- [ ] **Step 6: Browser smoke test**

Open `http://localhost:5175/platform/?view=knowledge-bases`.

Perform:

1. Create KB `claims-live-kb`.
2. Select source type `File`.
3. Upload a `.txt` file containing `Claims over 10000 require senior approval.`
4. Click `Refresh index`.
5. Query `What claims require senior approval?`

Expected:

- Documents list shows uploaded file as `indexed`.
- KB chunk count is at least `1`.
- Query returns a snippet containing `senior approval`.
- Result metadata includes `file_name` and `chunk_id`.

- [ ] **Step 7: Run GitNexus detect changes**

Run:

```text
mcp__gitnexus__.detect_changes({"repo":"intelliguard","scope":"all"})
```

Expected: changed symbols match this plan. Review any unexpected affected process before final response.

## Execution Notes

- Keep unrelated dirty files out of commits unless they are intentionally part of this feature.
- Use `apply_patch` for manual edits.
- Do not remove the existing KB create/select/test structure; make it perform real upload, indexing, and retrieval work.
- Preserve existing assignment policy fields in `SelectedAgentModal`.
- If LlamaIndex reader support for a given file type fails, show a concrete failed document status and keep `.txt` ingestion working before extending parsers.
