# LlamaIndex Pgvector Knowledge Ingestion Design

## Context

The current Knowledge Bases console is a governance shell: users can create KB metadata,
register source metadata, refresh an index status record, attach KBs to agents, and run a
query test. It does not yet provide a working document ingestion and retrieval product.

The approved direction is:

- use LlamaIndex for ingestion and indexing orchestration;
- use local Ollama embedding models;
- store indexed chunks in Postgres with pgvector;
- keep IntelliGuard as the source of truth for KB ownership, agent access, auditability,
  environment controls, source health, and user-visible operational status.

LlamaIndex is a Python framework, not a standalone infrastructure service. It should run
inside the Python API image and a Python worker image, not as a separate "LlamaIndex
server" container.

## Goal

Build a working governed KB ingestion and retrieval layer. A governance user must be able
to upload a file, see ingestion progress, index it through LlamaIndex with Ollama
embeddings into pgvector, query the selected KB, and attach that KB to agents with
retrieval policy enforced by the backend.

## Non-Goals

This phase will not build a full connector marketplace. URL and external vector-store
sources may remain registered metadata until the file pipeline is complete.

This phase will not move authorization into LlamaIndex. Environment access, KB assignment,
agent policy, and sensitivity controls remain in IntelliGuard.

This phase will not require hosted SaaS parsing. LlamaParse is an optional future parser
for complex PDFs and Office documents, but local ingestion must work without a cloud
dependency.

## Deployment Design

Use four runtime roles in Docker:

- `postgres`: pgvector-enabled Postgres image, persistent `postgres_data` volume, and
  `CREATE EXTENSION IF NOT EXISTS vector`.
- `api`: FastAPI application. Installs LlamaIndex packages, exposes upload, sync, query,
  and KB management endpoints.
- `kb-worker`: same Python image as `api`, runs ingestion jobs against the same database
  and upload volume.
- `dashboard`: existing frontend container.

Ollama can run in either of two modes:

- **Default local development:** Ollama runs on the host and Docker containers reach it at
  `http://host.docker.internal:11434`.
- **Optional fully containerized mode:** an `ollama` compose profile is outside this
  phase and can provide repeatable environments with a persistent model volume.

Required environment variables:

- `OLLAMA_BASE_URL`, default `http://host.docker.internal:11434`;
- `OLLAMA_EMBED_MODEL`, default `nomic-embed-text`;
- `KB_UPLOAD_DIR`, default `/app/data/kb_uploads`;
- `KB_INGESTION_BATCH_SIZE`, default `32`;
- `KB_CHUNK_SIZE`, default `1024`;
- `KB_CHUNK_OVERLAP`, default `160`.

## Data Model

Keep the existing `knowledge_bases`, `knowledge_sources`, `knowledge_index_versions`,
and `agent_kb_assignments` tables. Add two durable content tables:

### `knowledge_documents`

- `document_id`: primary key;
- `kb_id`: foreign key to `knowledge_bases`;
- `source_id`: foreign key to `knowledge_sources`;
- `file_name`;
- `content_type`;
- `storage_uri`;
- `size_bytes`;
- `checksum`;
- `status`: `uploaded`, `queued`, `parsing`, `embedding`, `indexed`, `failed`;
- `chunk_count`;
- `last_error`;
- `created_at`;
- `updated_at`;
- `indexed_at`.

### `knowledge_chunks`

- `chunk_id`: primary key;
- `kb_id`;
- `source_id`;
- `document_id`;
- `index_version_id`;
- `chunk_index`;
- `content`;
- `content_hash`;
- `embedding`: pgvector column;
- `metadata`: JSONB containing file name, source display name, page/section when known,
  environment, sensitivity, parser name, and embedding model;
- `created_at`.

Security filters such as `kb_id`, `environment`, and `sensitivity` must be represented as
ordinary columns or indexed metadata that the backend always applies before returning
results.

## Backend Services

Introduce focused services instead of placing all behavior in route handlers:

- `KnowledgeFileStorage`: validates file names and content types, computes checksum, and
  stores uploads in `KB_UPLOAD_DIR`.
- `KnowledgeIngestionService`: creates ingestion jobs/index versions and moves documents
  through `uploaded -> queued -> parsing -> embedding -> indexed`.
- `LlamaIndexKnowledgeIndexer`: converts local files to LlamaIndex documents/nodes,
  chunks them, embeds through Ollama, and writes chunks to pgvector.
- `KnowledgeRetrievalService`: queries pgvector through LlamaIndex or a narrow SQL-backed
  adapter, enforces KB/environment filters, applies retrieval policy, and returns
  citations.

The API should expose:

- `POST /v1/knowledge-bases/{kb_id}/files` for multipart file upload;
- `GET /v1/knowledge-bases/{kb_id}/documents` for file and status display;
- `POST /v1/knowledge-bases/{kb_id}/sync` to enqueue or run indexing for pending files;
- `POST /v1/knowledge-bases/{kb_id}/query` to query only indexed chunks for that KB.

## Ingestion Flow

1. User selects a file in the Knowledge Bases UI.
2. API validates environment access and stores the upload in the shared Docker volume.
3. API creates a `knowledge_source` and `knowledge_document` record.
4. API enqueues ingestion by setting document status to `queued` and creating an index
   version with status `pending`.
5. Worker reads queued documents.
6. Worker parses files with LlamaIndex readers.
7. Worker splits content into chunks and attaches governed metadata.
8. Worker embeds chunks with Ollama using the configured embedding model.
9. Worker writes chunks to pgvector and updates document, source, KB, and index version
   counts.
10. UI refreshes and shows indexed document/chunk counts or concrete errors.

The first implementation may run sync inline from the API command path if the worker loop
is not yet running, but the service boundary must allow the worker to take ownership.

## Retrieval Flow

The retrieval endpoint accepts query text and `top_k`. It loads KB metadata, verifies user
environment access, and retrieves only chunks matching the KB's governed scope.

When called from an agent assignment, retrieval must also apply:

- assignment `retrieval_mode`;
- assignment `top_k`;
- `score_threshold`;
- `metadata_filters`;
- `freshness_days`;
- `citation_required`.

Result payloads include:

- `content`;
- `score`;
- `kb_id`;
- `source_id`;
- `document_id`;
- `chunk_id`;
- `file_name`;
- `source_display_name`;
- `metadata`.

## Frontend Behavior

The Knowledge Bases page must treat file sources as real uploads:

- when source type is `file`, show a file input instead of asking the user to type a URI;
- after upload, show file name, content type, size, status, chunk count, and errors;
- make `Refresh index` enqueue or run ingestion and display useful progress/status;
- make `Test retrieval` return real snippets after indexing;
- show citation metadata in query results.

The page should keep the existing create/select/test structure, but the actions must now
perform real work instead of registering metadata-only records.

## Error Handling

Backend errors must be specific enough for the UI:

- unsupported file type;
- empty file;
- upload write failure;
- Ollama unavailable;
- embedding model missing;
- pgvector extension unavailable;
- parser produced no text;
- ingestion failed for a document;
- query attempted before any indexed chunks exist.

Failed documents keep their record and show `last_error`. A subsequent sync should retry
failed or queued documents without duplicating successfully indexed chunks.

## Testing Strategy

Tests should not require Ollama. Unit and API tests use a deterministic fake embedding
provider and a fake indexer where appropriate. Docker/manual verification uses real
Ollama.

Coverage required:

- schema declarations for documents and chunks;
- runtime schema patching for existing databases;
- file upload validation and document/source creation;
- ingestion state transitions and count updates;
- retrieval filters by `kb_id` and environment;
- query result citation metadata;
- UI upload payloads and TypeScript build.

## Acceptance Criteria

- Docker starts with pgvector-enabled Postgres.
- The API and worker images install LlamaIndex dependencies.
- `file` source selection exposes an actual file picker.
- Uploading a supported file creates a source and document record.
- Running refresh/sync indexes the uploaded file into pgvector using Ollama embeddings.
- Querying the KB returns indexed snippets with citations.
- Querying another KB cannot return chunks from the selected KB.
- Agent KB assignment retrieval policy remains preserved and enforceable.
- Backend tests, frontend typecheck, frontend build, and Docker smoke verification pass.
