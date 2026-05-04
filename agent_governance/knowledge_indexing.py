from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Protocol

from llama_index.core import SimpleDirectoryReader
from llama_index.core.node_parser import SentenceSplitter
from llama_index.embeddings.ollama import OllamaEmbedding

from agent_governance.settings import (
    DEFAULT_KB_CHUNK_OVERLAP,
    DEFAULT_KB_CHUNK_SIZE,
    DEFAULT_OLLAMA_BASE_URL,
    DEFAULT_OLLAMA_EMBED_MODEL,
)
from agent_governance.store import GovernanceStore


class EmbeddingProvider(Protocol):
    model_name: str

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError

    def embed_query(self, text: str) -> list[float]:
        raise NotImplementedError


class OllamaEmbeddingProvider:
    def __init__(
        self,
        model_name: str = DEFAULT_OLLAMA_EMBED_MODEL,
        base_url: str = DEFAULT_OLLAMA_BASE_URL,
    ) -> None:
        self.model_name = model_name
        self._embedding = OllamaEmbedding(model_name=model_name, base_url=base_url)

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return self._embedding.get_text_embedding_batch(texts)

    def embed_query(self, text: str) -> list[float]:
        return self._embedding.get_query_embedding(text)


class DeterministicEmbeddingProvider:
    def __init__(self, dimension: int = 768) -> None:
        self.model_name = "test/deterministic"
        self.dimension = dimension

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [self._embed(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._embed(text)

    def _embed(self, text: str) -> list[float]:
        digest = sha256(text.encode("utf-8")).digest()
        return [digest[index % len(digest)] / 255.0 for index in range(self.dimension)]


@dataclass(frozen=True)
class IndexedChunk:
    chunk_index: int
    content: str
    content_hash: str
    embedding: list[float]
    metadata: dict


class LlamaIndexKnowledgeIndexer:
    def __init__(
        self,
        *,
        embedding_provider: EmbeddingProvider | None = None,
        chunk_size: int = DEFAULT_KB_CHUNK_SIZE,
        chunk_overlap: int = DEFAULT_KB_CHUNK_OVERLAP,
    ) -> None:
        self.embedding_provider = embedding_provider or OllamaEmbeddingProvider()
        self.splitter = SentenceSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    def index_file(self, document: dict, kb: dict, source: dict) -> list[dict]:
        path = self._path_from_storage_uri(str(document["storage_uri"]))
        documents = SimpleDirectoryReader(input_files=[path]).load_data()
        if not documents:
            raise ValueError("Parser produced no text")

        for parsed in documents:
            parsed.metadata.update(
                {
                    "kb_id": document["kb_id"],
                    "source_id": document["source_id"],
                    "document_id": document["document_id"],
                    "file_name": document["file_name"],
                    "source_display_name": source.get("display_name") or document["file_name"],
                    "environment": kb.get("environment"),
                    "sensitivity": kb.get("sensitivity"),
                    "embedding_model": self.embedding_provider.model_name,
                }
            )

        nodes = self.splitter.get_nodes_from_documents(documents)
        indexed_nodes = [
            (node, node.get_content().strip())
            for node in nodes
            if node.get_content().strip()
        ]
        if not indexed_nodes:
            raise ValueError("Parser produced no text")

        texts = [text for _node, text in indexed_nodes]
        embeddings = self.embedding_provider.embed_texts(texts)
        chunks: list[dict] = []
        for index, ((node, text), embedding) in enumerate(
            zip(indexed_nodes, embeddings, strict=True)
        ):
            chunks.append(
                {
                    "chunk_index": index,
                    "content": text,
                    "content_hash": sha256(text.encode("utf-8")).hexdigest(),
                    "embedding": embedding,
                    "metadata": dict(node.metadata),
                }
            )
        return chunks

    @staticmethod
    def _path_from_storage_uri(storage_uri: str) -> str:
        if not storage_uri.startswith("file://"):
            raise ValueError("Only local file storage URIs are supported")
        return str(Path(storage_uri.removeprefix("file://")))


class KnowledgeIngestionService:
    def __init__(self, store: GovernanceStore, indexer: LlamaIndexKnowledgeIndexer) -> None:
        self.store = store
        self.indexer = indexer

    def process_pending_documents(self, kb_id: str) -> dict:
        kb = self.store.get_knowledge_base(kb_id)
        if not kb:
            raise ValueError(f"Knowledge base {kb_id!r} not found")

        documents = [
            document
            for document in self.store.list_knowledge_documents(kb_id)
            if document["status"] in {"uploaded", "queued", "failed"}
        ]
        sources = self.store.list_knowledge_sources(kb_id)
        if not documents:
            return self.store.create_knowledge_index_version(
                kb_id,
                {
                    "status": "pending",
                    "source_count": len(sources),
                    "document_count": 0,
                    "chunk_count": 0,
                    "embedding_model": self.indexer.embedding_provider.model_name,
                    "vector_backend": "pgvector",
                },
            )

        index = self.store.create_knowledge_index_version(
            kb_id,
            {
                "status": "indexing",
                "source_count": len(sources),
                "document_count": len(documents),
                "chunk_count": 0,
                "embedding_model": self.indexer.embedding_provider.model_name,
                "vector_backend": "pgvector",
            },
        )
        sources_by_id = {source["source_id"]: source for source in sources}
        for document in documents:
            try:
                self.store.mark_knowledge_document_status(document["document_id"], "parsing")
                source = sources_by_id[document["source_id"]]
                chunks = self.indexer.index_file(document, kb, source)
                self.store.mark_knowledge_document_status(document["document_id"], "embedding")
                self.store.replace_knowledge_chunks(
                    document["document_id"],
                    index["index_version_id"],
                    chunks,
                )
                self.store.mark_knowledge_document_indexed(document["document_id"], len(chunks))
            except Exception as exc:
                self.store.mark_knowledge_document_status(
                    document["document_id"],
                    "failed",
                    str(exc),
                )

        return self.store.refresh_knowledge_base_index_state(kb_id, index["index_version_id"])
