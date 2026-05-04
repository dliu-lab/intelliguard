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


def process_once(database_url: str = DEFAULT_DATABASE_URL) -> int:
    store = GovernanceStore(database_url)
    service = KnowledgeIngestionService(store, LlamaIndexKnowledgeIndexer())
    processed = 0
    for kb in store.list_knowledge_bases():
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
