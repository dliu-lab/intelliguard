from __future__ import annotations

import os
from dataclasses import dataclass


DEFAULT_DATABASE_URL = "postgresql+psycopg://governance:governance@localhost:5432/governance"
DEFAULT_POLICY_PATH = "policies/policy.yaml"


@dataclass(frozen=True)
class Settings:
    database_url: str = DEFAULT_DATABASE_URL
    policy_path: str = DEFAULT_POLICY_PATH
    auto_init_db: bool = True
    seed_demo_data: bool = False


def load_settings() -> Settings:
    return Settings(
        database_url=os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL),
        policy_path=os.getenv("POLICY_PATH", DEFAULT_POLICY_PATH),
        auto_init_db=os.getenv("AUTO_INIT_DB", "true").lower() == "true",
        seed_demo_data=os.getenv("SEED_DEMO_DATA", "false").lower() == "true",
    )
