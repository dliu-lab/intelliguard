from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.sql import text

from intelliguard.persistence.db import ensure_vector_extension, seed_demo_data
from intelliguard.persistence.models import Base
from intelliguard.persistence.store import GovernanceStore

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://governance:governance@localhost:55432/governance_test",
)


def _ensure_database(database_url: str) -> None:
    url = make_url(database_url)
    database = url.database
    if not database:
        return
    admin_url = url.set(database="postgres")
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as connection:
            exists = connection.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :database"), {"database": database}
            )
            if not exists:
                connection.execute(text(f'CREATE DATABASE "{database}"'))
    except OperationalError:
        raise
    finally:
        admin_engine.dispose()


@pytest.fixture(scope="session")
def db_url() -> str:
    _ensure_database(TEST_DATABASE_URL)
    engine = create_engine(TEST_DATABASE_URL)
    ensure_vector_extension(engine)
    Base.metadata.create_all(engine)
    engine.dispose()
    yield TEST_DATABASE_URL
    engine2 = create_engine(TEST_DATABASE_URL)
    Base.metadata.drop_all(engine2)
    engine2.dispose()


@pytest.fixture
def store(db_url: str) -> GovernanceStore:
    s = GovernanceStore(db_url)
    with s.session() as db:
        seed_demo_data(db)
    return s
