from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from intelliguard.knowledge_indexing import EmbeddingProvider, OllamaEmbeddingProvider
from intelliguard.models import KnowledgeChunk
from intelliguard.store import GovernanceStore


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
        detail = self.store.get_knowledge_base_detail(kb_id) or {}
        latest_index = detail.get("latest_index")
        latest_index_id = (
            latest_index.get("index_version_id") if isinstance(latest_index, dict) else None
        )
        with self.store.session() as db:
            distance = KnowledgeChunk.embedding.cosine_distance(query_embedding)
            stmt = (
                select(KnowledgeChunk, distance.label("distance"))
                .where(KnowledgeChunk.kb_id == kb_id)
                .order_by(distance)
                .limit(max(top_k, 1) * 3)
            )
            if latest_index_id:
                stmt = stmt.where(KnowledgeChunk.index_version_id == latest_index_id)
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
