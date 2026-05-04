from __future__ import annotations

import os
from dataclasses import dataclass


DEFAULT_DATABASE_URL = "postgresql+psycopg://governance:governance@localhost:5432/governance"
DEFAULT_POLICY_PATH = "policies/policy.yaml"
DEFAULT_OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
DEFAULT_OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
DEFAULT_KB_UPLOAD_DIR = os.getenv("KB_UPLOAD_DIR", "data/kb_uploads")
DEFAULT_KB_EMBED_DIMENSION = int(os.getenv("KB_EMBED_DIMENSION", "768"))
DEFAULT_KB_CHUNK_SIZE = int(os.getenv("KB_CHUNK_SIZE", "1024"))
DEFAULT_KB_CHUNK_OVERLAP = int(os.getenv("KB_CHUNK_OVERLAP", "160"))
DEFAULT_KB_INGESTION_BATCH_SIZE = int(os.getenv("KB_INGESTION_BATCH_SIZE", "32"))


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
