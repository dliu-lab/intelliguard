# Knowledge Bases Create Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Knowledge Bases workspace so creating a KB includes scope, retrieval mode, files, vector configuration, versioning, optional indexing, evaluation, and deletion in one coherent product flow.

**Architecture:** Add one backend orchestration endpoint for multipart KB creation so file upload and initial version creation are not split across fragile UI calls. Keep File KB and Vector KB as separate behavior paths: File KB stores files and version manifests only; Vector KB additionally uses LlamaIndex, Ollama embeddings, and pgvector indexing. The frontend follows the Agent Registry and Tool Registry layout: onboarding builder at the top, harness/filter sidebar on the left, registered KB cards on the right, with detail/evaluation/version work available from each card.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy, existing KB file storage, existing LlamaIndex/pgvector ingestion service, pytest, Next.js App Router, React/TSX, Tailwind, lucide-react.

---

## Execution Notes

- Do not call GitNexus for this plan unless the user explicitly re-enables it.
- Preserve append-only KB versions. No update-in-place for existing versions.
- Preserve the existing max of 10 files per KB in UI and backend.
- File KB must not create chunks, embeddings, LlamaIndex jobs, or pgvector rows.
- Vector KB may use the same uploaded files, but it must explicitly pass through indexing.
- Use custom confirmation UI for delete. Do not use browser `confirm()`.

## File Structure

- Modify: `api/main.py`
  - Add multipart create-with-files endpoint.
  - Add KB evaluation endpoint.
  - Add confirmed delete endpoint.
- Modify: `agent_governance/store.py`
  - Add optional delayed initial version creation for orchestrated create.
  - Add persisted KB evaluation summary in `source_config`.
  - Add safe KB deletion that blocks assigned KBs.
- Modify: `dashboard/lib/api.ts`
  - Add `createKnowledgeBaseWithFiles`, `evaluateKnowledgeBase`, and `deleteKnowledgeBase`.
- Modify: `dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx`
  - Replace split create/select/upload flow with a full create/edit builder.
  - Convert left area to harness/filter sidebar.
  - Convert right area to registered KB cards.
  - Add evaluation action and delete confirmation dialog.
- Modify: `tests/test_knowledge_bases.py`
  - Cover orchestrated create, File KB no-vector behavior, evaluation, and delete safety.
- Modify: `tests/test_knowledge_ingestion.py`
  - Cover vector create with index-after-create and no ingestion for File KB.

---

### Task 1: Backend Orchestrated Create Endpoint

**Files:**
- Modify: `agent_governance/store.py`
- Modify: `api/main.py`
- Modify: `tests/test_knowledge_bases.py`

- [ ] **Step 1: Add failing store/API tests**

Add tests that prove one create request can create a KB, store files, and create the first version with a non-empty file manifest.

```python
def test_create_file_kb_with_files_creates_initial_manifest(client, auth_headers) -> None:
    metadata = {
        "kb_id": "claims-file-kb",
        "display_name": "Claims File KB",
        "description": "Claims source files.",
        "owner": "Claims Ops",
        "domain": "claims",
        "environment": "demo",
        "sensitivity": "internal",
        "retrieval_mode": "file",
        "kb_scope": "domain",
        "scope_ref": "claims",
        "version": "v0.1.0",
        "notes": "Initial file KB.",
    }

    response = client.post(
        "/v1/knowledge-bases/create-with-files",
        headers=auth_headers,
        data={"metadata": json.dumps(metadata)},
        files=[("files", ("claims.md", b"# Claims\n\nPolicy text.", "text/markdown"))],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["knowledge_base"]["kb_id"] == "claims-file-kb"
    assert body["documents"][0]["file_name"] == "claims.md"
    assert body["version"]["version"] == "v0.1.0"
    assert len(body["version"]["file_manifest"]) == 1
    assert body["index"] is None
```

Run:

```bash
uv run --extra dev pytest tests/test_knowledge_bases.py::test_create_file_kb_with_files_creates_initial_manifest -q
```

Expected: fail because `/v1/knowledge-bases/create-with-files` does not exist.

- [ ] **Step 2: Add delayed initial version support**

Change `GovernanceStore.upsert_knowledge_base` to accept an internal payload flag:

```python
create_initial_version = bool(payload.get("create_initial_version", True))
```

When inserting a new KB, only call `_create_kb_version_row(...)` if `create_initial_version` is true. Remove this flag from persisted `source_config`; it is only an orchestration control.

- [ ] **Step 3: Add multipart request parsing**

In `api/main.py`, add:

```python
class KnowledgeBaseCreateWithFilesMetadata(BaseModel):
    kb_id: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    description: str = ""
    owner: str = "Unassigned"
    domain: str = ""
    environment: str = Field(default="demo", min_length=1)
    sensitivity: str = "internal"
    retrieval_mode: str = Field(pattern="^(file|vector)$", default="file")
    kb_scope: str = Field(pattern="^(domain|agent|shared)$", default="domain")
    scope_ref: str = ""
    linked_agent_id: str = ""
    version: str = Field(pattern=r"^v\d+\.\d+\.\d+$", default="v0.1.0")
    notes: str = ""
    vector_backend: str = "pgvector"
    embedding_model: str = "nomic-embed-text"
    chunking_strategy: str = Field(
        pattern="^(semantic_sections|fixed_size|qa_pairs|procedure_steps)$",
        default="semantic_sections",
    )
    chunk_size: int = Field(default=1024, ge=128, le=8192)
    chunk_overlap: int = Field(default=160, ge=0, le=2048)
    index_after_create: bool = False
```

- [ ] **Step 4: Add endpoint implementation**

Add `POST /v1/knowledge-bases/create-with-files`:

```python
@app.post("/v1/knowledge-bases/create-with-files")
async def create_knowledge_base_with_files(
    metadata: str = Form(...),
    files: list[UploadFile] = File(default=[]),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    try:
        body = KnowledgeBaseCreateWithFilesMetadata.model_validate_json(metadata)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    require_environment_access(user, body.environment, "agent:create")
    if len(files) > 10:
        raise HTTPException(status_code=400, detail="A KB can include at most 10 files")

    scope_ref = body.linked_agent_id if body.kb_scope == "agent" else body.scope_ref or body.domain or "shared"
    kb = store.upsert_knowledge_base(
        {
            "kb_id": body.kb_id,
            "display_name": body.display_name,
            "description": body.description,
            "source_type": "file",
            "source_config": {
                "kb_scope": body.kb_scope,
                "linked_agent_id": body.linked_agent_id,
                "scope_ref": scope_ref,
                "retrieval_mode": body.retrieval_mode,
                "vector_backend": "pgvector" if body.retrieval_mode == "vector" else "",
                "embedding_model": body.embedding_model,
                "chunking_strategy": body.chunking_strategy,
                "chunk_size": body.chunk_size,
                "chunk_overlap": body.chunk_overlap,
            },
            "environment": body.environment,
            "owner": body.owner,
            "domain": body.domain,
            "sensitivity": body.sensitivity,
            "embedding_model": body.embedding_model,
            "create_initial_version": False,
        }
    )

    documents = []
    for upload in files:
        data = await upload.read()
        stored = KnowledgeFileStorage(DEFAULT_KB_UPLOAD_DIR).save_upload(
            kb_id=body.kb_id,
            file_name=upload.filename or "upload.txt",
            content_type=upload.content_type or "",
            data=data,
        )
        source = store.upsert_knowledge_source(
            body.kb_id,
            {
                "source_type": "file",
                "display_name": stored.file_name,
                "uri": stored.storage_uri,
                "content_type": stored.content_type,
                "source_config": {"checksum": stored.checksum},
                "status": "pending",
            },
        )
        documents.append(
            store.create_knowledge_document(
                body.kb_id,
                source["source_id"],
                {
                    "file_name": stored.file_name,
                    "content_type": stored.content_type,
                    "storage_uri": stored.storage_uri,
                    "size_bytes": stored.size_bytes,
                    "checksum": stored.checksum,
                },
            )
        )

    version = store.create_knowledge_base_version(
        body.kb_id,
        {
            "version": body.version,
            "status": "draft",
            "notes": body.notes,
            "retrieval_mode": body.retrieval_mode,
            "kb_scope": body.kb_scope,
            "scope_ref": scope_ref,
            "vector_backend": "pgvector" if body.retrieval_mode == "vector" else "",
            "embedding_model": body.embedding_model,
            "chunking_strategy": body.chunking_strategy,
            "chunk_size": body.chunk_size,
            "chunk_overlap": body.chunk_overlap,
            "profile": kb,
            "file_manifest": None,
        },
    )

    index = None
    if body.retrieval_mode == "vector" and body.index_after_create and documents:
        index = KnowledgeIngestionService(store, LlamaIndexKnowledgeIndexer()).process_pending_documents(body.kb_id)

    return {"knowledge_base": kb, "documents": documents, "version": version, "index": index}
```

- [ ] **Step 5: Verify**

Run:

```bash
uv run --extra dev pytest tests/test_knowledge_bases.py::test_create_file_kb_with_files_creates_initial_manifest -q
```

Expected: pass.

---

### Task 2: File KB vs Vector KB Behavior

**Files:**
- Modify: `api/main.py`
- Modify: `tests/test_knowledge_ingestion.py`

- [ ] **Step 1: Add failing behavior tests**

Add tests that assert File KB does not call ingestion and Vector KB can call ingestion when requested.

```python
def test_file_kb_create_does_not_run_ingestion(client, auth_headers, monkeypatch) -> None:
    called = False

    def fail_if_called(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("File KB must not run vector ingestion")

    monkeypatch.setattr(
        "api.main.KnowledgeIngestionService.process_pending_documents",
        fail_if_called,
    )

    response = client.post(
        "/v1/knowledge-bases/create-with-files",
        headers=auth_headers,
        data={
            "metadata": json.dumps(
                {
                    "kb_id": "file-only-kb",
                    "display_name": "File Only KB",
                    "environment": "demo",
                    "retrieval_mode": "file",
                    "kb_scope": "shared",
                    "version": "v0.1.0",
                    "index_after_create": True,
                }
            )
        },
        files=[("files", ("source.md", b"# Source", "text/markdown"))],
    )

    assert response.status_code == 200
    assert called is False
    assert response.json()["index"] is None
```

```python
def test_vector_kb_create_can_run_ingestion(client, auth_headers, monkeypatch) -> None:
    def fake_process(self, kb_id: str) -> dict[str, object]:
        return {"kb_id": kb_id, "status": "indexed", "chunk_count": 3}

    monkeypatch.setattr(
        "api.main.KnowledgeIngestionService.process_pending_documents",
        fake_process,
    )

    response = client.post(
        "/v1/knowledge-bases/create-with-files",
        headers=auth_headers,
        data={
            "metadata": json.dumps(
                {
                    "kb_id": "vector-kb",
                    "display_name": "Vector KB",
                    "environment": "demo",
                    "retrieval_mode": "vector",
                    "kb_scope": "domain",
                    "domain": "claims",
                    "scope_ref": "claims",
                    "version": "v0.1.0",
                    "index_after_create": True,
                    "embedding_model": "nomic-embed-text",
                    "chunking_strategy": "semantic_sections",
                    "chunk_size": 1024,
                    "chunk_overlap": 160,
                }
            )
        },
        files=[("files", ("source.md", b"# Source", "text/markdown"))],
    )

    assert response.status_code == 200
    assert response.json()["index"]["status"] == "indexed"
```

- [ ] **Step 2: Verify**

Run:

```bash
uv run --extra dev pytest tests/test_knowledge_ingestion.py::test_file_kb_create_does_not_run_ingestion tests/test_knowledge_ingestion.py::test_vector_kb_create_can_run_ingestion -q
```

Expected: pass after Task 1 endpoint is complete.

---

### Task 3: Evaluation And Delete Backend

**Files:**
- Modify: `agent_governance/store.py`
- Modify: `api/main.py`
- Modify: `tests/test_knowledge_bases.py`

- [ ] **Step 1: Add failing tests for evaluation**

```python
def test_evaluate_file_kb_reports_ready_when_files_and_version_exist(store) -> None:
    store.upsert_knowledge_base(
        {
            "kb_id": "ready-file-kb",
            "display_name": "Ready File KB",
            "description": "Ready source.",
            "source_type": "file",
            "source_config": {"retrieval_mode": "file", "kb_scope": "shared"},
            "environment": "demo",
            "owner": "Ops",
            "create_initial_version": False,
        }
    )
    source = store.upsert_knowledge_source("ready-file-kb", {"source_type": "file", "display_name": "ready.md"})
    store.create_knowledge_document("ready-file-kb", source["source_id"], {"file_name": "ready.md", "content_type": "text/markdown", "storage_uri": "file://ready.md"})
    store.create_knowledge_base_version("ready-file-kb", {"version": "v0.1.0", "retrieval_mode": "file", "kb_scope": "shared"})

    result = store.evaluate_knowledge_base("ready-file-kb")

    assert result["status"] == "ready"
    assert result["checks"]["file_count"]["status"] == "pass"
    assert result["checks"]["vector_index"]["status"] == "skip"
```

- [ ] **Step 2: Add failing tests for delete safety**

```python
def test_delete_kb_blocks_assigned_kb(store) -> None:
    store.upsert_agent({"agent_id": "claims-agent", "display_name": "Claims Agent", "environment": "demo"})
    store.upsert_knowledge_base(
        {
            "kb_id": "assigned-kb",
            "display_name": "Assigned KB",
            "source_type": "file",
            "source_config": {"retrieval_mode": "file", "kb_scope": "shared"},
            "environment": "demo",
            "create_initial_version": False,
        }
    )
    store.upsert_agent_kb_assignment("claims-agent", "demo", "assigned-kb")

    with pytest.raises(ValueError, match="assigned to agents"):
        store.delete_knowledge_base("assigned-kb")
```

- [ ] **Step 3: Implement `evaluate_knowledge_base`**

Add a store method that returns and persists:

```python
{
    "status": "ready" | "needs_review" | "failed" | "not_evaluated",
    "summary": "...",
    "checks": {
        "file_count": {"status": "pass" | "fail", "message": "..."},
        "supported_files": {"status": "pass" | "fail", "message": "..."},
        "version": {"status": "pass" | "fail", "message": "..."},
        "owner": {"status": "pass" | "fail", "message": "..."},
        "scope": {"status": "pass" | "fail", "message": "..."},
        "vector_index": {"status": "pass" | "fail" | "skip", "message": "..."},
    },
}
```

Rules:

- File KB skips `vector_index`.
- Vector KB fails `vector_index` if no index exists, no indexed documents exist, or latest index status is failed.
- Missing owner, description, scope target, version, or files produces `needs_review` or `failed` based on severity.
- Persist the result at `KnowledgeBase.source_config["evaluation"]`.

- [ ] **Step 4: Implement safe delete**

Add `GovernanceStore.delete_knowledge_base(kb_id: str) -> bool`:

- Return false if KB does not exist.
- Raise `ValueError("Knowledge base is assigned to agents")` when assignments exist.
- Delete chunks, documents, sources, index versions, KB versions, then the KB.
- Do not delete uploaded physical files in this task; keep storage cleanup as a later maintenance operation unless a file storage delete helper already exists.

- [ ] **Step 5: Add API endpoints**

Add:

```python
@app.post("/v1/knowledge-bases/{kb_id}/evaluate")
def evaluate_knowledge_base(kb_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "read")
    return store.evaluate_knowledge_base(kb_id)
```

Add:

```python
@app.delete("/v1/knowledge-bases/{kb_id}")
def delete_knowledge_base(kb_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, bool]:
    kb = store.get_knowledge_base(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    require_environment_access(user, kb["environment"], "agent:create")
    try:
        deleted = store.delete_knowledge_base(kb_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": deleted}
```

- [ ] **Step 6: Verify**

Run:

```bash
uv run --extra dev pytest tests/test_knowledge_bases.py -q
```

Expected: all KB tests pass.

---

### Task 4: API Client Helpers

**Files:**
- Modify: `dashboard/lib/api.ts`

- [ ] **Step 1: Add request/response helpers**

Add:

```ts
export type KnowledgeBaseCreateWithFilesPayload = {
  kb_id: string;
  display_name: string;
  description?: string;
  owner?: string;
  domain?: string;
  environment: string;
  sensitivity?: string;
  retrieval_mode: "file" | "vector";
  kb_scope: "domain" | "agent" | "shared";
  scope_ref?: string;
  linked_agent_id?: string;
  version: string;
  notes?: string;
  vector_backend?: string;
  embedding_model?: string;
  chunking_strategy?: "semantic_sections" | "fixed_size" | "qa_pairs" | "procedure_steps";
  chunk_size?: number;
  chunk_overlap?: number;
  index_after_create?: boolean;
};

export function createKnowledgeBaseWithFiles(
  token: string,
  payload: KnowledgeBaseCreateWithFilesPayload,
  files: File[],
) {
  const body = new FormData();
  body.append("metadata", JSON.stringify(payload));
  files.forEach((file) => body.append("files", file));
  return request<ApiRecord>("/v1/knowledge-bases/create-with-files", {
    method: "POST",
    headers: authHeaders(token),
    body,
  });
}

export function evaluateKnowledgeBase(token: string, kbId: string) {
  return request<ApiRecord>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/evaluate`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export function deleteKnowledgeBase(token: string, kbId: string) {
  return request<{ ok: boolean }>(`/v1/knowledge-bases/${encodeURIComponent(kbId)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}
```

- [ ] **Step 2: Verify TypeScript**

Run:

```bash
npm --prefix dashboard run build
```

Expected: build passes.

---

### Task 5: Frontend Builder State And Create Flow

**Files:**
- Modify: `dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx`

- [ ] **Step 1: Add builder state**

Add:

```ts
type BuilderMode = "create" | "edit" | "duplicate";

type StagedFile = {
  id: string;
  file: File;
};

const [builderFiles, setBuilderFiles] = useState<StagedFile[]>([]);
const [indexAfterCreate, setIndexAfterCreate] = useState(true);
const [submittingBuilder, setSubmittingBuilder] = useState(false);
```

- [ ] **Step 2: Add file staging handlers**

Add:

```ts
function addBuilderFiles(event: ChangeEvent<HTMLInputElement>) {
  const nextFiles = Array.from(event.target.files || []).map((file) => ({
    id: `${file.name}-${file.size}-${file.lastModified}`,
    file,
  }));
  setBuilderFiles((current) => [...current, ...nextFiles].slice(0, MAX_FILES_PER_KB));
  event.target.value = "";
}

function removeBuilderFile(id: string) {
  setBuilderFiles((current) => current.filter((item) => item.id !== id));
}
```

- [ ] **Step 3: Replace create submit path**

For create/duplicate mode, call `createKnowledgeBaseWithFiles` instead of `createKnowledgeBase`.

Payload rules:

- `retrieval_mode: "file"` sends `index_after_create: false`.
- `retrieval_mode: "vector"` sends `index_after_create` from the toggle.
- `scope_ref` is domain, linked agent ID, or shared.
- `files` is `builderFiles.map((item) => item.file)`.

For edit mode:

- Upload staged files to the existing KB first.
- Create a new version after uploads.
- If vector mode and `indexAfterCreate` is enabled, call `syncKnowledgeBase`.

- [ ] **Step 4: Add create-time validation**

Before submit:

- Require KB ID, display name, environment, version.
- Require domain for domain scope.
- Require agent ID for agent scope.
- Require at least one staged file for new File KB and new Vector KB.
- Block more than 10 staged files.
- Require semantic version format `v0.0.0`.

Use `setMessage(...)` for validation errors.

---

### Task 6: Frontend Create Builder UI

**Files:**
- Modify: `dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx`

- [ ] **Step 1: Update onboarding band**

Keep the top band but align the copy with Agent/Tool onboarding:

- Eyebrow: `Knowledge Base onboarding`
- Heading: `Create governed knowledge bases`
- Copy: create from files, choose File KB or Vector KB, publish append-only versions.
- Button: `Create KB`

- [ ] **Step 2: Convert retrieval mode to segmented control**

Replace the plain select with two buttons:

- `File KB`
- `Vector-indexed KB`

Both update `kbForm.retrieval_mode`.

- [ ] **Step 3: Add conditional File KB panel**

Render when `kbForm.retrieval_mode === "file"`:

- Multi-file input with `accept=".md,.txt,.pdf,.docx,..."`
- `?` tooltip beside upload label explaining Markdown is preferred.
- Staged file list with remove buttons.
- Text that File KB does not use LlamaIndex, embeddings, chunking, or pgvector.
- Submit label: `Create File KB` or `Save File KB Version`.

- [ ] **Step 4: Add conditional Vector KB panel**

Render when `kbForm.retrieval_mode === "vector"`:

- Multi-file input with staged list.
- Read-only facts:
  - Target vector store: `pgvector`
  - Ingestion: `LlamaIndex`
  - Embeddings: `Ollama`
- Embedding model input.
- Chunking strategy select.
- Chunk size input.
- Chunk overlap input.
- Toggle: `Index after create`.
- Submit label: `Create and Index KB` when toggle on, otherwise `Create Vector KB`.

- [ ] **Step 5: Keep edit mode append-only**

When `formMode === "edit"`:

- Heading: `Save new KB version`.
- KB ID disabled.
- File panel says files will be attached to the new version.
- Submit label: `Save Draft Version`.

---

### Task 7: Registry Harness Sidebar And KB Cards

**Files:**
- Modify: `dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx`

- [ ] **Step 1: Replace left registry list with harness sidebar**

Left sidebar should match Agent/Tool Registry style:

- Eyebrow: `Knowledge harness`
- Heading: `Govern registered KBs`
- Summary buttons/cards:
  - total KBs
  - ready/published KBs
  - vector-indexed KBs
  - file KBs
- Domain filter.
- Scope filter: all/domain/agent/shared.
- Retrieval filter: all/file/vector.
- Status filter: all/draft/published/needs review/failed.

- [ ] **Step 2: Move registered KB cards to right panel**

Right panel heading:

- Eyebrow: `Registered knowledge bases`
- Heading: `Created KBs`

Each card shows:

- display name
- KB ID
- description
- scope/domain/agent/shared
- retrieval mode
- version status
- evaluation status
- index status only for vector KBs
- file count for that KB only
- owner
- environment

- [ ] **Step 3: Add card actions**

Each card has:

- click/open detail
- action menu with:
  - `Edit KB`
  - `View versions`
  - `Evaluate KB`
  - `Archive KB`
- red `X` delete button outside the menu.

---

### Task 8: Delete Confirmation UI

**Files:**
- Modify: `dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx`

- [ ] **Step 1: Add confirmation state**

```ts
const [deleteCandidate, setDeleteCandidate] = useState<ApiRecord | null>(null);
const [deletingKbId, setDeletingKbId] = useState("");
```

- [ ] **Step 2: Add custom confirmation dialog**

When `deleteCandidate` exists, render a fixed overlay with:

- KB display name.
- KB ID.
- Warning text:
  - versions will be removed
  - files/documents will be removed
  - vector index rows will be removed for vector KBs
  - assigned KBs cannot be deleted
- Buttons:
  - `Cancel`
  - `Delete KB`

- [ ] **Step 3: Add delete handler**

```ts
async function confirmDeleteKnowledgeBase() {
  const kbId = readText(deleteCandidate || {}, ["kb_id"]);
  if (!kbId) return;
  setDeletingKbId(kbId);
  await withToken(async (token) => {
    await deleteKnowledgeBase(token, kbId);
    if (selectedKbId === kbId) {
      setSelectedKbId("");
      setSelectedKbDetail(null);
      setSelectedDocuments([]);
      setSelectedVersions([]);
    }
    setDeleteCandidate(null);
    setMessage("Knowledge base deleted.");
    await onRefresh();
  });
  setDeletingKbId("");
}
```

---

### Task 9: Evaluation UI

**Files:**
- Modify: `dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx`

- [ ] **Step 1: Add evaluation state**

```ts
const [evaluatingKbId, setEvaluatingKbId] = useState("");
const [evaluationResults, setEvaluationResults] = useState<Record<string, ApiRecord>>({});
```

- [ ] **Step 2: Add handler**

```ts
async function runKnowledgeBaseEvaluation(kb: ApiRecord) {
  const kbId = readText(kb, ["kb_id"]) || "";
  if (!kbId) return;
  setEvaluatingKbId(kbId);
  await withToken(async (token) => {
    const result = await evaluateKnowledgeBase(token, kbId);
    setEvaluationResults((current) => ({ ...current, [kbId]: result }));
    setMessage(`KB evaluation ${readText(result, ["status"]) || "completed"}.`);
    await onRefresh();
  });
  setEvaluatingKbId("");
}
```

- [ ] **Step 3: Show evaluation status on cards**

Status source order:

1. `evaluationResults[kbId]`
2. `source_config.evaluation`
3. fallback `Not evaluated`

Render as a pill:

- `Ready`
- `Needs review`
- `Failed`
- `Not evaluated`

- [ ] **Step 4: Show checks in selected detail**

When a KB is selected and an evaluation result exists, show a compact checklist:

- File count
- Supported files
- Version
- Owner
- Scope
- Vector index, skipped for File KB

---

### Task 10: Cleanup Selected Workspace Responsibilities

**Files:**
- Modify: `dashboard/app/platform/_components/KnowledgeBasesWorkspace.tsx`

- [ ] **Step 1: Remove upload controls from selected workspace**

The selected/detail area should no longer be the primary place to attach files for initial setup. Remove or demote the standalone `Upload file` control from selected workspace.

- [ ] **Step 2: Keep detail-only sections**

Keep:

- selected KB profile summary
- local file manifest review
- vector store status for vector KBs
- version history and publish buttons
- agent usage
- semantic `Query this KB`, vector only

- [ ] **Step 3: Ensure File KB has no query UI**

File KB selected detail must not render:

- `Query this KB`
- chunking strategy controls
- index button
- pgvector index status as a required action

---

### Task 11: Verification

**Files:**
- All touched files.

- [ ] **Step 1: Backend tests**

Run:

```bash
uv run --extra dev pytest tests/test_knowledge_bases.py tests/test_knowledge_ingestion.py -q
```

Expected: all tests pass.

- [ ] **Step 2: Python format/lint**

Run:

```bash
uv run --extra dev ruff format --check agent_governance/store.py api/main.py tests/test_knowledge_bases.py tests/test_knowledge_ingestion.py
uv run --extra dev ruff check agent_governance/store.py api/main.py tests/test_knowledge_bases.py tests/test_knowledge_ingestion.py
```

Expected: both commands pass. If format check fails, run `uv run --extra dev ruff format ...` and rerun checks.

- [ ] **Step 3: Frontend type/build**

Run:

```bash
./node_modules/.bin/tsc --noEmit
npm --prefix dashboard run build
```

Expected: both pass.

- [ ] **Step 4: Local service verification**

Run:

```bash
docker compose up -d --build api kb-worker dashboard
docker compose up -d --force-recreate api kb-worker dashboard
curl -s -w '%{http_code}' -o /tmp/kb_page.out 'http://localhost:5175/platform/?view=knowledge-bases'
curl -s -w '%{http_code}' -o /tmp/kb_api.out 'http://localhost:8000/v1/auth/bootstrap-status'
```

Expected:

- dashboard page returns `200`
- API returns `200`
- `docker compose ps` shows `api`, `kb-worker`, `dashboard`, and `postgres` running

---

## Self-Review

- This plan covers the approved design: one create flow, File KB no-vector behavior, Vector KB indexing, registry-style sidebar, right-side KB cards, evaluation, and confirmed deletion.
- No placeholders remain.
- Scope is contained to KB backend orchestration, KB store behavior, API client helpers, and one dashboard workspace.
- The plan intentionally avoids GitNexus because the user explicitly asked not to use it for this work.
