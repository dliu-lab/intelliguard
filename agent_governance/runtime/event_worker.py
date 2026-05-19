from __future__ import annotations

import os
import time

from agent_governance.settings import load_settings
from agent_governance.db import init_db
from agent_governance.store import GovernanceStore


def main() -> None:
    settings = load_settings()
    if settings.auto_init_db:
        init_db(settings.database_url)
    store = GovernanceStore(settings.database_url)
    poll_seconds = float(os.getenv("EVENT_WORKER_POLL_SECONDS", "5"))
    while True:
        # The first production-safe implementation keeps the outbox durable in Postgres.
        # External publishers can be added behind this worker without changing producers.
        _ = store
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
