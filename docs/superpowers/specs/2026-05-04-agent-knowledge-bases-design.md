# Agent Knowledge Bases Design

## Context

The current Knowledge Bases page at `/platform/?view=knowledge-bases` exposes a raw JSON form and a flat registered-resource list. That does not match the platform's current control-plane model: agents already have explicit tools, guardrails, evaluators, certification state, and audit evidence, while knowledge is still presented as a simple backend record.

The existing code already has the right primitives:

- `KnowledgeBase` supports `source_type` values of `vector_store`, `url`, and `file`.
- Agents can attach knowledge bases through `AgentKBAssignment`.
- Agent certification hash calculation includes assigned KB IDs.
- `/v1/knowledge-bases/{kb_id}/query` exists and delegates to `KBRetrieval`.
- The frontend fetches `knowledgeBases` and per-agent `knowledge` assignments as part of `PlatformData`.

The missing layer is a governed knowledge management model: sources, ingestion status, index health, retrieval configuration, and visible agent-level assignment contracts.

## Goal

Turn Knowledge Bases into a governed knowledge layer for each agent. A governance user should be able to register knowledge collections, understand where their content comes from, see whether they are indexed and healthy, attach them to agents with retrieval policy, test retrieval, and understand when KB changes require agent re-evaluation.

## Non-Goals

The first implementation should not build a full production ingestion service, background worker system, or external vector store integration. Those should be designed into the model but delivered after the UI and API foundation are usable.

The first implementation should not duplicate file content per agent. Knowledge should be managed as shared governed collections and attached to agents through assignment records.

## Recommended Architecture

Use a hybrid model:

- **Knowledge Base:** governed collection metadata. It has an owner, environment, domain, sensitivity, source count, index state, and assignment count.
- **Knowledge Source:** an input into a KB. Sources can be `file`, `url`, or `vector_store`. Each source has sync/index status, checksum or connector metadata, and error details.
- **Knowledge Document/Chunk:** derived searchable content created from file or URL sources. Vector-store sources may expose remote document metadata rather than locally owned chunks.
- **Index Version:** immutable evidence that a set of sources was parsed, chunked, embedded, and indexed at a point in time.
- **Agent KB Assignment:** retrieval contract between one agent and one KB. It controls access mode and retrieval settings.

The source of truth is KB/source/document/index metadata in the governance store. A vector store is an implementation detail behind a retrieval adapter, not the only system of record.

## Data Model

Extend `knowledge_bases` with governance and health fields:

- `owner`
- `domain`
- `sensitivity`
- `status`: `draft`, `ready`, `syncing`, `degraded`, `failed`, `archived`
- `document_count`
- `chunk_count`
- `assigned_agent_count`
- `last_indexed_at`
- `last_error`

Add `knowledge_sources`:

- `source_id`
- `kb_id`
- `source_type`: `file`, `url`, `vector_store`
- `display_name`
- `uri`
- `content_type`
- `source_config`
- `status`: `pending`, `syncing`, `ready`, `failed`
- `checksum`
- `last_synced_at`
- `last_error`

Add `knowledge_index_versions`:

- `index_version_id`
- `kb_id`
- `status`: `pending`, `indexing`, `ready`, `failed`
- `source_count`
- `document_count`
- `chunk_count`
- `embedding_model`
- `vector_backend`
- `created_at`
- `completed_at`
- `artifact_digest`
- `error`

Extend `agent_kb_assignments`:

- `retrieval_mode`: `semantic`, `keyword`, `hybrid`
- `top_k`
- `score_threshold`
- `citation_required`
- `freshness_days`
- `metadata_filters`

## API Design

Keep the current endpoints and add focused resource endpoints:

- `GET /v1/knowledge-bases`: list KBs with health and assignment summary.
- `POST /v1/knowledge-bases`: create/update KB metadata.
- `GET /v1/knowledge-bases/{kb_id}`: detail view payload.
- `GET /v1/knowledge-bases/{kb_id}/sources`: list source records.
- `POST /v1/knowledge-bases/{kb_id}/sources`: register a source.
- `POST /v1/knowledge-bases/{kb_id}/sync`: create a sync/index status record.
- `GET /v1/knowledge-bases/{kb_id}/index-versions`: list index evidence.
- `POST /v1/knowledge-bases/{kb_id}/query`: test retrieval.
- `POST /v1/agents/{agent_id}/knowledge-bases`: attach KB with retrieval settings.

All environment access checks should reuse the current `require_environment_access` and `require_agent_identity_for_access` patterns.

## Frontend Design

Replace the raw JSON form in the Knowledge Bases view with a first-class console:

- Metrics row: KBs, sources, indexed documents, assigned agents, degraded sources.
- KB list/table/cards with name, environment, source type mix, index status, assigned agents, last sync, and owner.
- Create KB action that uses structured fields rather than JSON.
- KB detail panel with tabs:
  - **Overview:** metadata, status, counts.
  - **Sources:** file/URL/vector-store source list and add-source form.
  - **Indexing:** latest index version, job history, errors.
  - **Test Query:** query input, top-k selector, retrieved snippets, scores, metadata.
  - **Agent Assignments:** attached agents and retrieval policies.

Keep agent-level attachment in `SelectedAgentModal`, but make it richer:

- show KB status before attach;
- allow retrieval settings on attach;
- show assignment policy for already attached KBs;
- show a warning when a KB is degraded or not indexed.

## Retrieval Behavior

Runtime retrieval should be scoped to the agent's assigned KBs. A retrieval request should include:

- `agent_id`
- `kb_id`
- query text
- assignment retrieval settings
- environment

Retrieval should return snippets with:

- content
- score
- `kb_id`
- `source_id`
- document or chunk identifier
- source URI/display name

The existing `KBRetrieval` can stay as the first adapter. Later, introduce an adapter interface for local pgvector, existing `AdvisorRAG`, and external vector stores.

## Governance Behavior

Changing an agent KB assignment should continue to invalidate agent certification.

When a KB's ready index version changes, all certified agents attached to that KB should move to `NEEDS_REEVALUATION` with reason `knowledge base index changed`.

Query/test retrieval should produce audit evidence once retrieval is used by runtime execution. The first UI-only test query may remain unaudited, but production agent retrieval should emit an audit event with query hash and retrieved chunk metadata.

## Error Handling

The UI should distinguish these states:

- no KBs registered;
- KB exists but has no sources;
- source registered but not indexed;
- indexing failed;
- vector connector unavailable;
- query returned no matches;
- user lacks environment access.

Backend errors should return concrete messages that can be shown directly in the UI.

## Implementation Sequence

1. Build the KB console foundation with structured UI, current endpoints, source metadata, richer assignment config, and query tester.
2. Add source/index metadata tables and store methods.
3. Add sync/index status records that update health without full file parsing.
4. Add real file upload and parsing.
5. Add local vector indexing.
6. Add external vector store adapters.
7. Add runtime retrieval audit evidence and certification invalidation on index changes.

## Acceptance Criteria

- `/platform/?view=knowledge-bases` no longer shows a raw JSON builder as the primary experience.
- A governance user can create a KB through structured fields.
- A governance user can register at least URL, file metadata, and vector-store metadata sources.
- A governance user can see KB health, source count, assignment count, and latest indexing status.
- A governance user can attach a KB to an agent with retrieval settings.
- A governance user can test retrieval from the KB detail view.
- Backend tests cover KB source lifecycle and assignment retrieval config.
- Frontend TypeScript and build verification pass.
