from __future__ import annotations

from pathlib import Path

import pytest

from agent_governance.knowledge import KnowledgeRetrievalService
from agent_governance.knowledge_indexing import (
    DeterministicEmbeddingProvider,
    KnowledgeIngestionService,
    LlamaIndexKnowledgeIndexer,
)
from agent_governance.knowledge_storage import KnowledgeFileStorage
from agent_governance.store import GovernanceStore


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


def test_file_storage_rejects_unsupported_files(tmp_path: Path) -> None:
    storage = KnowledgeFileStorage(tmp_path)

    with pytest.raises(ValueError, match="Unsupported file type"):
        storage.save_upload(
            kb_id="claims-kb",
            file_name="image.png",
            content_type="image/png",
            data=b"not a supported document",
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


def test_worker_process_once_invokes_ingestion(monkeypatch: pytest.MonkeyPatch) -> None:
    import agent_governance.knowledge_worker as knowledge_worker

    calls: list[str] = []

    class FakeStore:
        def list_knowledge_bases(self, environment: object = None) -> list[dict[str, str]]:
            return [{"kb_id": "claims-worker-kb"}]

    class FakeService:
        def __init__(self, store: object, indexer: object) -> None:
            pass

        def process_pending_documents(self, kb_id: str) -> dict[str, str]:
            calls.append(kb_id)
            return {"kb_id": kb_id, "status": "ready", "document_count": "1"}

    monkeypatch.setattr(knowledge_worker, "GovernanceStore", lambda _url: FakeStore())
    monkeypatch.setattr(knowledge_worker, "KnowledgeIngestionService", FakeService)
    monkeypatch.setattr(knowledge_worker, "LlamaIndexKnowledgeIndexer", lambda: object())

    processed = knowledge_worker.process_once("postgresql://example")

    assert processed == 1
    assert calls == ["claims-worker-kb"]
