from __future__ import annotations

from io import BytesIO
from typing import Any

import anyio
import pytest
from fastapi import HTTPException
from pgvector.sqlalchemy import Vector
from pydantic import ValidationError
from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, select
from sqlalchemy.dialects.postgresql import JSONB
from starlette.datastructures import Headers, UploadFile

import agent_governance.db as runtime_db
import api.main as api_main
from api.main import (
    AgentKBAssignmentRequest,
    KnowledgeBaseRequest,
    KnowledgeSourceRequest,
    KnowledgeSyncRequest,
)
from agent_governance.models import (
    AgentKBAssignment,
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeIndexVersion,
    KnowledgeSource,
)
from agent_governance.store import GovernanceStore


def _column(model: type, name: str):
    return model.__table__.c[name]


def _default_arg(model: type, name: str):
    return _column(model, name).default.arg


def _default_factory_value(model: type, name: str):
    return _default_arg(model, name)(None)


def _assert_assignment_policy(
    assignment: dict,
    *,
    retrieval_mode: str,
    top_k: int,
    score_threshold: float | None,
    citation_required: bool,
    freshness_days: int | None,
    metadata_filters: dict,
) -> None:
    assert assignment["retrieval_mode"] == retrieval_mode
    assert assignment["top_k"] == top_k
    assert assignment["score_threshold"] == score_threshold
    assert assignment["citation_required"] is citation_required
    assert assignment["freshness_days"] == freshness_days
    assert assignment["metadata_filters"] == metadata_filters


def _super_admin_user() -> dict:
    return {
        "role": "Admin",
        "is_super_admin": True,
        "allowed_environments": [],
        "permissions_by_environment": {},
    }


def _create_file_document(
    store: GovernanceStore,
    kb_id: str,
    *,
    label: str = "Claims SOP",
) -> tuple[dict[str, Any], dict[str, Any]]:
    normalized_label = label.lower().replace(" ", "-")
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
            "display_name": label,
            "uri": f"file://{normalized_label}.txt",
            "content_type": "text/plain",
            "source_config": {},
        },
    )
    document = store.create_knowledge_document(
        kb_id,
        source["source_id"],
        {
            "file_name": f"{normalized_label}.txt",
            "content_type": "text/plain",
            "storage_uri": f"file:///tmp/{normalized_label}.txt",
            "size_bytes": 42,
            "checksum": f"{normalized_label}-checksum",
        },
    )
    return source, document


def test_knowledge_models_are_declared() -> None:
    assert KnowledgeBase.__tablename__ == "knowledge_bases"
    assert KnowledgeSource.__tablename__ == "knowledge_sources"
    assert KnowledgeDocument.__tablename__ == "knowledge_documents"
    assert KnowledgeChunk.__tablename__ == "knowledge_chunks"
    assert KnowledgeIndexVersion.__tablename__ == "knowledge_index_versions"
    assert AgentKBAssignment.__tablename__ == "agent_kb_assignments"


def test_knowledge_base_metadata_fields_are_declared() -> None:
    assert isinstance(_column(KnowledgeBase, "owner").type, String)
    assert _column(KnowledgeBase, "owner").type.length == 120
    assert _column(KnowledgeBase, "owner").nullable is False
    assert _default_arg(KnowledgeBase, "owner") == "Unassigned"

    assert isinstance(_column(KnowledgeBase, "domain").type, String)
    assert _column(KnowledgeBase, "domain").type.length == 80
    assert _column(KnowledgeBase, "domain").nullable is False
    assert _default_arg(KnowledgeBase, "domain") == ""

    assert isinstance(_column(KnowledgeBase, "document_count").type, Integer)
    assert _column(KnowledgeBase, "document_count").nullable is False
    assert _default_arg(KnowledgeBase, "document_count") == 0

    assert isinstance(_column(KnowledgeBase, "last_indexed_at").type, DateTime)
    assert _column(KnowledgeBase, "last_indexed_at").type.timezone is True
    assert _column(KnowledgeBase, "last_indexed_at").nullable is True
    assert isinstance(_column(KnowledgeBase, "last_error").type, Text)
    assert _column(KnowledgeBase, "last_error").nullable is True


def test_knowledge_source_and_index_version_columns_are_declared() -> None:
    assert _column(KnowledgeSource, "source_id").primary_key is True
    assert _column(KnowledgeSource, "kb_id").nullable is False
    assert [fk.target_fullname for fk in _column(KnowledgeSource, "kb_id").foreign_keys] == [
        "knowledge_bases.kb_id"
    ]
    assert isinstance(_column(KnowledgeSource, "source_config").type, JSONB)
    assert _default_factory_value(KnowledgeSource, "source_config") == {}
    assert _default_arg(KnowledgeSource, "status") == "pending"

    assert _column(KnowledgeIndexVersion, "index_version_id").primary_key is True
    assert _column(KnowledgeIndexVersion, "kb_id").nullable is False
    assert [fk.target_fullname for fk in _column(KnowledgeIndexVersion, "kb_id").foreign_keys] == [
        "knowledge_bases.kb_id"
    ]
    assert isinstance(_column(KnowledgeIndexVersion, "source_count").type, Integer)
    assert _default_arg(KnowledgeIndexVersion, "source_count") == 0
    assert _default_arg(KnowledgeIndexVersion, "vector_backend") == "local"
    assert _column(KnowledgeIndexVersion, "completed_at").nullable is True


def test_knowledge_document_and_chunk_columns_are_declared() -> None:
    assert _column(KnowledgeDocument, "document_id").primary_key is True
    assert _column(KnowledgeDocument, "kb_id").nullable is False
    assert [fk.target_fullname for fk in _column(KnowledgeDocument, "kb_id").foreign_keys] == [
        "knowledge_bases.kb_id"
    ]
    assert [
        fk.target_fullname for fk in _column(KnowledgeDocument, "source_id").foreign_keys
    ] == [
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
    assert isinstance(_column(KnowledgeChunk, "embedding").type, Vector)
    assert isinstance(_column(KnowledgeChunk, "metadata").type, JSONB)
    assert _column(KnowledgeChunk, "metadata").nullable is False
    assert _default_factory_value(KnowledgeChunk, "metadata") == {}

    metadata_column = KnowledgeChunk.metadata_json.property.columns[0]
    assert metadata_column is _column(KnowledgeChunk, "metadata")
    assert metadata_column.name == "metadata"
    assert metadata_column.key == "metadata"


def test_agent_kb_assignment_retrieval_policy_fields_are_declared() -> None:
    assert isinstance(_column(AgentKBAssignment, "retrieval_mode").type, String)
    assert _column(AgentKBAssignment, "retrieval_mode").type.length == 20
    assert _column(AgentKBAssignment, "retrieval_mode").nullable is False
    assert _default_arg(AgentKBAssignment, "retrieval_mode") == "hybrid"

    assert isinstance(_column(AgentKBAssignment, "top_k").type, Integer)
    assert _column(AgentKBAssignment, "top_k").nullable is False
    assert _default_arg(AgentKBAssignment, "top_k") == 5

    assert isinstance(_column(AgentKBAssignment, "score_threshold").type, Float)
    assert _column(AgentKBAssignment, "score_threshold").nullable is True
    assert isinstance(_column(AgentKBAssignment, "citation_required").type, Boolean)
    assert _column(AgentKBAssignment, "citation_required").nullable is False
    assert _default_arg(AgentKBAssignment, "citation_required") is True
    assert _column(AgentKBAssignment, "freshness_days").nullable is True
    assert isinstance(_column(AgentKBAssignment, "metadata_filters").type, JSONB)
    assert _default_factory_value(AgentKBAssignment, "metadata_filters") == {}


def test_knowledge_base_request_accepts_metadata_fields() -> None:
    request = KnowledgeBaseRequest(
        kb_id="claims-policy-kb",
        display_name="Claims Policy KB",
        source_type="file",
        owner="Claims Ops",
        domain="claims",
        sensitivity="confidential",
        embedding_model="local/claims-embedding",
    )

    assert request.model_dump() == {
        "kb_id": "claims-policy-kb",
        "display_name": "Claims Policy KB",
        "description": "",
        "source_type": "file",
        "source_config": {},
        "environment": "demo",
        "owner": "Claims Ops",
        "domain": "claims",
        "sensitivity": "confidential",
        "embedding_model": "local/claims-embedding",
    }


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        (
            {
                "kb_id": "",
                "display_name": "Claims Policy KB",
                "source_type": "file",
            },
            "kb_id",
        ),
        (
            {
                "kb_id": "claims-policy-kb",
                "display_name": "",
                "source_type": "file",
            },
            "display_name",
        ),
        (
            {
                "kb_id": "claims-policy-kb",
                "display_name": "Claims Policy KB",
                "source_type": "file",
                "environment": "",
            },
            "environment",
        ),
    ],
)
def test_knowledge_base_request_rejects_blank_required_fields(
    payload: dict[str, str],
    field: str,
) -> None:
    with pytest.raises(ValidationError) as exc_info:
        KnowledgeBaseRequest(**payload)

    assert exc_info.value.errors()[0]["loc"] == (field,)


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"source_type": "file", "display_name": ""}, "display_name"),
        ({"source_type": "", "display_name": "Claims SOP"}, "source_type"),
    ],
)
def test_knowledge_source_request_rejects_blank_required_fields(
    payload: dict[str, str],
    field: str,
) -> None:
    with pytest.raises(ValidationError) as exc_info:
        KnowledgeSourceRequest(**payload)

    assert exc_info.value.errors()[0]["loc"] == (field,)


def test_init_db_creates_vector_extension_before_tables(monkeypatch) -> None:
    calls: list[str] = []
    engine = object()

    monkeypatch.setattr(runtime_db, "build_engine", lambda _database_url: engine)
    monkeypatch.setattr(
        runtime_db,
        "ensure_vector_extension",
        lambda passed_engine: calls.append(
            "vector" if passed_engine is engine else "wrong-engine"
        ),
        raising=False,
    )
    monkeypatch.setattr(
        runtime_db.Base.metadata,
        "create_all",
        lambda passed_engine: calls.append(
            "create_all" if passed_engine is engine else "wrong-engine"
        ),
    )
    monkeypatch.setattr(
        runtime_db,
        "ensure_runtime_schema",
        lambda passed_engine: calls.append(
            "runtime_schema" if passed_engine is engine else "wrong-engine"
        ),
    )

    runtime_db.init_db("postgresql+psycopg://test/test")

    assert calls == ["vector", "create_all", "runtime_schema"]


def test_runtime_schema_patches_existing_knowledge_tables(monkeypatch) -> None:
    class FakeInspector:
        def get_table_names(self) -> list[str]:
            return ["knowledge_bases", "agent_kb_assignments"]

        def get_columns(self, table_name: str) -> list[dict[str, str]]:
            columns_by_table = {
                "knowledge_bases": [
                    {"name": "kb_id"},
                    {"name": "display_name"},
                    {"name": "description"},
                    {"name": "source_type"},
                    {"name": "source_config"},
                    {"name": "environment"},
                    {"name": "created_at"},
                    {"name": "updated_at"},
                ],
                "agent_kb_assignments": [
                    {"name": "assignment_id"},
                    {"name": "agent_id"},
                    {"name": "kb_id"},
                    {"name": "access_mode"},
                    {"name": "created_at"},
                ],
            }
            return columns_by_table[table_name]

    class FakeConnection:
        def __init__(self) -> None:
            self.statements: list[str] = []

        def execute(self, statement) -> None:
            self.statements.append(str(statement))

    class FakeBegin:
        def __init__(self, connection: FakeConnection) -> None:
            self.connection = connection

        def __enter__(self) -> FakeConnection:
            return self.connection

        def __exit__(self, *args: object) -> None:
            return None

    class FakeEngine:
        def __init__(self) -> None:
            self.connection = FakeConnection()

        def begin(self) -> FakeBegin:
            return FakeBegin(self.connection)

    engine = FakeEngine()
    monkeypatch.setattr(runtime_db, "inspect", lambda _engine: FakeInspector())
    monkeypatch.setattr(
        KnowledgeSource.__table__,
        "create",
        lambda engine, checkfirst=True: engine.connection.statements.append(
            "CREATE TABLE knowledge_sources"
        ),
    )
    monkeypatch.setattr(
        KnowledgeIndexVersion.__table__,
        "create",
        lambda engine, checkfirst=True: engine.connection.statements.append(
            "CREATE TABLE knowledge_index_versions"
        ),
    )
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

    runtime_db.ensure_runtime_schema(engine)

    statements = "\n".join(engine.connection.statements)
    assert any(
        "CREATE EXTENSION IF NOT EXISTS vector" in statement
        for statement in engine.connection.statements
    )
    created_knowledge_tables = [
        statement
        for statement in engine.connection.statements
        if statement.startswith("CREATE TABLE knowledge_")
    ]
    assert created_knowledge_tables == [
        "CREATE TABLE knowledge_sources",
        "CREATE TABLE knowledge_index_versions",
        "CREATE TABLE knowledge_documents",
        "CREATE TABLE knowledge_chunks",
    ]
    expected_column_snippets = (
        "ADD COLUMN owner VARCHAR(120) NOT NULL DEFAULT 'Unassigned'",
        "ADD COLUMN domain VARCHAR(80) NOT NULL DEFAULT ''",
        "ADD COLUMN sensitivity VARCHAR(40) NOT NULL DEFAULT 'internal'",
        "ADD COLUMN status VARCHAR(40) NOT NULL DEFAULT 'draft'",
        "ADD COLUMN document_count INTEGER NOT NULL DEFAULT 0",
        "ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 0",
        "ADD COLUMN last_indexed_at TIMESTAMP WITH TIME ZONE",
        "ADD COLUMN last_error TEXT",
        "ADD COLUMN retrieval_mode VARCHAR(20) NOT NULL DEFAULT 'hybrid'",
        "ADD COLUMN top_k INTEGER NOT NULL DEFAULT 5",
        "ADD COLUMN score_threshold FLOAT",
        "ADD COLUMN citation_required BOOLEAN NOT NULL DEFAULT TRUE",
        "ADD COLUMN freshness_days INTEGER",
        "ADD COLUMN metadata_filters JSONB NOT NULL DEFAULT '{}'::jsonb",
    )
    for snippet in expected_column_snippets:
        assert snippet in statements


def test_runtime_schema_creates_all_missing_knowledge_tables_in_order(monkeypatch) -> None:
    class FakeInspector:
        def get_table_names(self) -> list[str]:
            return []

    class FakeConnection:
        def __init__(self) -> None:
            self.statements: list[str] = []

        def execute(self, statement) -> None:
            self.statements.append(str(statement))

    class FakeBegin:
        def __init__(self, connection: FakeConnection) -> None:
            self.connection = connection

        def __enter__(self) -> FakeConnection:
            return self.connection

        def __exit__(self, *args: object) -> None:
            return None

    class FakeEngine:
        def __init__(self) -> None:
            self.connection = FakeConnection()

        def begin(self) -> FakeBegin:
            return FakeBegin(self.connection)

    engine = FakeEngine()
    monkeypatch.setattr(runtime_db, "inspect", lambda _engine: FakeInspector())
    for table, table_name in (
        (KnowledgeBase.__table__, "knowledge_bases"),
        (KnowledgeSource.__table__, "knowledge_sources"),
        (KnowledgeIndexVersion.__table__, "knowledge_index_versions"),
        (KnowledgeDocument.__table__, "knowledge_documents"),
        (KnowledgeChunk.__table__, "knowledge_chunks"),
    ):
        monkeypatch.setattr(
            table,
            "create",
            lambda engine, checkfirst=True, table_name=table_name: (
                engine.connection.statements.append(f"CREATE TABLE {table_name}")
            ),
        )

    runtime_db.ensure_runtime_schema(engine)

    created_knowledge_tables = [
        statement
        for statement in engine.connection.statements
        if statement.startswith("CREATE TABLE knowledge_")
    ]
    assert created_knowledge_tables == [
        "CREATE TABLE knowledge_bases",
        "CREATE TABLE knowledge_sources",
        "CREATE TABLE knowledge_index_versions",
        "CREATE TABLE knowledge_documents",
        "CREATE TABLE knowledge_chunks",
    ]


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
    assert detailed["status"] == "ready"
    assert detailed["document_count"] == 1
    assert detailed["chunk_count"] == 12
    assert detailed["last_indexed_at"]
    assert detailed["latest_index"]["chunk_count"] == 12
    listed = store.list_knowledge_bases(environment="demo")
    listed_kb = next(item for item in listed if item["kb_id"] == "claims-policy-kb")
    assert listed_kb["source_count"] == 1
    assert listed_kb["assigned_agent_count"] == 0
    assert listed_kb["latest_index"]["embedding_model"] == "local/test-embedding"

    updated = store.upsert_knowledge_base(
        {
            "kb_id": "claims-policy-kb",
            "display_name": "Claims Policy KB",
            "description": "Claims operating procedures.",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
            "domain": "",
        }
    )

    assert updated["domain"] == ""


def test_knowledge_document_and_chunk_lifecycle_updates_counts(
    store: GovernanceStore,
) -> None:
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
    assert store.get_knowledge_document(document["document_id"])["checksum"] == "abc123"

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
    chunk_count = store.replace_knowledge_chunks(
        document["document_id"],
        index["index_version_id"],
        [
            {
                "chunk_index": 0,
                "content": "Claims must be reviewed within two business days.",
                "content_hash": "chunk-a",
                "embedding": [0.1] * 768,
                "metadata": {
                    "kb_id": "claims-doc-kb",
                    "file_name": "claims-sop.txt",
                    "page_label": "1",
                    "section": "intake",
                },
            },
            {
                "chunk_index": 1,
                "content": "Escalate claims over the authority threshold.",
                "content_hash": "chunk-b",
                "embedding": [0.2] * 768,
                "metadata": {
                    "kb_id": "claims-doc-kb",
                    "file_name": "claims-sop.txt",
                    "page_label": "2",
                    "section": "escalation",
                },
            },
        ],
    )
    updated = store.mark_knowledge_document_indexed(document["document_id"], 2)
    aggregate = store.refresh_knowledge_base_index_state(
        "claims-doc-kb", index["index_version_id"]
    )

    assert chunk_count == 2
    assert updated["status"] == "indexed"
    assert updated["chunk_count"] == 2
    assert updated["indexed_at"]
    assert aggregate["document_count"] == 1
    assert aggregate["chunk_count"] == 2
    assert aggregate["status"] == "ready"
    assert aggregate["last_indexed_at"]

    with store.session() as db:
        chunks = db.scalars(
            select(KnowledgeChunk)
            .where(KnowledgeChunk.document_id == document["document_id"])
            .order_by(KnowledgeChunk.chunk_index)
        ).all()
        nearest_chunk = db.scalars(
            select(KnowledgeChunk)
            .where(KnowledgeChunk.kb_id == "claims-doc-kb")
            .order_by(KnowledgeChunk.embedding.cosine_distance([0.1] * 768))
            .limit(1)
        ).one()

    assert [chunk.content_hash for chunk in chunks] == ["chunk-a", "chunk-b"]
    assert chunks[0].metadata_json == {
        "kb_id": "claims-doc-kb",
        "file_name": "claims-sop.txt",
        "page_label": "1",
        "section": "intake",
    }
    assert chunks[0].index_version_id == index["index_version_id"]
    assert nearest_chunk.content_hash == "chunk-a"


def test_knowledge_document_status_updates_source(store: GovernanceStore) -> None:
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-failed-doc-kb",
            "display_name": "Claims Failed Doc KB",
            "description": "",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )
    source = store.upsert_knowledge_source(
        "claims-failed-doc-kb",
        {
            "source_type": "file",
            "display_name": "Claims SOP",
            "uri": "file://claims-sop.txt",
            "content_type": "text/plain",
            "source_config": {},
        },
    )
    document = store.create_knowledge_document(
        "claims-failed-doc-kb",
        source["source_id"],
        {
            "file_name": "claims-sop.txt",
            "content_type": "text/plain",
            "storage_uri": "file:///tmp/claims-sop.txt",
            "size_bytes": 42,
            "checksum": "abc123",
        },
    )

    failed = store.mark_knowledge_document_status(
        document["document_id"], "failed", "Parser failed"
    )
    sources = store.list_knowledge_sources("claims-failed-doc-kb")

    assert failed["status"] == "failed"
    assert failed["last_error"] == "Parser failed"
    assert sources[0]["status"] == "failed"
    assert sources[0]["last_error"] == "One or more documents failed ingestion"


def test_knowledge_document_indexed_keeps_source_degraded_with_failed_sibling(
    store: GovernanceStore,
) -> None:
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-source-sibling-kb",
            "display_name": "Claims Source Sibling KB",
            "description": "",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )
    source = store.upsert_knowledge_source(
        "claims-source-sibling-kb",
        {
            "source_type": "file",
            "display_name": "Claims SOP",
            "uri": "file://claims-sop.txt",
            "content_type": "text/plain",
            "source_config": {},
        },
    )
    failed_document = store.create_knowledge_document(
        "claims-source-sibling-kb",
        source["source_id"],
        {
            "file_name": "claims-failed.txt",
            "content_type": "text/plain",
            "storage_uri": "file:///tmp/claims-failed.txt",
            "size_bytes": 42,
            "checksum": "failed-checksum",
        },
    )
    indexed_document = store.create_knowledge_document(
        "claims-source-sibling-kb",
        source["source_id"],
        {
            "file_name": "claims-indexed.txt",
            "content_type": "text/plain",
            "storage_uri": "file:///tmp/claims-indexed.txt",
            "size_bytes": 84,
            "checksum": "indexed-checksum",
        },
    )

    store.mark_knowledge_document_status(
        failed_document["document_id"], "failed", "Parser failed"
    )
    store.mark_knowledge_document_indexed(indexed_document["document_id"], 1)
    sources = store.list_knowledge_sources("claims-source-sibling-kb")

    assert sources[0]["status"] == "degraded"
    assert sources[0]["last_error"] == "One or more documents failed ingestion"


def test_knowledge_document_status_keeps_source_degraded_with_failed_sibling(
    store: GovernanceStore,
) -> None:
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-source-transient-sibling-kb",
            "display_name": "Claims Source Transient Sibling KB",
            "description": "",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )
    source = store.upsert_knowledge_source(
        "claims-source-transient-sibling-kb",
        {
            "source_type": "file",
            "display_name": "Claims SOP",
            "uri": "file://claims-sop.txt",
            "content_type": "text/plain",
            "source_config": {},
        },
    )
    failed_document = store.create_knowledge_document(
        "claims-source-transient-sibling-kb",
        source["source_id"],
        {
            "file_name": "claims-failed.txt",
            "content_type": "text/plain",
            "storage_uri": "file:///tmp/claims-failed.txt",
            "size_bytes": 42,
            "checksum": "failed-transient-checksum",
        },
    )
    parsing_document = store.create_knowledge_document(
        "claims-source-transient-sibling-kb",
        source["source_id"],
        {
            "file_name": "claims-parsing.txt",
            "content_type": "text/plain",
            "storage_uri": "file:///tmp/claims-parsing.txt",
            "size_bytes": 84,
            "checksum": "parsing-checksum",
        },
    )

    store.mark_knowledge_document_status(
        failed_document["document_id"], "failed", "Parser failed"
    )
    store.mark_knowledge_document_status(parsing_document["document_id"], "parsing")
    sources = store.list_knowledge_sources("claims-source-transient-sibling-kb")

    assert sources[0]["status"] == "degraded"
    assert sources[0]["last_error"] == "One or more documents failed ingestion"


def test_knowledge_document_status_rejects_unknown_status(store: GovernanceStore) -> None:
    source, document = _create_file_document(store, "claims-status-vocabulary-kb")

    with pytest.raises(ValueError, match="Unsupported knowledge document status 'archived'"):
        store.mark_knowledge_document_status(document["document_id"], "archived")

    with pytest.raises(ValueError, match="Unsupported knowledge document status 'archived'"):
        store.create_knowledge_document(
            "claims-status-vocabulary-kb",
            source["source_id"],
            {
                "file_name": "archived.txt",
                "content_type": "text/plain",
                "storage_uri": "file:///tmp/archived.txt",
                "size_bytes": 42,
                "checksum": "archived-checksum",
                "status": "archived",
            },
        )


def test_replace_knowledge_chunks_validates_index_version_kb(store: GovernanceStore) -> None:
    _, document = _create_file_document(store, "claims-index-validation-kb")
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-other-index-kb",
            "display_name": "Claims Other Index KB",
            "description": "",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )
    other_index = store.create_knowledge_index_version(
        "claims-other-index-kb",
        {
            "status": "indexing",
            "embedding_model": "nomic-embed-text",
            "vector_backend": "pgvector",
        },
    )

    with pytest.raises(ValueError, match="Knowledge index version 'missing-index' not found"):
        store.replace_knowledge_chunks(document["document_id"], "missing-index", [])

    with pytest.raises(ValueError, match="belongs to knowledge base 'claims-other-index-kb'"):
        store.replace_knowledge_chunks(
            document["document_id"], other_index["index_version_id"], []
        )


def test_refresh_knowledge_base_index_state_validates_index_version(
    store: GovernanceStore,
) -> None:
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-refresh-validation-kb",
            "display_name": "Claims Refresh Validation KB",
            "description": "",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-refresh-other-kb",
            "display_name": "Claims Refresh Other KB",
            "description": "",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )
    other_index = store.create_knowledge_index_version(
        "claims-refresh-other-kb",
        {
            "status": "indexing",
            "embedding_model": "nomic-embed-text",
            "vector_backend": "pgvector",
        },
    )

    with pytest.raises(ValueError, match="Knowledge index version 'missing-index' not found"):
        store.refresh_knowledge_base_index_state("claims-refresh-validation-kb", "missing-index")

    with pytest.raises(ValueError, match="belongs to knowledge base 'claims-refresh-other-kb'"):
        store.refresh_knowledge_base_index_state(
            "claims-refresh-validation-kb", other_index["index_version_id"]
        )


def test_replace_knowledge_chunks_is_idempotent_for_document_index(
    store: GovernanceStore,
) -> None:
    _, document = _create_file_document(store, "claims-idempotent-chunks-kb")
    index = store.create_knowledge_index_version(
        "claims-idempotent-chunks-kb",
        {
            "status": "indexing",
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
                "content": "Old chunk",
                "content_hash": "old-a",
                "embedding": [0.1] * 768,
                "metadata": {"version": "old"},
            },
            {
                "chunk_index": 1,
                "content": "Old second chunk",
                "content_hash": "old-b",
                "embedding": [0.2] * 768,
                "metadata": {"version": "old"},
            },
        ],
    )
    store.replace_knowledge_chunks(
        document["document_id"],
        index["index_version_id"],
        [
            {
                "chunk_index": 0,
                "content": "Replacement chunk",
                "content_hash": "new-a",
                "embedding": [0.3] * 768,
                "metadata": {"version": "new"},
            }
        ],
    )

    with store.session() as db:
        chunks = db.scalars(
            select(KnowledgeChunk)
            .where(KnowledgeChunk.document_id == document["document_id"])
            .order_by(KnowledgeChunk.chunk_index)
        ).all()

    assert [chunk.content_hash for chunk in chunks] == ["new-a"]
    assert chunks[0].metadata_json == {"version": "new"}


def test_refresh_ignores_chunks_for_unindexed_documents(store: GovernanceStore) -> None:
    _, document = _create_file_document(store, "claims-interrupted-ingestion-kb")
    index = store.create_knowledge_index_version(
        "claims-interrupted-ingestion-kb",
        {
            "status": "indexing",
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
                "content": "Persisted before document status flipped.",
                "content_hash": "interrupted-chunk",
                "embedding": [0.1] * 768,
                "metadata": {"version": "interrupted"},
            }
        ],
    )

    aggregate = store.refresh_knowledge_base_index_state(
        "claims-interrupted-ingestion-kb", index["index_version_id"]
    )

    with store.session() as db:
        refreshed_document = db.get(KnowledgeDocument, document["document_id"])
        refreshed_index = db.get(KnowledgeIndexVersion, index["index_version_id"])

    assert refreshed_document.status == "uploaded"
    assert aggregate["status"] == "draft"
    assert aggregate["document_count"] == 0
    assert aggregate["chunk_count"] == 0
    assert refreshed_index.status == "pending"
    assert refreshed_index.document_count == 0
    assert refreshed_index.chunk_count == 0


def test_refresh_counts_only_provided_index_version(store: GovernanceStore) -> None:
    _, document = _create_file_document(store, "claims-scoped-refresh-kb")
    old_index = store.create_knowledge_index_version(
        "claims-scoped-refresh-kb",
        {
            "status": "indexing",
            "embedding_model": "nomic-embed-text",
            "vector_backend": "pgvector",
        },
    )
    store.replace_knowledge_chunks(
        document["document_id"],
        old_index["index_version_id"],
        [
            {
                "chunk_index": 0,
                "content": "Old indexed chunk",
                "content_hash": "old-index-chunk",
                "embedding": [0.1] * 768,
                "metadata": {"version": "old"},
            }
        ],
    )
    store.mark_knowledge_document_indexed(document["document_id"], 1)
    store.refresh_knowledge_base_index_state("claims-scoped-refresh-kb", old_index["index_version_id"])

    new_index = store.create_knowledge_index_version(
        "claims-scoped-refresh-kb",
        {
            "status": "indexing",
            "embedding_model": "nomic-embed-text",
            "vector_backend": "pgvector",
        },
    )

    aggregate = store.refresh_knowledge_base_index_state(
        "claims-scoped-refresh-kb", new_index["index_version_id"]
    )

    with store.session() as db:
        refreshed_index = db.get(KnowledgeIndexVersion, new_index["index_version_id"])

    assert aggregate["document_count"] == 0
    assert aggregate["chunk_count"] == 0
    assert aggregate["status"] == "draft"
    assert refreshed_index.status == "pending"
    assert refreshed_index.document_count == 0
    assert refreshed_index.chunk_count == 0


def test_refresh_degrades_when_indexed_and_failed_documents_mix(
    store: GovernanceStore,
) -> None:
    _, indexed_document = _create_file_document(
        store, "claims-degraded-health-kb", label="Claims Indexed SOP"
    )
    _, failed_document = _create_file_document(
        store, "claims-degraded-health-kb", label="Claims Failed SOP"
    )
    index = store.create_knowledge_index_version(
        "claims-degraded-health-kb",
        {
            "status": "indexing",
            "embedding_model": "nomic-embed-text",
            "vector_backend": "pgvector",
        },
    )
    store.replace_knowledge_chunks(
        indexed_document["document_id"],
        index["index_version_id"],
        [
            {
                "chunk_index": 0,
                "content": "Indexed chunk",
                "content_hash": "indexed-chunk",
                "embedding": [0.1] * 768,
                "metadata": {"version": "current"},
            }
        ],
    )
    store.mark_knowledge_document_indexed(indexed_document["document_id"], 1)
    store.mark_knowledge_document_status(
        failed_document["document_id"], "failed", "Parser failed"
    )

    aggregate = store.refresh_knowledge_base_index_state(
        "claims-degraded-health-kb", index["index_version_id"]
    )

    with store.session() as db:
        refreshed_index = db.get(KnowledgeIndexVersion, index["index_version_id"])

    assert aggregate["status"] == "degraded"
    assert aggregate["document_count"] == 1
    assert aggregate["chunk_count"] == 1
    assert aggregate["last_error"] == "One or more documents failed ingestion"
    assert refreshed_index.status == "degraded"
    assert refreshed_index.error == "One or more documents failed ingestion"


def test_knowledge_base_embedding_model_is_stored_in_source_config(
    store: GovernanceStore,
) -> None:
    kb = store.upsert_knowledge_base(
        {
            "kb_id": "claims-embedding-kb",
            "display_name": "Claims Embedding KB",
            "description": "",
            "source_type": "file",
            "source_config": {"parser": "pdf"},
            "environment": "demo",
            "embedding_model": "local/claims-embedding",
        }
    )

    assert kb["embedding_model"] == "local/claims-embedding"
    assert kb["source_config"] == {
        "parser": "pdf",
        "embedding_model": "local/claims-embedding",
    }


def test_knowledge_base_update_preserves_existing_source_config(
    store: GovernanceStore,
) -> None:
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-config-kb",
            "display_name": "Claims Config KB",
            "description": "",
            "source_type": "file",
            "source_config": {"parser": "pdf", "connector": "s3"},
            "environment": "demo",
            "embedding_model": "local/initial",
        }
    )

    updated = store.upsert_knowledge_base(
        {
            "kb_id": "claims-config-kb",
            "display_name": "Claims Config KB",
            "description": "Updated metadata.",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
            "owner": "Claims Ops",
            "embedding_model": "local/updated",
        }
    )

    assert updated["source_config"] == {
        "parser": "pdf",
        "connector": "s3",
        "embedding_model": "local/updated",
    }
    assert updated["embedding_model"] == "local/updated"
    assert updated["owner"] == "Claims Ops"


def test_knowledge_source_upsert_rejects_source_id_from_other_kb(
    store: GovernanceStore,
) -> None:
    for kb_id in ("claims-policy-kb-a", "claims-policy-kb-b"):
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
        "claims-policy-kb-a",
        {
            "source_id": "claims-sop-source",
            "source_type": "file",
            "display_name": "Claims SOP",
            "uri": "file://claims-sop.pdf",
            "content_type": "application/pdf",
            "source_config": {},
        },
    )

    with pytest.raises(ValueError, match="belongs to knowledge base"):
        store.upsert_knowledge_source(
            "claims-policy-kb-b",
            {
                "source_id": source["source_id"],
                "source_type": "file",
                "display_name": "Other Claims SOP",
                "uri": "file://other-claims-sop.pdf",
                "content_type": "application/pdf",
                "source_config": {},
            },
        )

    sources_a = store.list_knowledge_sources("claims-policy-kb-a")
    sources_b = store.list_knowledge_sources("claims-policy-kb-b")
    assert sources_a[0]["display_name"] == "Claims SOP"
    assert sources_b == []


def test_knowledge_source_upsert_updates_same_kb_source(store: GovernanceStore) -> None:
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-policy-kb-update",
            "display_name": "Claims Policy KB",
            "description": "",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )

    created = store.upsert_knowledge_source(
        "claims-policy-kb-update",
        {
            "source_id": "claims-update-source",
            "source_type": "file",
            "display_name": "Claims SOP",
            "uri": "file://claims-sop.pdf",
            "content_type": "application/pdf",
            "source_config": {},
            "status": "synced",
        },
    )
    updated = store.upsert_knowledge_source(
        "claims-policy-kb-update",
        {
            "source_id": created["source_id"],
            "source_type": "file",
            "display_name": "Claims SOP v2",
            "uri": "file://claims-sop-v2.pdf",
            "content_type": "application/pdf",
            "source_config": {"parser": "pdf"},
            "status": "failed",
        },
    )

    assert created["status"] == "synced"
    assert updated["display_name"] == "Claims SOP v2"
    assert updated["status"] == "failed"
    sources = store.list_knowledge_sources("claims-policy-kb-update")
    assert len(sources) == 1
    assert sources[0]["source_id"] == created["source_id"]
    assert sources[0]["status"] == "failed"


def test_failed_knowledge_index_updates_kb_aggregate_health(store: GovernanceStore) -> None:
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-policy-kb-failed-index",
            "display_name": "Claims Policy KB",
            "description": "",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )

    index = store.create_knowledge_index_version(
        "claims-policy-kb-failed-index",
        {
            "status": "failed",
            "source_count": 1,
            "document_count": 0,
            "chunk_count": 0,
            "embedding_model": "local/test-embedding",
            "vector_backend": "local",
            "error": "Parser failed",
        },
    )

    assert index["status"] == "failed"
    assert index["completed_at"]
    detailed = store.get_knowledge_base_detail("claims-policy-kb-failed-index")
    assert detailed["status"] == "failed"
    assert detailed["last_error"] == "Parser failed"
    assert detailed["latest_index"]["error"] == "Parser failed"


def test_knowledge_source_and_index_reject_missing_kb(store: GovernanceStore) -> None:
    with pytest.raises(ValueError, match="Knowledge base 'missing-kb' not found"):
        store.upsert_knowledge_source(
            "missing-kb",
            {
                "source_type": "file",
                "display_name": "Missing",
                "uri": "file://missing.pdf",
                "content_type": "application/pdf",
                "source_config": {},
            },
        )

    with pytest.raises(ValueError, match="Knowledge base 'missing-kb' not found"):
        store.create_knowledge_index_version(
            "missing-kb",
            {
                "status": "failed",
                "error": "Missing KB",
            },
        )


def test_create_knowledge_source_translates_expected_store_errors(monkeypatch) -> None:
    class FakeStore:
        def get_knowledge_base(self, kb_id: str) -> dict:
            return {"kb_id": kb_id, "environment": "demo"}

        def upsert_knowledge_source(self, kb_id: str, payload: dict) -> dict:
            raise ValueError("Source 'shared-source' belongs to knowledge base 'other-kb'")

    monkeypatch.setattr(api_main, "store", FakeStore())

    with pytest.raises(HTTPException) as exc_info:
        api_main.create_knowledge_source(
            "claims-policy-kb",
            KnowledgeSourceRequest(
                source_id="shared-source",
                source_type="file",
                display_name="Claims SOP",
            ),
            _super_admin_user(),
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Source 'shared-source' belongs to knowledge base 'other-kb'"


def test_sync_knowledge_base_creates_pending_status_for_pending_source(
    monkeypatch,
    store: GovernanceStore,
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-policy-kb-sync",
            "display_name": "Claims Policy KB",
            "description": "Claims operating procedures.",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )
    store.upsert_knowledge_source(
        "claims-policy-kb-sync",
        {
            "source_type": "file",
            "display_name": "Claims SOP",
            "uri": "file://claims-sop.pdf",
            "content_type": "application/pdf",
            "source_config": {},
        },
    )

    index = api_main.create_knowledge_sync_status(
        "claims-policy-kb-sync",
        KnowledgeSyncRequest(),
        _super_admin_user(),
    )

    assert index["status"] == "pending"
    assert index["source_count"] == 1
    assert index["document_count"] == 0
    assert index["chunk_count"] == 0


def test_upload_knowledge_file_creates_source_and_document(
    monkeypatch: pytest.MonkeyPatch, store: GovernanceStore, tmp_path
) -> None:
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
    sources = store.list_knowledge_sources("claims-upload-kb")
    assert sources[0]["source_type"] == "file"
    assert sources[0]["uri"] == document["storage_uri"]


def test_list_knowledge_documents_returns_uploaded_files(
    monkeypatch: pytest.MonkeyPatch, store: GovernanceStore
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    _source, document = _create_file_document(store, "claims-documents-kb")

    documents = api_main.list_knowledge_documents(
        "claims-documents-kb",
        _super_admin_user(),
    )

    assert documents == [document]


def test_query_knowledge_base_uses_retrieval_service(
    monkeypatch: pytest.MonkeyPatch, store: GovernanceStore
) -> None:
    class FakeRetrieval:
        def __init__(self, _store):
            pass

        def query(
            self,
            kb_id: str,
            query: str,
            environment: str,
            top_k: int = 5,
        ) -> list[api_main.RetrievedDoc]:
            return [
                api_main.RetrievedDoc(
                    content=f"{kb_id}:{query}:{environment}:{top_k}",
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
            "content": "claims-query-kb:review:demo:3",
            "score": 0.9,
            "metadata": {"kb_id": "claims-query-kb", "chunk_id": "chunk_1"},
        }
    ]


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

    _assert_assignment_policy(
        assignment,
        retrieval_mode="hybrid",
        top_k=8,
        score_threshold=0.72,
        citation_required=True,
        freshness_days=30,
        metadata_filters={"doc_type": "policy"},
    )

    listed = store.list_agent_kb_assignments("customer-support-agent")
    assert len(listed) == 1
    _assert_assignment_policy(
        listed[0],
        retrieval_mode="hybrid",
        top_k=8,
        score_threshold=0.72,
        citation_required=True,
        freshness_days=30,
        metadata_filters={"doc_type": "policy"},
    )


def test_agent_kb_assignment_legacy_update_preserves_retrieval_policy(
    store: GovernanceStore,
) -> None:
    store.upsert_knowledge_base(
        {
            "kb_id": "legacy-policy-kb",
            "display_name": "Legacy Policy KB",
            "description": "",
            "source_type": "vector_store",
            "source_config": {},
            "environment": "demo",
        }
    )
    created = store.upsert_agent_kb_assignment(
        agent_id="customer-support-agent",
        kb_id="legacy-policy-kb",
        access_mode="read",
        retrieval_mode="semantic",
        top_k=12,
        score_threshold=0.81,
        citation_required=False,
        freshness_days=45,
        metadata_filters={"team": "support"},
    )

    updated = store.upsert_agent_kb_assignment(
        agent_id="customer-support-agent",
        kb_id="legacy-policy-kb",
        access_mode="read_write",
    )

    assert updated["assignment_id"] == created["assignment_id"]
    assert updated["access_mode"] == "read_write"
    _assert_assignment_policy(
        updated,
        retrieval_mode="semantic",
        top_k=12,
        score_threshold=0.81,
        citation_required=False,
        freshness_days=45,
        metadata_filters={"team": "support"},
    )


def test_agent_kb_assignment_explicit_update_changes_retrieval_policy(
    store: GovernanceStore,
) -> None:
    store.upsert_knowledge_base(
        {
            "kb_id": "explicit-policy-kb",
            "display_name": "Explicit Policy KB",
            "description": "",
            "source_type": "vector_store",
            "source_config": {},
            "environment": "demo",
        }
    )
    store.upsert_agent_kb_assignment(
        agent_id="customer-support-agent",
        kb_id="explicit-policy-kb",
        access_mode="read",
        retrieval_mode="semantic",
        top_k=12,
        score_threshold=0.81,
        citation_required=True,
        freshness_days=45,
        metadata_filters={"team": "support"},
    )

    updated = store.upsert_agent_kb_assignment(
        agent_id="customer-support-agent",
        kb_id="explicit-policy-kb",
        access_mode="read_write",
        retrieval_mode="keyword",
        top_k=3,
        score_threshold=None,
        citation_required=False,
        freshness_days=None,
        metadata_filters={},
    )

    assert updated["access_mode"] == "read_write"
    _assert_assignment_policy(
        updated,
        retrieval_mode="keyword",
        top_k=3,
        score_threshold=None,
        citation_required=False,
        freshness_days=None,
        metadata_filters={},
    )


@pytest.mark.parametrize(
    ("payload", "field_name"),
    [
        ({"kb_id": "policy-kb", "retrieval_mode": "vector"}, "retrieval_mode"),
        ({"kb_id": "policy-kb", "top_k": 0}, "top_k"),
        ({"kb_id": "policy-kb", "score_threshold": 1.1}, "score_threshold"),
        ({"kb_id": "policy-kb", "freshness_days": 0}, "freshness_days"),
    ],
)
def test_agent_kb_assignment_request_validates_policy_fields(
    payload: dict,
    field_name: str,
) -> None:
    with pytest.raises(ValidationError) as exc_info:
        AgentKBAssignmentRequest(**payload)

    assert field_name in str(exc_info.value)
