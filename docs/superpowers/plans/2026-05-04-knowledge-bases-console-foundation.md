# Knowledge Bases Console Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw Knowledge Bases JSON page with a governed KB console backed by source metadata, index status, richer agent assignment settings, and a retrieval tester.

**Architecture:** Keep the current `KnowledgeBase` and `AgentKBAssignment` concepts, then add source/index metadata as first-class backend resources. The frontend gets a dedicated Knowledge Bases workspace that uses structured forms and existing platform surface components. Real file parsing/vector indexing remains out of scope for this first plan; source and index records are stored and displayed so later ingestion work has stable contracts.

**Tech Stack:** FastAPI, SQLAlchemy, PostgreSQL JSONB, Pydantic v2, pytest, Next.js App Router, React/TSX, Tailwind, lucide-react.

---

## File Structure

- Modify: `intelliguard/models.py`
  - Extend `KnowledgeBase` and `AgentKBAssignment`.
  - Add `KnowledgeSource` and `KnowledgeIndexVersion`.
- Modify: `intelliguard/store.py`
  - Add KB source/index CRUD and richer KB summaries.
  - Update KB assignment upsert/dict methods.
- Modify: `api/main.py`
  - Add request models and source/index/query endpoints.
- Modify: `dashboard/lib/api.ts`
  - Add typed helper functions for KB detail, source creation, sync status, and query.
- Create: `dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx`
  - Own the KB console UI.
- Modify: `dashboard/app/platform/_components/WorkspaceViewContent.tsx`
  - Route `knowledge-bases` to the dedicated workspace.
- Modify: `dashboard/app/platform/_components/SelectedAgentModal.tsx`
  - Add retrieval settings when attaching KBs and display KB health.
- Modify: `dashboard/app/platform/_components/config.ts`
  - Replace the old KB JSON template with source-aware defaults if still used elsewhere.
- Test: `tests/test_knowledge_bases.py`
  - Cover store and API-independent lifecycle behavior.

---

### Task 1: Backend Models

**Files:**
- Modify: `intelliguard/models.py`
- Test: `tests/test_knowledge_bases.py`

- [ ] **Step 1: Write failing model tests**

Add this file:

```python
from __future__ import annotations

from intelliguard.models import AgentKBAssignment, KnowledgeBase, KnowledgeIndexVersion, KnowledgeSource


def test_knowledge_models_are_declared() -> None:
    assert KnowledgeBase.__tablename__ == "knowledge_bases"
    assert KnowledgeSource.__tablename__ == "knowledge_sources"
    assert KnowledgeIndexVersion.__tablename__ == "knowledge_index_versions"
    assert AgentKBAssignment.__tablename__ == "agent_kb_assignments"
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py::test_knowledge_models_are_declared -q
```

Expected: import fails because `KnowledgeSource` and `KnowledgeIndexVersion` do not exist.

- [ ] **Step 3: Add model fields and tables**

In `intelliguard/models.py`, extend `KnowledgeBase` with:

```python
    owner: Mapped[str] = mapped_column(String(120), nullable=False, default="Unassigned")
    domain: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    sensitivity: Mapped[str] = mapped_column(String(40), nullable=False, default="internal")
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="draft")
    document_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
```

Extend `AgentKBAssignment` with:

```python
    retrieval_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="hybrid")
    top_k: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    score_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    citation_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    freshness_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_filters: Mapped[dict] = mapped_column(JSONB, default=dict)
```

Add:

```python
class KnowledgeSource(Base):
    __tablename__ = "knowledge_sources"

    source_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.kb_id"), nullable=False)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    uri: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_type: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    source_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="pending")
    checksum: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class KnowledgeIndexVersion(Base):
    __tablename__ = "knowledge_index_versions"

    index_version_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.kb_id"), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="pending")
    source_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    document_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    embedding_model: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    vector_backend: Mapped[str] = mapped_column(String(80), nullable=False, default="local")
    artifact_digest: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

Ensure `Integer`, `Float`, and `Boolean` are imported from SQLAlchemy if missing.

- [ ] **Step 4: Run the model test**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py::test_knowledge_models_are_declared -q
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add intelliguard/models.py tests/test_knowledge_bases.py
git commit -m "feat: add knowledge source models"
```

---

### Task 2: Store Lifecycle Methods

**Files:**
- Modify: `intelliguard/store.py`
- Modify: `tests/test_knowledge_bases.py`

- [ ] **Step 1: Add failing store lifecycle tests**

Append:

```python
from intelliguard.store import GovernanceStore


def test_knowledge_base_source_and_index_lifecycle(store: GovernanceStore) -> None:
    kb = store.upsert_knowledge_base(
        {
            "kb_id": "claims-policy-kb",
            "display_name": "Claims Policy KB",
            "description": "Claims operating procedures.",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
            "owner": "Claims Ops",
            "domain": "claims",
            "sensitivity": "internal",
        }
    )

    assert kb["owner"] == "Claims Ops"
    assert kb["status"] == "draft"

    source = store.upsert_knowledge_source(
        "claims-policy-kb",
        {
            "source_type": "file",
            "display_name": "Claims SOP",
            "uri": "file://claims-sop.pdf",
            "content_type": "application/pdf",
            "source_config": {"parser": "pdf"},
        },
    )

    assert source["kb_id"] == "claims-policy-kb"
    assert source["status"] == "pending"
    assert len(store.list_knowledge_sources("claims-policy-kb")) == 1

    index = store.create_knowledge_index_version(
        "claims-policy-kb",
        {
            "status": "ready",
            "source_count": 1,
            "document_count": 1,
            "chunk_count": 12,
            "embedding_model": "local/test-embedding",
            "vector_backend": "local",
        },
    )

    assert index["status"] == "ready"
    detailed = store.get_knowledge_base_detail("claims-policy-kb")
    assert detailed["source_count"] == 1
    assert detailed["latest_index"]["chunk_count"] == 12
```

- [ ] **Step 2: Run the failing lifecycle test**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py::test_knowledge_base_source_and_index_lifecycle -q
```

Expected: fail because the new store methods are undefined.

- [ ] **Step 3: Implement store methods**

In `intelliguard/store.py`, import `KnowledgeSource` and `KnowledgeIndexVersion`.

Update `_kb_to_dict` so it includes the new KB fields:

```python
            "owner": row.owner,
            "domain": row.domain,
            "sensitivity": row.sensitivity,
            "status": row.status,
            "document_count": row.document_count,
            "chunk_count": row.chunk_count,
            "last_indexed_at": row.last_indexed_at.isoformat() if row.last_indexed_at else None,
            "last_error": row.last_error,
```

Update `upsert_knowledge_base` create/update paths to populate `owner`, `domain`, `sensitivity`, and `status`.

Add methods:

```python
    def get_knowledge_base_detail(self, kb_id: str) -> dict[str, Any] | None:
        with self.session() as db:
            row = db.get(KnowledgeBase, kb_id)
            if not row:
                return None
            payload = self._kb_to_dict(row)
            sources = db.scalars(
                select(KnowledgeSource)
                .where(KnowledgeSource.kb_id == kb_id)
                .order_by(KnowledgeSource.created_at.desc())
            ).all()
            latest_index = db.scalar(
                select(KnowledgeIndexVersion)
                .where(KnowledgeIndexVersion.kb_id == kb_id)
                .order_by(KnowledgeIndexVersion.created_at.desc())
            )
            assignments = db.scalars(
                select(AgentKBAssignment).where(AgentKBAssignment.kb_id == kb_id)
            ).all()
            payload["source_count"] = len(sources)
            payload["assigned_agent_count"] = len(assignments)
            payload["latest_index"] = self._kb_index_to_dict(latest_index) if latest_index else None
            return payload

    def list_knowledge_sources(self, kb_id: str) -> list[dict[str, Any]]:
        with self.session() as db:
            rows = db.scalars(
                select(KnowledgeSource)
                .where(KnowledgeSource.kb_id == kb_id)
                .order_by(KnowledgeSource.display_name)
            ).all()
            return [self._kb_source_to_dict(row) for row in rows]

    def upsert_knowledge_source(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            source_id = payload.get("source_id") or new_id("kbs")
            row = db.get(KnowledgeSource, source_id)
            if not row:
                row = KnowledgeSource(
                    source_id=source_id,
                    kb_id=kb_id,
                    source_type=payload["source_type"],
                    display_name=payload["display_name"],
                    uri=payload.get("uri") or "",
                    content_type=payload.get("content_type") or "",
                    source_config=payload.get("source_config") or {},
                )
                db.add(row)
            else:
                row.source_type = payload["source_type"]
                row.display_name = payload["display_name"]
                row.uri = payload.get("uri") or ""
                row.content_type = payload.get("content_type") or ""
                row.source_config = payload.get("source_config") or {}
                row.status = payload.get("status") or row.status
                row.updated_at = utc_now()
            db.flush()
            return self._kb_source_to_dict(row)

    def create_knowledge_index_version(self, kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.session() as db:
            row = KnowledgeIndexVersion(
                index_version_id=new_id("kbi"),
                kb_id=kb_id,
                status=payload.get("status") or "pending",
                source_count=int(payload.get("source_count") or 0),
                document_count=int(payload.get("document_count") or 0),
                chunk_count=int(payload.get("chunk_count") or 0),
                embedding_model=payload.get("embedding_model") or "",
                vector_backend=payload.get("vector_backend") or "local",
                artifact_digest=payload.get("artifact_digest"),
                error=payload.get("error"),
                completed_at=utc_now() if payload.get("status") == "ready" else None,
            )
            db.add(row)
            kb = db.get(KnowledgeBase, kb_id)
            if kb and row.status == "ready":
                kb.status = "ready"
                kb.document_count = row.document_count
                kb.chunk_count = row.chunk_count
                kb.last_indexed_at = row.completed_at
                kb.last_error = None
                kb.updated_at = utc_now()
            db.flush()
            return self._kb_index_to_dict(row)
```

Add dict helpers:

```python
    @staticmethod
    def _kb_source_to_dict(row: KnowledgeSource | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "source_id": row.source_id,
            "kb_id": row.kb_id,
            "source_type": row.source_type,
            "display_name": row.display_name,
            "uri": row.uri,
            "content_type": row.content_type,
            "source_config": row.source_config or {},
            "status": row.status,
            "checksum": row.checksum,
            "last_synced_at": row.last_synced_at.isoformat() if row.last_synced_at else None,
            "last_error": row.last_error,
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
        }

    @staticmethod
    def _kb_index_to_dict(row: KnowledgeIndexVersion | None) -> dict[str, Any]:
        if not row:
            return {}
        return {
            "index_version_id": row.index_version_id,
            "kb_id": row.kb_id,
            "status": row.status,
            "source_count": row.source_count,
            "document_count": row.document_count,
            "chunk_count": row.chunk_count,
            "embedding_model": row.embedding_model,
            "vector_backend": row.vector_backend,
            "artifact_digest": row.artifact_digest,
            "error": row.error,
            "created_at": row.created_at.isoformat(),
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        }
```

- [ ] **Step 4: Run lifecycle tests**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py -q
```

Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add intelliguard/store.py tests/test_knowledge_bases.py
git commit -m "feat: add knowledge source store lifecycle"
```

---

### Task 3: Rich Agent KB Assignment Settings

**Files:**
- Modify: `intelliguard/store.py`
- Modify: `api/main.py`
- Modify: `tests/test_knowledge_bases.py`

- [ ] **Step 1: Add failing assignment test**

Append:

```python
def test_agent_kb_assignment_stores_retrieval_policy(store: GovernanceStore) -> None:
    store.upsert_knowledge_base(
        {
            "kb_id": "policy-kb",
            "display_name": "Policy KB",
            "description": "",
            "source_type": "vector_store",
            "source_config": {},
            "environment": "demo",
        }
    )

    assignment = store.upsert_agent_kb_assignment(
        agent_id="customer-support-agent",
        kb_id="policy-kb",
        access_mode="read",
        retrieval_mode="hybrid",
        top_k=8,
        score_threshold=0.72,
        citation_required=True,
        freshness_days=30,
        metadata_filters={"doc_type": "policy"},
    )

    assert assignment["retrieval_mode"] == "hybrid"
    assert assignment["top_k"] == 8
    assert assignment["metadata_filters"] == {"doc_type": "policy"}
```

- [ ] **Step 2: Run the failing assignment test**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py::test_agent_kb_assignment_stores_retrieval_policy -q
```

Expected: fail because `upsert_agent_kb_assignment` does not accept retrieval settings.

- [ ] **Step 3: Extend store assignment method**

Change the signature to:

```python
    def upsert_agent_kb_assignment(
        self,
        *,
        agent_id: str,
        kb_id: str,
        access_mode: str,
        retrieval_mode: str = "hybrid",
        top_k: int = 5,
        score_threshold: float | None = None,
        citation_required: bool = True,
        freshness_days: int | None = None,
        metadata_filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
```

On create and update, set:

```python
                retrieval_mode=retrieval_mode,
                top_k=top_k,
                score_threshold=score_threshold,
                citation_required=citation_required,
                freshness_days=freshness_days,
                metadata_filters=metadata_filters or {},
```

Update `_kb_assignment_to_dict` with:

```python
            "retrieval_mode": row.retrieval_mode,
            "top_k": row.top_k,
            "score_threshold": row.score_threshold,
            "citation_required": row.citation_required,
            "freshness_days": row.freshness_days,
            "metadata_filters": row.metadata_filters or {},
```

- [ ] **Step 4: Extend API request model and endpoint call**

In `api/main.py`, change `AgentKBAssignmentRequest` to:

```python
class AgentKBAssignmentRequest(BaseModel):
    kb_id: str
    access_mode: str = Field(pattern="^(read|read_write)$", default="read")
    retrieval_mode: str = Field(pattern="^(semantic|keyword|hybrid)$", default="hybrid")
    top_k: int = Field(default=5, ge=1, le=50)
    score_threshold: float | None = Field(default=None, ge=0, le=1)
    citation_required: bool = True
    freshness_days: int | None = Field(default=None, ge=1, le=3650)
    metadata_filters: dict[str, Any] = Field(default_factory=dict)
```

Pass all fields into `store.upsert_agent_kb_assignment(...)`.

- [ ] **Step 5: Run tests**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py tests/evaluation/test_agent_evaluators.py -q
```

Expected: pass. Agent evaluator config hashes should continue to include `kb_id`.

- [ ] **Step 6: Commit**

```bash
git add intelliguard/store.py api/main.py tests/test_knowledge_bases.py
git commit -m "feat: store agent knowledge retrieval policy"
```

---

### Task 4: Knowledge Source API Endpoints

**Files:**
- Modify: `api/main.py`
- Modify: `dashboard/lib/api.ts`

- [ ] **Step 1: Add Pydantic request models**

In `api/main.py`, add near `KnowledgeBaseRequest`:

```python
class KnowledgeSourceRequest(BaseModel):
    source_id: str | None = None
    source_type: str = Field(pattern="^(vector_store|url|file)$")
    display_name: str
    uri: str = ""
    content_type: str = ""
    source_config: dict[str, Any] = Field(default_factory=dict)


class KnowledgeSyncRequest(BaseModel):
    embedding_model: str = "local/default"
    vector_backend: str = "local"
```

- [ ] **Step 2: Add endpoints**

Add:

```python
@app.get("/v1/knowledge-bases/{kb_id}")
def get_knowledge_base_detail(
    kb_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "read")
    detail = store.get_knowledge_base_detail(kb_id)
    return detail or {}


@app.get("/v1/knowledge-bases/{kb_id}/sources")
def list_knowledge_sources(
    kb_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> list[dict[str, Any]]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "read")
    return store.list_knowledge_sources(kb_id)


@app.post("/v1/knowledge-bases/{kb_id}/sources")
def create_knowledge_source(
    kb_id: str,
    body: KnowledgeSourceRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "agent:create")
    return store.upsert_knowledge_source(kb_id, body.model_dump(exclude_none=True))


@app.post("/v1/knowledge-bases/{kb_id}/sync")
def create_knowledge_sync_status(
    kb_id: str,
    body: KnowledgeSyncRequest,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "agent:create")
    sources = store.list_knowledge_sources(kb_id)
    return store.create_knowledge_index_version(
        kb_id,
        {
            "status": "ready" if sources else "pending",
            "source_count": len(sources),
            "document_count": len(sources),
            "chunk_count": len(sources),
            "embedding_model": body.embedding_model,
            "vector_backend": body.vector_backend,
        },
    )
```

- [ ] **Step 3: Add frontend API helpers**

In `dashboard/lib/api.ts`, add:

```ts
export type KnowledgeSourcePayload = {
  source_id?: string;
  source_type: "vector_store" | "url" | "file";
  display_name: string;
  uri?: string;
  content_type?: string;
  source_config?: ApiRecord;
};

export function getKnowledgeBaseDetail(token: string, kbId: string) {
  return request<ApiRecord>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}`, {
    headers: authHeaders(token),
  });
}

export function listKnowledgeSources(token: string, kbId: string) {
  return request<ApiRecord[]>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/sources`, {
    headers: authHeaders(token),
  });
}

export function createKnowledgeSource(token: string, kbId: string, payload: KnowledgeSourcePayload) {
  return request<ApiRecord>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/sources`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function syncKnowledgeBase(token: string, kbId: string) {
  return request<ApiRecord>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/sync`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ embedding_model: "local/default", vector_backend: "local" }),
  });
}

export function queryKnowledgeBase(token: string, kbId: string, payload: { query: string; top_k: number }) {
  return request<ApiRecord[]>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/query`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}
```

- [ ] **Step 4: Verify backend and frontend type checks**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py -q
npx tsc --noEmit
```

Run `npx tsc --noEmit` from `dashboard/`.

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add api/main.py dashboard/lib/api.ts
git commit -m "feat: expose knowledge source APIs"
```

---

### Task 5: Dedicated Knowledge Bases Workspace

**Files:**
- Create: `dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx`
- Modify: `dashboard/app/platform/_components/WorkspaceViewContent.tsx`

- [ ] **Step 1: Run impact before editing symbols**

Run GitNexus impact:

```text
gitnexus_impact({ target: "WorkspaceViewContent", direction: "upstream", repo: "intelliguard" })
```

Expected: low or medium risk. If high or critical, stop and report before editing.

- [ ] **Step 2: Create the workspace component**

Create `dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx` with:

```tsx
"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { Database, FileText, Link2, Search, Server, UploadCloud } from "lucide-react";
import {
  createKnowledgeBase,
  createKnowledgeSource,
  getSession,
  queryKnowledgeBase,
  syncKnowledgeBase,
  type ApiRecord,
  type KnowledgeSourcePayload,
  type PlatformData,
} from "@/lib/api";
import { ComponentRow, MetricSurface, PlatformSurface } from "./shared";
import { formatCount, joinParts, readText } from "./utils";

type SourceType = "file" | "url" | "vector_store";

const sourceTypeOptions: Array<{ label: string; value: SourceType }> = [
  { label: "File", value: "file" },
  { label: "URL", value: "url" },
  { label: "Vector store", value: "vector_store" },
];

function sourceIcon(sourceType: string) {
  if (sourceType === "url") return Link2;
  if (sourceType === "vector_store") return Server;
  return FileText;
}

export function KnowledgeBasesWorkspace({
  data,
  dataStatus,
  onRefresh,
}: {
  data: PlatformData;
  dataStatus: "loading" | "ready" | "error";
  onRefresh: () => void;
}) {
  const [selectedKbId, setSelectedKbId] = useState(readText(data.knowledgeBases[0] || {}, ["kb_id"]) || "");
  const selectedKb = data.knowledgeBases.find((kb) => readText(kb, ["kb_id"]) === selectedKbId) || data.knowledgeBases[0];
  const [message, setMessage] = useState("");
  const [kbForm, setKbForm] = useState({
    kb_id: "",
    display_name: "",
    description: "",
    owner: "",
    domain: "",
    sensitivity: "internal",
    source_type: "file" as SourceType,
    environment: "demo",
  });
  const [sourceForm, setSourceForm] = useState<KnowledgeSourcePayload>({
    source_type: "file",
    display_name: "",
    uri: "",
    content_type: "",
    source_config: {},
  });
  const [query, setQuery] = useState("");
  const [queryResults, setQueryResults] = useState<ApiRecord[]>([]);

  const sourceTypes = useMemo(() => {
    const counts = new Map<string, number>();
    data.knowledgeBases.forEach((kb) => {
      const value = readText(kb, ["source_type"]) || "unknown";
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([type, count]) => `${type}: ${count}`).join(" / ");
  }, [data.knowledgeBases]);

  async function withToken(action: (token: string) => Promise<void>) {
    setMessage("");
    const session = getSession();
    if (!session?.token) {
      setMessage("Session expired. Login again before changing knowledge bases.");
      return;
    }
    try {
      await action(session.token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Knowledge base action failed.");
    }
  }

  async function submitKnowledgeBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await withToken(async (token) => {
      await createKnowledgeBase(token, {
        ...kbForm,
        source_config: {},
      });
      setMessage("Knowledge base saved.");
      await onRefresh();
    });
  }

  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedKb) {
      setMessage("Create or select a knowledge base before adding a source.");
      return;
    }
    await withToken(async (token) => {
      await createKnowledgeSource(token, readText(selectedKb, ["kb_id"]) || "", sourceForm);
      setMessage("Knowledge source registered.");
      await onRefresh();
    });
  }

  async function syncSelectedKb() {
    if (!selectedKb) return;
    await withToken(async (token) => {
      await syncKnowledgeBase(token, readText(selectedKb, ["kb_id"]) || "");
      setMessage("Knowledge index status refreshed.");
      await onRefresh();
    });
  }

  async function testQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedKb || !query.trim()) return;
    await withToken(async (token) => {
      const results = await queryKnowledgeBase(token, readText(selectedKb, ["kb_id"]) || "", {
        query,
        top_k: 5,
      });
      setQueryResults(results);
      setMessage(results.length ? "Retrieval test complete." : "No retrieval matches returned.");
    });
  }

  return (
    <section className="grid gap-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" aria-label="Knowledge base metrics">
        <MetricSurface label="Knowledge Bases" value={data.knowledgeBases.length} tone="fuchsia" loading={dataStatus === "loading"} />
        <MetricSurface label="Assigned Agents" value={Object.values(data.agentAssignmentCounts).filter((item) => item.knowledge > 0).length} tone="emerald" loading={dataStatus === "loading"} />
        <MetricSurface label="Documents" value={data.knowledgeBases.reduce((sum, kb) => sum + Number(readText(kb, ["document_count"]) || 0), 0)} tone="cyan" loading={dataStatus === "loading"} />
        <MetricSurface label="Chunks" value={data.knowledgeBases.reduce((sum, kb) => sum + Number(readText(kb, ["chunk_count"]) || 0), 0)} tone="sky" loading={dataStatus === "loading"} />
        <MetricSurface label="Degraded" value={data.knowledgeBases.filter((kb) => readText(kb, ["status"]) === "failed" || readText(kb, ["status"]) === "degraded").length} tone="amber" loading={dataStatus === "loading"} />
      </section>

      {message ? <div className="rounded-2xl border border-line bg-ink/55 px-4 py-3 text-sm text-textSecondary">{message}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <PlatformSurface tone="fuchsia">
          <div className="flex items-center gap-3">
            <Database className="text-accent" size={20} aria-hidden="true" />
            <h2 className="text-xl font-semibold">Knowledge inventory</h2>
          </div>
          <p className="mt-2 text-sm text-textSecondary">{sourceTypes || "No source types registered yet."}</p>
          <div className="mt-5 grid gap-3">
            {data.knowledgeBases.length ? data.knowledgeBases.map((kb) => {
              const kbId = readText(kb, ["kb_id"]) || "";
              return (
                <button
                  key={kbId}
                  type="button"
                  onClick={() => setSelectedKbId(kbId)}
                  className={`rounded-2xl border p-4 text-left transition ${selectedKbId === kbId ? "border-accent/60 bg-accent/10" : "border-line bg-white/[0.035] hover:border-accent/35"}`}
                >
                  <p className="font-semibold">{readText(kb, ["display_name", "kb_id"])}</p>
                  <p className="mt-1 text-sm text-textSecondary">{readText(kb, ["description"]) || "No description."}</p>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-textSecondary">
                    {joinParts([readText(kb, ["environment"]), readText(kb, ["source_type"]), readText(kb, ["status"]) || "draft"])}
                  </p>
                </button>
              );
            }) : <ComponentRow title="No records" detail="Create the first governed knowledge base." />}
          </div>
        </PlatformSurface>

        <div className="grid gap-5">
          <PlatformSurface tone="sky">
            <h2 className="text-xl font-semibold">Create knowledge base</h2>
            <form className="mt-5 grid gap-3 md:grid-cols-2" onSubmit={submitKnowledgeBase}>
              <input className="field-input" placeholder="kb_id" value={kbForm.kb_id} onChange={(event) => setKbForm({ ...kbForm, kb_id: event.target.value })} />
              <input className="field-input" placeholder="Display name" value={kbForm.display_name} onChange={(event) => setKbForm({ ...kbForm, display_name: event.target.value })} />
              <input className="field-input" placeholder="Owner" value={kbForm.owner} onChange={(event) => setKbForm({ ...kbForm, owner: event.target.value })} />
              <input className="field-input" placeholder="Domain" value={kbForm.domain} onChange={(event) => setKbForm({ ...kbForm, domain: event.target.value })} />
              <select className="field-input" value={kbForm.source_type} onChange={(event) => setKbForm({ ...kbForm, source_type: event.target.value as SourceType })}>
                {sourceTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <input className="field-input" placeholder="Environment" value={kbForm.environment} onChange={(event) => setKbForm({ ...kbForm, environment: event.target.value })} />
              <textarea className="field-input md:col-span-2" placeholder="Description" value={kbForm.description} onChange={(event) => setKbForm({ ...kbForm, description: event.target.value })} />
              <button className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink md:w-fit" type="submit">Save KB</button>
            </form>
          </PlatformSurface>

          <PlatformSurface tone="emerald">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">{selectedKb ? readText(selectedKb, ["display_name", "kb_id"]) : "Select a KB"}</h2>
              <button className="rounded-full border border-line px-4 py-2 text-sm font-semibold" type="button" onClick={syncSelectedKb} disabled={!selectedKb}>Refresh index</button>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <form className="grid gap-3" onSubmit={submitSource}>
                <select className="field-input" value={sourceForm.source_type} onChange={(event) => setSourceForm({ ...sourceForm, source_type: event.target.value as SourceType })}>
                  {sourceTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <input className="field-input" placeholder="Source display name" value={sourceForm.display_name} onChange={(event) => setSourceForm({ ...sourceForm, display_name: event.target.value })} />
                <input className="field-input" placeholder="URI, path, or vector index name" value={sourceForm.uri || ""} onChange={(event) => setSourceForm({ ...sourceForm, uri: event.target.value })} />
                <input className="field-input" placeholder="Content type" value={sourceForm.content_type || ""} onChange={(event) => setSourceForm({ ...sourceForm, content_type: event.target.value })} />
                <button className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink" type="submit">Add source</button>
              </form>
              <div className="grid gap-3">
                {selectedKb ? (
                  <ComponentRow
                    title={readText(selectedKb, ["status"]) || "draft"}
                    detail={joinParts([
                      formatCount(Number(readText(selectedKb, ["document_count"]) || 0), "document"),
                      formatCount(Number(readText(selectedKb, ["chunk_count"]) || 0), "chunk"),
                    ]) || "No index evidence yet."}
                    meta={readText(selectedKb, ["environment"])}
                  />
                ) : <ComponentRow title="No KB selected" detail="Select or create a KB to manage sources." />}
              </div>
            </div>
          </PlatformSurface>

          <PlatformSurface tone="cyan">
            <div className="flex items-center gap-3">
              <Search className="text-accent" size={20} aria-hidden="true" />
              <h2 className="text-xl font-semibold">Test retrieval</h2>
            </div>
            <form className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={testQuery}>
              <input className="field-input" placeholder="Ask this knowledge base a question" value={query} onChange={(event) => setQuery(event.target.value)} />
              <button className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink" type="submit" disabled={!selectedKb || !query.trim()}>Query</button>
            </form>
            <div className="mt-4 grid gap-3">
              {queryResults.length ? queryResults.map((result, index) => (
                <ComponentRow
                  key={index}
                  title={`Result ${index + 1}`}
                  detail={readText(result, ["content"]) || "No content returned."}
                  meta={readText(result, ["score"])}
                />
              )) : <ComponentRow title="No query results" detail="Run a retrieval test to inspect snippets, scores, and metadata." />}
            </div>
          </PlatformSurface>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Route Knowledge Bases to the dedicated workspace**

In `WorkspaceViewContent.tsx`, import:

```ts
import { KnowledgeBasesWorkspace } from "./KnowledgeBasesWorkspace";
```

Replace the `knowledge-bases` branch:

```tsx
  if (activeView === "knowledge-bases") {
    return <KnowledgeBasesWorkspace data={data} dataStatus={dataStatus} onRefresh={onRefresh} />;
  }
```

- [ ] **Step 4: Run frontend checks**

Run from `dashboard/`:

```bash
npx tsc --noEmit
npm run build
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx dashboard/app/platform/_components/WorkspaceViewContent.tsx
git commit -m "feat: add governed knowledge base console"
```

---

### Task 6: Agent Attachment Retrieval Policy UI

**Files:**
- Modify: `dashboard/app/platform/_components/SelectedAgentModal.tsx`

- [ ] **Step 1: Run impact before editing symbol**

Run GitNexus impact:

```text
gitnexus_impact({ target: "SelectedAgentModal", direction: "upstream", repo: "intelliguard" })
```

Expected: low or medium risk. If high or critical, stop and report before editing.

- [ ] **Step 2: Add local state**

In `SelectedAgentModal.tsx`, near existing KB state, add:

```ts
  const [kbRetrievalMode, setKbRetrievalMode] = useState("hybrid");
  const [kbTopK, setKbTopK] = useState(5);
  const [kbCitationRequired, setKbCitationRequired] = useState(true);
```

- [ ] **Step 3: Send retrieval settings when attaching**

Update `attachKnowledge` payload:

```ts
      await assignAgentKnowledgeBase(token, agentId, {
        kb_id: selectedKbId,
        access_mode: kbAccessMode,
        retrieval_mode: kbRetrievalMode,
        top_k: kbTopK,
        citation_required: kbCitationRequired,
        metadata_filters: {},
      });
```

- [ ] **Step 4: Display richer assignment details**

Update `knowledgeItems` detail:

```ts
    detail: joinParts([
      readText(assignment, ["access_mode"]),
      readText(assignment, ["retrieval_mode"]),
      readText(assignment, ["top_k"]) ? `top ${readText(assignment, ["top_k"])}` : undefined,
      readText(assignment, ["citation_required"]) === "true" ? "citations required" : undefined,
    ]) || "Attached knowledge base",
```

- [ ] **Step 5: Add policy controls to the form**

Change the knowledge form grid to fit four controls and add:

```tsx
                  <select className="field-input" value={kbRetrievalMode} onChange={(event) => setKbRetrievalMode(event.target.value)}>
                    <option value="hybrid">hybrid</option>
                    <option value="semantic">semantic</option>
                    <option value="keyword">keyword</option>
                  </select>
                  <input className="field-input" type="number" min={1} max={50} value={kbTopK} onChange={(event) => setKbTopK(Number(event.target.value))} aria-label="Top K retrieval results" />
                  <label className="inline-flex items-center gap-2 rounded-2xl border border-line bg-white/[0.035] px-4 py-3 text-sm text-textSecondary">
                    <input type="checkbox" checked={kbCitationRequired} onChange={(event) => setKbCitationRequired(event.target.checked)} />
                    citations
                  </label>
```

- [ ] **Step 6: Run frontend checks**

Run from `dashboard/`:

```bash
npx tsc --noEmit
npm run build
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add dashboard/app/platform/_components/SelectedAgentModal.tsx
git commit -m "feat: configure agent knowledge retrieval policy"
```

---

### Task 7: Final Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run backend tests**

Run:

```bash
uv run pytest tests/test_knowledge_bases.py tests/test_store_governance.py tests/evaluation/test_agent_evaluators.py -q
```

Expected: pass.

- [ ] **Step 2: Run lint**

Run:

```bash
uv run ruff check .
```

Expected: `All checks passed!`

- [ ] **Step 3: Run frontend checks**

Run from `dashboard/`:

```bash
npx tsc --noEmit
npm run build
```

Expected: both pass.

- [ ] **Step 4: Run GitNexus change detection**

Run:

```text
gitnexus_detect_changes({ repo: "intelliguard", scope: "all" })
```

Expected: changed symbols include KB store/API/frontend workspace symbols. If risk is high or critical, review affected processes before finalizing.

- [ ] **Step 5: Rebuild local dashboard**

Run:

```bash
docker compose up -d --build dashboard
```

Expected: dashboard and API containers start.

- [ ] **Step 6: Browser verify**

Open:

```text
http://localhost:5175/platform/?view=knowledge-bases
```

Expected:

- The page shows metrics, inventory, create KB form, source registration, and retrieval test.
- The raw JSON builder is not the main experience.
- Selecting an agent and opening the Knowledge tab shows retrieval policy controls.

- [ ] **Step 7: Commit verification notes if needed**

If implementation introduced docs or screenshots, commit them separately:

```bash
git add docs/superpowers/plans/2026-05-04-knowledge-bases-console-foundation.md
git commit -m "docs: add knowledge bases implementation plan"
```
