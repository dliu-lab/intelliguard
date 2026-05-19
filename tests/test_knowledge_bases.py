from __future__ import annotations

import json
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

import intelliguard.persistence.db as runtime_db
import intelliguard.api.main as api_main
from intelliguard.api import services as api_services
from intelliguard.api.schemas import (
    AgentKBAssignmentRequest,
    KBQueryRequest,
    KnowledgeBaseRequest,
    KnowledgeBaseVersionRequest,
    KnowledgeSourceRequest,
    KnowledgeSyncRequest,
)
from intelliguard.persistence.models import (
    AgentKBAssignment,
    KnowledgeBase,
    KnowledgeBaseVersion,
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeIndexVersion,
    KnowledgeSource,
)
from intelliguard.persistence.store import GovernanceStore


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


def _upload_file(
    file_name: str,
    data: bytes = b"# Claims\n\nPolicy text.",
    content_type: str = "text/markdown",
) -> UploadFile:
    return UploadFile(
        filename=file_name,
        file=BytesIO(data),
        headers=Headers({"content-type": content_type}),
    )


def test_knowledge_models_are_declared() -> None:
    assert KnowledgeBase.__tablename__ == "knowledge_bases"
    assert KnowledgeBaseVersion.__tablename__ == "knowledge_base_versions"
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


def test_knowledge_base_version_columns_are_declared() -> None:
    assert _column(KnowledgeBaseVersion, "version_id").primary_key is True
    assert _column(KnowledgeBaseVersion, "kb_id").nullable is False
    assert [fk.target_fullname for fk in _column(KnowledgeBaseVersion, "kb_id").foreign_keys] == [
        "knowledge_bases.kb_id"
    ]
    assert [
        fk.target_fullname for fk in _column(KnowledgeBaseVersion, "index_version_id").foreign_keys
    ] == ["knowledge_index_versions.index_version_id"]
    assert isinstance(_column(KnowledgeBaseVersion, "version").type, String)
    assert _column(KnowledgeBaseVersion, "version").type.length == 32
    assert _default_arg(KnowledgeBaseVersion, "status") == "draft"
    assert isinstance(_column(KnowledgeBaseVersion, "profile").type, JSONB)
    assert _default_factory_value(KnowledgeBaseVersion, "profile") == {}
    assert isinstance(_column(KnowledgeBaseVersion, "file_manifest").type, JSONB)
    assert _default_factory_value(KnowledgeBaseVersion, "file_manifest") == []
    assert _default_arg(KnowledgeBaseVersion, "retrieval_mode") == "file"
    assert _default_arg(KnowledgeBaseVersion, "kb_scope") == "domain"
    assert _default_arg(KnowledgeBaseVersion, "vector_backend") == "pgvector"
    assert _default_arg(KnowledgeBaseVersion, "chunking_strategy") == "semantic"
    assert _default_arg(KnowledgeBaseVersion, "chunk_size") == 1024
    assert _default_arg(KnowledgeBaseVersion, "chunk_overlap") == 160
    assert _column(KnowledgeBaseVersion, "published_at").nullable is True


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
        lambda passed_engine: calls.append("vector" if passed_engine is engine else "wrong-engine"),
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
    for table in runtime_db.RUNTIME_SCHEMA_TABLES:
        monkeypatch.setattr(table, "create", lambda engine, checkfirst=True: None)
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
        KnowledgeBaseVersion.__table__,
        "create",
        lambda engine, checkfirst=True: engine.connection.statements.append(
            "CREATE TABLE knowledge_base_versions"
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
        "CREATE TABLE knowledge_base_versions",
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
    for table in runtime_db.RUNTIME_SCHEMA_TABLES:
        monkeypatch.setattr(
            table,
            "create",
            lambda engine, checkfirst=True, table_name=table.name: (
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
        "CREATE TABLE knowledge_base_versions",
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


def test_upsert_knowledge_base_can_delay_initial_version(
    store: GovernanceStore,
) -> None:
    kb = store.upsert_knowledge_base(
        {
            "kb_id": "claims-delayed-version-kb",
            "display_name": "Claims Delayed Version KB",
            "description": "",
            "source_type": "file",
            "source_config": {"retrieval_mode": "file"},
            "environment": "demo",
            "create_initial_version": False,
        }
    )

    assert kb["source_config"] == {"retrieval_mode": "file"}
    assert store.list_knowledge_base_versions("claims-delayed-version-kb") == []


def test_create_file_kb_with_files_creates_initial_manifest(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
    tmp_path,
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "DEFAULT_KB_UPLOAD_DIR", str(tmp_path))
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

    body = anyio.run(
        api_main.create_knowledge_base_with_files,
        json.dumps(metadata),
        [_upload_file("claims.md")],
        _super_admin_user(),
    )

    assert body["knowledge_base"]["kb_id"] == "claims-file-kb"
    assert body["knowledge_base"]["source_config"]["retrieval_mode"] == "file"
    assert body["documents"][0]["file_name"] == "claims.md"
    assert body["version"]["version"] == "v0.1.0"
    assert len(body["version"]["file_manifest"]) == 1
    assert body["index"] is None


def test_create_knowledge_base_with_files_rejects_more_than_ten_files(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
    tmp_path,
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "DEFAULT_KB_UPLOAD_DIR", str(tmp_path))
    metadata = {
        "kb_id": "claims-too-many-files-kb",
        "display_name": "Claims Too Many Files KB",
        "environment": "demo",
    }

    with pytest.raises(HTTPException) as exc_info:
        anyio.run(
            api_main.create_knowledge_base_with_files,
            json.dumps(metadata),
            [_upload_file(f"claims-{index}.md") for index in range(11)],
            _super_admin_user(),
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "A KB can include at most 10 files"


def test_knowledge_base_version_lifecycle_snapshots_files_and_publishes(
    store: GovernanceStore,
) -> None:
    _source, document = _create_file_document(store, "claims-versioned-kb")

    initial_versions = store.list_knowledge_base_versions("claims-versioned-kb")

    assert len(initial_versions) == 1
    assert initial_versions[0]["version"] == "v0.1.0"
    assert initial_versions[0]["status"] == "draft"

    draft = store.create_knowledge_base_version(
        "claims-versioned-kb",
        {
            "version": "v0.2.0",
            "status": "draft",
            "notes": "Added claims SOP file.",
            "retrieval_mode": "vector",
            "kb_scope": "agent",
            "scope_ref": "agent_claims_triage",
            "vector_backend": "pgvector",
            "embedding_model": "nomic-embed-text",
            "chunking_strategy": "semantic",
            "chunk_size": 1024,
            "chunk_overlap": 160,
        },
    )

    assert draft["version"] == "v0.2.0"
    assert draft["status"] == "draft"
    assert draft["file_manifest"] == [
        {
            "document_id": document["document_id"],
            "file_name": "claims-sop.txt",
            "checksum": "claims-sop-checksum",
            "status": "uploaded",
            "chunk_count": 0,
        }
    ]
    assert draft["retrieval_mode"] == "vector"
    assert draft["kb_scope"] == "agent"
    assert draft["scope_ref"] == "agent_claims_triage"

    published = store.publish_knowledge_base_version(
        "claims-versioned-kb",
        draft["version_id"],
    )

    assert published["status"] == "published"
    assert published["published_at"]
    versions = store.list_knowledge_base_versions("claims-versioned-kb")
    assert [version["version"] for version in versions] == ["v0.2.0", "v0.1.0"]
    assert versions[0]["status"] == "published"


def test_knowledge_base_version_rejects_invalid_semantic_version(
    store: GovernanceStore,
) -> None:
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-bad-version-kb",
            "display_name": "Claims Bad Version KB",
            "description": "",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )

    with pytest.raises(ValueError, match="Knowledge base version must use v0.0.0 format"):
        store.create_knowledge_base_version(
            "claims-bad-version-kb",
            {
                "version": "1.0",
            },
        )


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
    aggregate = store.refresh_knowledge_base_index_state("claims-doc-kb", index["index_version_id"])

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

    store.mark_knowledge_document_status(failed_document["document_id"], "failed", "Parser failed")
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

    store.mark_knowledge_document_status(failed_document["document_id"], "failed", "Parser failed")
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
        store.replace_knowledge_chunks(document["document_id"], other_index["index_version_id"], [])


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
    store.refresh_knowledge_base_index_state(
        "claims-scoped-refresh-kb", old_index["index_version_id"]
    )

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
    store.mark_knowledge_document_status(failed_document["document_id"], "failed", "Parser failed")

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


def test_evaluate_file_knowledge_base_skips_vector_index(
    store: GovernanceStore,
) -> None:
    _create_file_document(store, "claims-file-evaluation-kb")

    evaluation = store.evaluate_knowledge_base("claims-file-evaluation-kb")
    refreshed = store.get_knowledge_base("claims-file-evaluation-kb")

    assert evaluation["status"] == "passed"
    assert evaluation["checks"]["file_count"]["status"] == "passed"
    assert evaluation["checks"]["supported_files"]["status"] == "passed"
    assert evaluation["checks"]["version"]["status"] == "passed"
    assert evaluation["checks"]["owner"]["status"] == "passed"
    assert evaluation["checks"]["scope"]["status"] == "passed"
    assert evaluation["checks"]["vector_index"]["status"] == "skipped"
    assert refreshed["source_config"]["evaluation"] == evaluation


def test_evaluate_vector_knowledge_base_checks_latest_index(
    store: GovernanceStore,
) -> None:
    _source, document = _create_file_document(store, "claims-vector-evaluation-kb")
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-vector-evaluation-kb",
            "display_name": "Claims Vector Evaluation KB",
            "description": "",
            "source_type": "file",
            "source_config": {"retrieval_mode": "vector"},
            "environment": "demo",
        }
    )

    failed = store.evaluate_knowledge_base("claims-vector-evaluation-kb")
    assert failed["status"] == "failed"
    assert failed["checks"]["vector_index"]["status"] == "failed"

    index = store.create_knowledge_index_version(
        "claims-vector-evaluation-kb",
        {
            "status": "ready",
            "source_count": 1,
            "document_count": 1,
            "chunk_count": 1,
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
                "content": "Claims vector text.",
                "content_hash": "claims-vector-text",
                "embedding": [0.1] * 768,
                "metadata": {"kb_id": "claims-vector-evaluation-kb"},
            }
        ],
    )
    store.mark_knowledge_document_indexed(document["document_id"], 1)
    store.refresh_knowledge_base_index_state(
        "claims-vector-evaluation-kb",
        index["index_version_id"],
    )

    passed = store.evaluate_knowledge_base("claims-vector-evaluation-kb")
    assert passed["status"] == "passed"
    assert passed["checks"]["vector_index"]["status"] == "passed"


def test_delete_knowledge_base_blocks_assignments_and_deletes_rows(
    store: GovernanceStore,
) -> None:
    _source, document = _create_file_document(store, "claims-delete-kb")
    index = store.create_knowledge_index_version(
        "claims-delete-kb",
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
                "content": "Claims delete text.",
                "content_hash": "claims-delete-text",
                "embedding": [0.1] * 768,
                "metadata": {"kb_id": "claims-delete-kb"},
            }
        ],
    )
    store.create_knowledge_base_version(
        "claims-delete-kb",
        {
            "version": "v0.2.0",
            "index_version_id": index["index_version_id"],
        },
    )
    store.upsert_agent_identity(
        {
            "agent_id": "claims-delete-agent",
            "display_name": "Claims Delete Agent",
            "agent_type": "task_agent",
            "owner": "Claims Ops",
            "environment": "demo",
            "purpose": "Test KB delete assignment safety.",
        }
    )
    assignment = store.upsert_agent_kb_assignment(
        agent_id="claims-delete-agent",
        kb_id="claims-delete-kb",
        access_mode="read",
    )

    with pytest.raises(ValueError, match="assigned to agents"):
        store.delete_knowledge_base("claims-delete-kb")

    store.delete_agent_kb_assignment(assignment["assignment_id"])
    assert store.delete_knowledge_base("claims-delete-kb") is True
    assert store.delete_knowledge_base("claims-delete-kb") is False
    assert store.get_knowledge_base("claims-delete-kb") is None
    with store.session() as db:
        assert (
            db.scalar(
                select(KnowledgeDocument).where(KnowledgeDocument.kb_id == "claims-delete-kb")
            )
            is None
        )
        assert (
            db.scalar(select(KnowledgeChunk).where(KnowledgeChunk.kb_id == "claims-delete-kb"))
            is None
        )
        assert (
            db.scalar(
                select(KnowledgeBaseVersion).where(KnowledgeBaseVersion.kb_id == "claims-delete-kb")
            )
            is None
        )


def test_evaluate_and_delete_knowledge_base_endpoints(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    _create_file_document(store, "claims-kb-endpoints")

    evaluation = api_main.evaluate_knowledge_base("claims-kb-endpoints", _super_admin_user())
    deleted = api_main.delete_knowledge_base("claims-kb-endpoints", _super_admin_user())

    assert evaluation["status"] == "passed"
    assert deleted == {"deleted": True}
    assert store.get_knowledge_base("claims-kb-endpoints") is None


def test_delete_knowledge_base_endpoint_returns_409_for_assigned_kb(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    _create_file_document(store, "claims-kb-delete-conflict")
    store.upsert_agent_identity(
        {
            "agent_id": "claims-delete-conflict-agent",
            "display_name": "Claims Delete Conflict Agent",
            "agent_type": "task_agent",
            "owner": "Claims Ops",
            "environment": "demo",
            "purpose": "Test KB delete conflict.",
        }
    )
    store.upsert_agent_kb_assignment(
        agent_id="claims-delete-conflict-agent",
        kb_id="claims-kb-delete-conflict",
        access_mode="read",
    )

    with pytest.raises(HTTPException) as exc_info:
        api_main.delete_knowledge_base("claims-kb-delete-conflict", _super_admin_user())

    assert exc_info.value.status_code == 409
    assert "assigned to agents" in exc_info.value.detail


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


def test_knowledge_base_version_endpoints_create_list_and_publish(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    _create_file_document(store, "claims-version-api-kb")

    created = api_main.create_knowledge_base_version(
        "claims-version-api-kb",
        KnowledgeBaseVersionRequest(
            version="v0.2.0",
            notes="Added claims SOP file.",
            retrieval_mode="vector",
            kb_scope="domain",
            scope_ref="claims",
            vector_backend="pgvector",
            embedding_model="nomic-embed-text",
            chunking_strategy="semantic",
            chunk_size=1024,
            chunk_overlap=160,
        ),
        _super_admin_user(),
    )

    assert created["version"] == "v0.2.0"
    assert created["status"] == "draft"
    assert created["file_manifest"][0]["file_name"] == "claims-sop.txt"

    published = api_main.publish_knowledge_base_version(
        "claims-version-api-kb",
        created["version_id"],
        _super_admin_user(),
    )

    assert published["status"] == "published"
    versions = api_main.list_knowledge_base_versions(
        "claims-version-api-kb",
        _super_admin_user(),
    )
    assert [version["version"] for version in versions][:2] == ["v0.2.0", "v0.1.0"]


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


def test_sync_knowledge_base_uses_selected_chunking_strategy_for_indexer(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
) -> None:
    captured_kwargs: dict[str, object] = {}

    class FakeIngestionService:
        def __init__(self, passed_store: GovernanceStore, _indexer: object) -> None:
            assert passed_store is store

        def process_pending_documents(
            self, kb_id: str, *, force_reindex: bool = False
        ) -> dict[str, object]:
            return {"kb_id": kb_id, "force_reindex": force_reindex}

    class FakeIndexer:
        def __init__(self, **kwargs: object) -> None:
            captured_kwargs.update(kwargs)

    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "KnowledgeIngestionService", FakeIngestionService)
    monkeypatch.setattr(api_services, "LlamaIndexKnowledgeIndexer", FakeIndexer)
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-sync-strategy-kb",
            "display_name": "Claims Sync Strategy KB",
            "description": "",
            "source_type": "file",
            "source_config": {
                "retrieval_mode": "vector",
                "chunking_strategy": "semantic",
                "embedding_model": "nomic-embed-text",
                "chunk_size": 512,
                "chunk_overlap": 80,
            },
            "environment": "demo",
        }
    )

    result = api_main.create_knowledge_sync_status(
        "claims-sync-strategy-kb",
        KnowledgeSyncRequest(force_reindex=True),
        _super_admin_user(),
    )

    assert result == {"kb_id": "claims-sync-strategy-kb", "force_reindex": True}
    assert captured_kwargs["chunking_strategy"] == "semantic"


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


def test_upload_knowledge_file_allows_image_for_file_kb(
    monkeypatch: pytest.MonkeyPatch, store: GovernanceStore, tmp_path
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "DEFAULT_KB_UPLOAD_DIR", str(tmp_path))
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-upload-image-kb",
            "display_name": "Claims Upload Image KB",
            "description": "",
            "source_type": "file",
            "source_config": {"retrieval_mode": "file"},
            "environment": "demo",
        }
    )
    upload = UploadFile(
        filename="claim-photo.jpg",
        file=BytesIO(b"fake jpeg bytes"),
        headers=Headers({"content-type": "image/jpeg"}),
    )

    document = anyio.run(
        api_main.upload_knowledge_file,
        "claims-upload-image-kb",
        upload,
        _super_admin_user(),
    )

    assert document["file_name"] == "claim-photo.jpg"
    assert document["content_type"] == "image/jpeg"


def test_upload_knowledge_file_rejects_image_for_vector_kb(
    monkeypatch: pytest.MonkeyPatch, store: GovernanceStore, tmp_path
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "DEFAULT_KB_UPLOAD_DIR", str(tmp_path))
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-upload-vector-image-kb",
            "display_name": "Claims Upload Vector Image KB",
            "description": "",
            "source_type": "file",
            "source_config": {"retrieval_mode": "vector"},
            "environment": "demo",
        }
    )
    upload = UploadFile(
        filename="claim-photo.jpg",
        file=BytesIO(b"fake jpeg bytes"),
        headers=Headers({"content-type": "image/jpeg"}),
    )

    with pytest.raises(HTTPException) as exc_info:
        anyio.run(
            api_main.upload_knowledge_file,
            "claims-upload-vector-image-kb",
            upload,
            _super_admin_user(),
        )

    assert exc_info.value.status_code == 400
    assert "Image files can only be attached to File KBs" in exc_info.value.detail


def test_upload_knowledge_file_rejects_more_than_ten_files(
    monkeypatch: pytest.MonkeyPatch, store: GovernanceStore, tmp_path
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "DEFAULT_KB_UPLOAD_DIR", str(tmp_path))
    for index in range(10):
        _create_file_document(store, "claims-upload-limit-kb", label=f"Claims SOP {index}")
    upload = UploadFile(
        filename="extra.md",
        file=BytesIO(b"# Extra claims guidance"),
        headers=Headers({"content-type": "text/markdown"}),
    )

    with pytest.raises(HTTPException) as exc_info:
        anyio.run(
            api_main.upload_knowledge_file,
            "claims-upload-limit-kb",
            upload,
            _super_admin_user(),
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "This KB already has 10 files"


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
    captured: dict[str, object] = {}

    class FakeEmbeddingProvider:
        def __init__(self, model_name: str) -> None:
            self.model_name = model_name

    class FakeRetrieval:
        def __init__(self, _store, embedding_provider: object | None = None):
            captured["embedding_model"] = getattr(embedding_provider, "model_name", None)

        def query(
            self,
            kb_id: str,
            query: str,
            environment: str,
            top_k: int = 5,
            score_threshold: float | None = None,
        ) -> list[api_main.RetrievedDoc]:
            captured["score_threshold"] = score_threshold
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
            "source_config": {"embedding_model": "qwen3-embedding:8b"},
            "environment": "demo",
        }
    )

    monkeypatch.setattr(api_main, "OllamaEmbeddingProvider", FakeEmbeddingProvider)
    results = api_main.query_knowledge_base(
        "claims-query-kb",
        KBQueryRequest(query="review", top_k=3, score_threshold=0.42),
        _super_admin_user(),
    )

    assert results == [
        {
            "content": "claims-query-kb:review:demo:3",
            "score": 0.9,
            "metadata": {"kb_id": "claims-query-kb", "chunk_id": "chunk_1"},
        }
    ]
    assert captured == {"embedding_model": "qwen3-embedding:8b", "score_threshold": 0.42}


def test_query_knowledge_base_does_not_apply_default_score_threshold(
    monkeypatch: pytest.MonkeyPatch, store: GovernanceStore
) -> None:
    captured: dict[str, object] = {}

    class FakeEmbeddingProvider:
        def __init__(self, model_name: str) -> None:
            self.model_name = model_name

    class FakeRetrieval:
        def __init__(self, _store, embedding_provider: object | None = None):
            captured["embedding_model"] = getattr(embedding_provider, "model_name", None)

        def query(
            self,
            kb_id: str,
            query: str,
            environment: str,
            top_k: int = 5,
            score_threshold: float | None = None,
        ) -> list[api_main.RetrievedDoc]:
            captured["query"] = query
            captured["top_k"] = top_k
            captured["score_threshold"] = score_threshold
            return [
                api_main.RetrievedDoc(
                    content="Semantic candidate with a modest similarity score.",
                    score=0.24,
                    metadata={"kb_id": kb_id, "environment": environment},
                )
            ]

    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "KnowledgeRetrievalService", FakeRetrieval)
    monkeypatch.setattr(api_main, "OllamaEmbeddingProvider", FakeEmbeddingProvider)
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-threshold-query-kb",
            "display_name": "Claims Threshold Query KB",
            "description": "",
            "source_type": "file",
            "source_config": {"embedding_model": "nomic-embed-text"},
            "environment": "demo",
        }
    )

    results = api_main.query_knowledge_base(
        "claims-threshold-query-kb",
        KBQueryRequest(query="what this is", top_k=3),
        _super_admin_user(),
    )

    assert results[0]["score"] == 0.24
    assert captured == {
        "embedding_model": "nomic-embed-text",
        "query": "what this is",
        "top_k": 3,
        "score_threshold": None,
    }


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
