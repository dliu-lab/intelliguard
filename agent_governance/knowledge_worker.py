from __future__ import annotations

import os
import time

from agent_governance.db import init_db
from agent_governance.knowledge_indexing import (
    KnowledgeIngestionService,
    LlamaIndexKnowledgeIndexer,
)
from agent_governance.settings import DEFAULT_DATABASE_URL
from agent_governance.store import GovernanceStore


def _config_int(value: object, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _indexer_for_kb(kb: dict) -> LlamaIndexKnowledgeIndexer:
    source_config = kb.get("source_config") if isinstance(kb.get("source_config"), dict) else {}
    return LlamaIndexKnowledgeIndexer(
        embedding_model=str(source_config.get("embedding_model") or "nomic-embed-text"),
        chunking_strategy=str(source_config.get("chunking_strategy") or "semantic"),
        chunk_size=_config_int(source_config.get("chunk_size"), 512),
        chunk_overlap=_config_int(source_config.get("chunk_overlap"), 80),
    )


def process_once(database_url: str = DEFAULT_DATABASE_URL) -> int:
    store = GovernanceStore(database_url)
    processed = 0
    for kb in store.list_knowledge_bases():
        source_config = kb.get("source_config") if isinstance(kb.get("source_config"), dict) else {}
        if source_config.get("retrieval_mode") == "file":
            continue
        service = KnowledgeIngestionService(store, _indexer_for_kb(kb))
        result = service.process_pending_documents(kb["kb_id"])
        if result.get("document_count") or result.get("chunk_count"):
            processed += 1
    return processed


def main() -> None:
    database_url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
    init_db(database_url)
    interval_seconds = int(os.getenv("KB_WORKER_INTERVAL_SECONDS", "15"))
    while True:
        process_once(database_url)
        time.sleep(interval_seconds)


if __name__ == "__main__":
    main()
