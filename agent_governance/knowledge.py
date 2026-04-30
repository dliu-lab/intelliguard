from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class RetrievedDoc:
    content: str
    score: float
    metadata: dict[str, Any]


class KBRetrieval:
    """Retrieval from a named Knowledge Base, scoped by kb_id in document metadata.

    Documents must be indexed with metadata.kb_id set. Wraps AdvisorRAG.retrieve()
    (pgvector + LiteLLM) and filters results to the requested KB.
    """

    def __init__(self, rag: Any) -> None:
        self.rag = rag

    def query(
        self, kb_id: str, query: str, environment: str, top_k: int = 5
    ) -> list[RetrievedDoc]:
        candidates = self.rag.retrieve(query, environment, top_k=top_k * 3)
        results = [
            doc for doc in candidates if doc.metadata.get("kb_id") == kb_id
        ]
        return results[:top_k]
