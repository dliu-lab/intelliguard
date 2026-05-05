from __future__ import annotations

import importlib.util
import json
from io import BytesIO
from pathlib import Path

import anyio
import pytest
from fastapi import HTTPException
from llama_index.core.node_parser import (
    CodeSplitter,
    HierarchicalNodeParser,
    HTMLNodeParser,
    JSONNodeParser,
    MarkdownNodeParser,
    SemanticSplitterNodeParser,
    SentenceSplitter,
    TokenTextSplitter,
)
from starlette.datastructures import Headers, UploadFile

import api.main as api_main

from agent_governance.knowledge import KnowledgeRetrievalService
from agent_governance.knowledge_indexing import (
    DeterministicEmbeddingProvider,
    KnowledgeIngestionService,
    LlamaIndexKnowledgeIndexer,
)
from agent_governance.knowledge_storage import KnowledgeFileStorage
from agent_governance.models import KnowledgeIndexVersion
from agent_governance.store import GovernanceStore

CODE_SPLITTER_AVAILABLE = bool(
    importlib.util.find_spec("tree_sitter")
    and importlib.util.find_spec("tree_sitter_language_pack")
)


def _super_admin_user() -> dict:
    return {
        "role": "Admin",
        "is_super_admin": True,
        "allowed_environments": [],
        "permissions_by_environment": {},
    }


def _upload_file(file_name: str) -> UploadFile:
    return UploadFile(
        filename=file_name,
        file=BytesIO(b"# Claims\n\nPolicy text."),
        headers=Headers({"content-type": "text/markdown"}),
    )


def test_file_storage_writes_safe_upload(tmp_path: Path) -> None:
    storage = KnowledgeFileStorage(tmp_path)
    data = b"Claims must be reviewed within two business days."

    stored = storage.save_upload(
        kb_id="claims-kb",
        file_name="../Claims SOP.txt",
        content_type="text/plain",
        data=data,
    )

    assert stored.file_name == "Claims SOP.txt"
    assert stored.content_type == "text/plain"
    assert stored.size_bytes == len(data)
    assert stored.checksum
    assert Path(stored.storage_uri.removeprefix("file://")).read_bytes() == data
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


def test_file_storage_accepts_image_files(tmp_path: Path) -> None:
    storage = KnowledgeFileStorage(tmp_path)

    stored = storage.save_upload(
        kb_id="claims-kb",
        file_name="claim-photo.png",
        content_type="image/png",
        data=b"fake png bytes",
    )

    assert stored.file_name == "claim-photo.png"
    assert stored.content_type == "image/png"
    assert Path(stored.storage_uri.removeprefix("file://")).read_bytes() == b"fake png bytes"


@pytest.mark.parametrize(
    ("file_name", "content_type"),
    [
        ("claims.json", "application/json"),
        ("claims.html", "text/html"),
        ("claims.py", "text/x-python"),
        ("claims.ts", "text/typescript"),
    ],
)
def test_file_storage_accepts_parser_specific_vector_files(
    tmp_path: Path,
    file_name: str,
    content_type: str,
) -> None:
    storage = KnowledgeFileStorage(tmp_path)

    stored = storage.save_upload(
        kb_id="claims-kb",
        file_name=file_name,
        content_type=content_type,
        data=b"parser-specific content",
    )

    assert stored.file_name == file_name
    assert stored.content_type == content_type


def test_file_storage_rejects_unsupported_files(tmp_path: Path) -> None:
    storage = KnowledgeFileStorage(tmp_path)

    with pytest.raises(ValueError, match="Unsupported file type"):
        storage.save_upload(
            kb_id="claims-kb",
            file_name="archive.zip",
            content_type="application/zip",
            data=b"not a supported knowledge file",
        )


def test_ingestion_service_indexes_text_file(store: GovernanceStore, tmp_path: Path) -> None:
    source_path = tmp_path / "claims.txt"
    source_path.write_text(
        "Claims must be reviewed within two business days.",
        encoding="utf-8",
    )
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
    assert indexed is not None
    assert indexed["status"] == "indexed"
    assert indexed["chunk_count"] >= 1


@pytest.mark.parametrize(
    ("chunking_strategy", "expected_parser_type"),
    [
        ("sentence", SentenceSplitter),
        ("token", TokenTextSplitter),
        ("markdown", MarkdownNodeParser),
        ("json", JSONNodeParser),
        ("html", HTMLNodeParser),
        pytest.param(
            "code",
            CodeSplitter,
            marks=pytest.mark.skipif(
                not CODE_SPLITTER_AVAILABLE,
                reason="CodeSplitter requires tree-sitter-language-pack",
            ),
        ),
        ("semantic", SemanticSplitterNodeParser),
        ("hierarchical", HierarchicalNodeParser),
    ],
)
def test_indexer_selects_node_parser_for_chunking_strategy(
    chunking_strategy: str,
    expected_parser_type: type,
) -> None:
    indexer = LlamaIndexKnowledgeIndexer(
        embedding_provider=DeterministicEmbeddingProvider(dimension=32),
        chunking_strategy=chunking_strategy,
        chunk_size=128,
        chunk_overlap=20,
    )

    assert isinstance(indexer.node_parser, expected_parser_type)
    assert indexer.chunking_strategy == chunking_strategy


def test_indexer_reports_missing_code_splitter_dependency() -> None:
    if CODE_SPLITTER_AVAILABLE:
        pytest.skip("CodeSplitter dependency is installed")

    with pytest.raises(RuntimeError, match="CodeSplitter requires"):
        LlamaIndexKnowledgeIndexer(
            embedding_provider=DeterministicEmbeddingProvider(dimension=32),
            chunking_strategy="code",
            chunk_size=128,
            chunk_overlap=20,
        )


@pytest.mark.parametrize(
    ("legacy_strategy", "canonical_strategy", "expected_parser_type"),
    [
        ("semantic_sections", "semantic", SemanticSplitterNodeParser),
        ("fixed_size", "token", TokenTextSplitter),
        ("qa_pairs", "sentence", SentenceSplitter),
        ("procedure_steps", "markdown", MarkdownNodeParser),
    ],
)
def test_indexer_keeps_legacy_chunking_strategy_aliases(
    legacy_strategy: str,
    canonical_strategy: str,
    expected_parser_type: type,
) -> None:
    indexer = LlamaIndexKnowledgeIndexer(
        embedding_provider=DeterministicEmbeddingProvider(dimension=32),
        chunking_strategy=legacy_strategy,
        chunk_size=128,
        chunk_overlap=20,
    )

    assert isinstance(indexer.node_parser, expected_parser_type)
    assert indexer.chunking_strategy == canonical_strategy


def test_ingestion_service_does_not_create_empty_pending_index_after_ready_index(
    store: GovernanceStore, tmp_path: Path
) -> None:
    source_path = tmp_path / "claims.md"
    source_path.write_text(
        "# Claims\n\nClaims must be reviewed within two business days.", encoding="utf-8"
    )
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-stable-index-kb",
            "display_name": "Claims Stable Index KB",
            "description": "",
            "source_type": "file",
            "source_config": {"retrieval_mode": "vector", "embedding_model": "nomic-embed-text"},
            "environment": "demo",
        }
    )
    source = store.upsert_knowledge_source(
        "claims-stable-index-kb",
        {
            "source_type": "file",
            "display_name": "Claims Markdown",
            "uri": f"file://{source_path}",
            "content_type": "text/markdown",
            "source_config": {},
        },
    )
    store.create_knowledge_document(
        "claims-stable-index-kb",
        source["source_id"],
        {
            "file_name": "claims.md",
            "content_type": "text/markdown",
            "storage_uri": f"file://{source_path}",
            "size_bytes": source_path.stat().st_size,
            "checksum": "test-checksum",
        },
    )
    service = KnowledgeIngestionService(
        store,
        LlamaIndexKnowledgeIndexer(
            embedding_provider=DeterministicEmbeddingProvider(dimension=768),
            chunk_size=128,
            chunk_overlap=20,
        ),
    )

    service.process_pending_documents("claims-stable-index-kb")
    ready_index = (store.get_knowledge_base_detail("claims-stable-index-kb") or {})["latest_index"]
    repeated_index = service.process_pending_documents("claims-stable-index-kb")

    assert repeated_index["index_version_id"] == ready_index["index_version_id"]
    assert repeated_index["status"] == "ready"
    with store.session() as db:
        indexes = db.query(KnowledgeIndexVersion).filter(
            KnowledgeIndexVersion.kb_id == "claims-stable-index-kb"
        )
        assert indexes.count() == 1

    service.process_pending_documents("claims-stable-index-kb", force_reindex=True)
    forced_index = (store.get_knowledge_base_detail("claims-stable-index-kb") or {})["latest_index"]

    assert forced_index["index_version_id"] != ready_index["index_version_id"]
    assert forced_index["status"] == "ready"
    assert forced_index["chunk_count"] >= 1
    with store.session() as db:
        indexes = db.query(KnowledgeIndexVersion).filter(
            KnowledgeIndexVersion.kb_id == "claims-stable-index-kb"
        )
        assert indexes.count() == 2


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
        indexed = store.get_knowledge_document(document["document_id"])
        assert indexed is not None
        assert indexed["status"] == "indexed"

    retrieval = KnowledgeRetrievalService(
        store,
        embedding_provider=DeterministicEmbeddingProvider(dimension=768),
    )

    results = retrieval.query("claims-kb-a", "claims review", "demo", top_k=5)

    assert results
    assert {result.metadata["kb_id"] for result in results} == {"claims-kb-a"}
    assert all("claims-kb-b" not in result.metadata.get("file_name", "") for result in results)


def test_retrieval_service_uses_latest_ready_index_only(store: GovernanceStore) -> None:
    class StaticQueryEmbeddingProvider:
        model_name = "test/static-query"

        def embed_texts(self, texts: list[str]) -> list[list[float]]:
            return [[1.0] + [0.0] * 767 for _text in texts]

        def embed_query(self, text: str) -> list[float]:
            return [1.0] + [0.0] * 767

    store.upsert_knowledge_base(
        {
            "kb_id": "claims-latest-index-kb",
            "display_name": "Claims Latest Index KB",
            "description": "",
            "source_type": "file",
            "source_config": {"retrieval_mode": "vector"},
            "environment": "demo",
        }
    )
    source = store.upsert_knowledge_source(
        "claims-latest-index-kb",
        {
            "source_type": "file",
            "display_name": "Claims",
            "uri": "file://claims.md",
            "content_type": "text/markdown",
            "source_config": {},
        },
    )
    document = store.create_knowledge_document(
        "claims-latest-index-kb",
        source["source_id"],
        {
            "file_name": "claims.md",
            "content_type": "text/markdown",
            "storage_uri": "file://claims.md",
            "size_bytes": 12,
            "checksum": "claims",
        },
    )
    old_index = store.create_knowledge_index_version(
        "claims-latest-index-kb",
        {
            "status": "indexing",
            "embedding_model": "test/static-query",
            "vector_backend": "pgvector",
        },
    )
    store.replace_knowledge_chunks(
        document["document_id"],
        old_index["index_version_id"],
        [
            {
                "chunk_index": 0,
                "content": "old stale chunk",
                "content_hash": "old",
                "embedding": [1.0] + [0.0] * 767,
                "metadata": {"environment": "demo"},
            }
        ],
    )
    store.mark_knowledge_document_indexed(document["document_id"], 1)
    store.refresh_knowledge_base_index_state(
        "claims-latest-index-kb", old_index["index_version_id"]
    )
    new_index = store.create_knowledge_index_version(
        "claims-latest-index-kb",
        {
            "status": "indexing",
            "embedding_model": "test/static-query",
            "vector_backend": "pgvector",
        },
    )
    store.replace_knowledge_chunks(
        document["document_id"],
        new_index["index_version_id"],
        [
            {
                "chunk_index": 0,
                "content": "new current chunk",
                "content_hash": "new",
                "embedding": [0.0, 1.0] + [0.0] * 766,
                "metadata": {"environment": "demo"},
            }
        ],
    )
    store.mark_knowledge_document_indexed(document["document_id"], 1)
    store.refresh_knowledge_base_index_state(
        "claims-latest-index-kb", new_index["index_version_id"]
    )

    results = KnowledgeRetrievalService(
        store,
        embedding_provider=StaticQueryEmbeddingProvider(),
    ).query("claims-latest-index-kb", "claims", "demo", top_k=1)

    assert [result.content for result in results] == ["new current chunk"]


def test_worker_process_once_invokes_ingestion(monkeypatch: pytest.MonkeyPatch) -> None:
    import agent_governance.knowledge_worker as knowledge_worker

    calls: list[str] = []
    captured_kwargs: dict[str, object] = {}

    class FakeStore:
        def list_knowledge_bases(self, environment: object = None) -> list[dict[str, str]]:
            return [
                {
                    "kb_id": "claims-worker-kb",
                    "source_config": {
                        "retrieval_mode": "vector",
                        "chunking_strategy": "html",
                        "embedding_model": "nomic-embed-text",
                        "chunk_size": 1024,
                        "chunk_overlap": 0,
                    },
                }
            ]

    class FakeService:
        def __init__(self, store: object, indexer: object) -> None:
            pass

        def process_pending_documents(self, kb_id: str) -> dict[str, str]:
            calls.append(kb_id)
            return {"kb_id": kb_id, "status": "ready", "document_count": "1"}

    monkeypatch.setattr(knowledge_worker, "GovernanceStore", lambda _url: FakeStore())
    monkeypatch.setattr(knowledge_worker, "KnowledgeIngestionService", FakeService)
    monkeypatch.setattr(
        knowledge_worker,
        "LlamaIndexKnowledgeIndexer",
        lambda **kwargs: captured_kwargs.update(kwargs) or object(),
    )

    processed = knowledge_worker.process_once("postgresql://example")

    assert processed == 1
    assert calls == ["claims-worker-kb"]
    assert captured_kwargs["chunking_strategy"] == "html"


def test_create_kb_with_files_requires_at_least_one_file(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "DEFAULT_KB_UPLOAD_DIR", str(tmp_path))
    metadata = {
        "kb_id": "claims-empty-file-kb",
        "display_name": "Claims Empty File KB",
        "environment": "demo",
        "retrieval_mode": "file",
    }

    with pytest.raises(HTTPException) as exc_info:
        anyio.run(
            api_main.create_knowledge_base_with_files,
            json.dumps(metadata),
            [],
            _super_admin_user(),
        )

    assert exc_info.value.status_code == 400
    assert "at least one file" in exc_info.value.detail


def test_create_kb_with_files_rejects_existing_kb_id(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "DEFAULT_KB_UPLOAD_DIR", str(tmp_path))
    store.upsert_knowledge_base(
        {
            "kb_id": "claims-existing-file-kb",
            "display_name": "Claims Existing File KB",
            "description": "",
            "source_type": "file",
            "source_config": {},
            "environment": "demo",
        }
    )
    metadata = {
        "kb_id": "claims-existing-file-kb",
        "display_name": "Claims Existing File KB",
        "environment": "demo",
        "retrieval_mode": "file",
    }

    with pytest.raises(HTTPException) as exc_info:
        anyio.run(
            api_main.create_knowledge_base_with_files,
            json.dumps(metadata),
            [_upload_file("claims.md")],
            _super_admin_user(),
        )

    assert exc_info.value.status_code == 409
    assert "already exists" in exc_info.value.detail


def test_create_file_kb_with_index_after_create_does_not_invoke_ingestion(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
    tmp_path: Path,
) -> None:
    class UnexpectedIngestionService:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            raise AssertionError("File KB creation must not construct ingestion service")

    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "DEFAULT_KB_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(api_main, "KnowledgeIngestionService", UnexpectedIngestionService)
    metadata = {
        "kb_id": "claims-file-no-ingest-kb",
        "display_name": "Claims File No Ingest KB",
        "environment": "demo",
        "retrieval_mode": "file",
        "index_after_create": True,
    }

    response = anyio.run(
        api_main.create_knowledge_base_with_files,
        json.dumps(metadata),
        [_upload_file("claims.md")],
        _super_admin_user(),
    )

    assert response["index"] is None


def test_create_file_kb_accepts_image_attachment(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "DEFAULT_KB_UPLOAD_DIR", str(tmp_path))
    metadata = {
        "kb_id": "claims-file-image-kb",
        "display_name": "Claims File Image KB",
        "environment": "demo",
        "retrieval_mode": "file",
    }
    upload = UploadFile(
        filename="claim-photo.png",
        file=BytesIO(b"fake png bytes"),
        headers=Headers({"content-type": "image/png"}),
    )

    response = anyio.run(
        api_main.create_knowledge_base_with_files,
        json.dumps(metadata),
        [upload],
        _super_admin_user(),
    )

    assert response["documents"][0]["file_name"] == "claim-photo.png"
    assert response["documents"][0]["content_type"] == "image/png"
    assert response["version"]["file_manifest"][0]["file_name"] == "claim-photo.png"
    assert response["index"] is None


def test_create_vector_kb_rejects_image_attachment(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "DEFAULT_KB_UPLOAD_DIR", str(tmp_path))
    metadata = {
        "kb_id": "claims-vector-image-kb",
        "display_name": "Claims Vector Image KB",
        "environment": "demo",
        "retrieval_mode": "vector",
    }
    upload = UploadFile(
        filename="claim-photo.png",
        file=BytesIO(b"fake png bytes"),
        headers=Headers({"content-type": "image/png"}),
    )

    with pytest.raises(HTTPException) as exc_info:
        anyio.run(
            api_main.create_knowledge_base_with_files,
            json.dumps(metadata),
            [upload],
            _super_admin_user(),
        )

    assert exc_info.value.status_code == 400
    assert "Image files can only be attached to File KBs" in exc_info.value.detail


def test_create_vector_kb_with_index_after_create_invokes_ingestion(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
    tmp_path: Path,
) -> None:
    calls: list[str] = []

    class FakeIngestionService:
        def __init__(self, passed_store: GovernanceStore, _indexer: object) -> None:
            assert passed_store is store

        def process_pending_documents(self, kb_id: str) -> dict[str, str]:
            calls.append(kb_id)
            return {"kb_id": kb_id, "status": "ready"}

    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "DEFAULT_KB_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(api_main, "KnowledgeIngestionService", FakeIngestionService)
    monkeypatch.setattr(api_main, "LlamaIndexKnowledgeIndexer", lambda **_kwargs: object())
    metadata = {
        "kb_id": "claims-vector-ingest-kb",
        "display_name": "Claims Vector Ingest KB",
        "environment": "demo",
        "retrieval_mode": "vector",
        "index_after_create": True,
    }

    response = anyio.run(
        api_main.create_knowledge_base_with_files,
        json.dumps(metadata),
        [_upload_file("claims.md")],
        _super_admin_user(),
    )

    assert calls == ["claims-vector-ingest-kb"]
    assert response["index"] == {"kb_id": "claims-vector-ingest-kb", "status": "ready"}


def test_create_vector_kb_uses_selected_chunking_settings_for_indexer(
    monkeypatch: pytest.MonkeyPatch,
    store: GovernanceStore,
    tmp_path: Path,
) -> None:
    captured_kwargs: dict[str, object] = {}

    class FakeIngestionService:
        def __init__(self, passed_store: GovernanceStore, _indexer: object) -> None:
            assert passed_store is store

        def process_pending_documents(self, kb_id: str) -> dict[str, str]:
            return {"kb_id": kb_id, "status": "ready"}

    class FakeIndexer:
        def __init__(self, **kwargs: object) -> None:
            captured_kwargs.update(kwargs)

    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "DEFAULT_KB_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(api_main, "KnowledgeIngestionService", FakeIngestionService)
    monkeypatch.setattr(api_main, "LlamaIndexKnowledgeIndexer", FakeIndexer)
    metadata = {
        "kb_id": "claims-vector-custom-chunk-kb",
        "display_name": "Claims Vector Custom Chunk KB",
        "environment": "demo",
        "retrieval_mode": "vector",
        "chunking_strategy": "token",
        "chunk_size": 512,
        "chunk_overlap": 64,
        "index_after_create": True,
    }

    anyio.run(
        api_main.create_knowledge_base_with_files,
        json.dumps(metadata),
        [_upload_file("claims.md")],
        _super_admin_user(),
    )

    assert captured_kwargs["chunk_size"] == 512
    assert captured_kwargs["chunk_overlap"] == 64
    assert captured_kwargs["chunking_strategy"] == "token"
