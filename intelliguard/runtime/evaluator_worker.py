from __future__ import annotations

import os
import time

from intelliguard.settings import load_settings
from intelliguard.db import init_db
from intelliguard.store import GovernanceStore


def main() -> None:
    settings = load_settings()
    if settings.auto_init_db:
        init_db(settings.database_url)
    store = GovernanceStore(settings.database_url)
    poll_seconds = float(os.getenv("EVALUATOR_WORKER_POLL_SECONDS", "5"))
    while True:
        # Scenario and certification APIs currently run synchronously. This worker is
        # reserved for async evaluator queues so the deployment topology is stable.
        _ = store
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
