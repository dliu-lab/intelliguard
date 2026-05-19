from __future__ import annotations

import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError

from agent_governance import db as runtime_db
from agent_governance.models import Base


TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://governance:governance@localhost:55432/governance_test",
)


def _migration_database_url() -> str:
    url = make_url(TEST_DATABASE_URL)
    database = url.database or "governance_test"
    return str(url.set(database=f"{database}_migrations"))


def _recreate_database(database_url: str) -> None:
    url = make_url(database_url)
    database = url.database
    if not database:
        raise RuntimeError("Migration tests require a database name.")

    admin_engine = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as connection:
            connection.execute(
                text(
                    "SELECT pg_terminate_backend(pid) "
                    "FROM pg_stat_activity "
                    "WHERE datname = :database AND pid <> pg_backend_pid()"
                ),
                {"database": database},
            )
            connection.execute(text(f'DROP DATABASE IF EXISTS "{database}"'))
            connection.execute(text(f'CREATE DATABASE "{database}"'))
    finally:
        admin_engine.dispose()


def _alembic_config(database_url: str) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def test_alembic_upgrade_head_creates_current_metadata_tables() -> None:
    database_url = _migration_database_url()
    try:
        _recreate_database(database_url)
    except OperationalError as exc:
        pytest.skip(f"Postgres test database is unavailable: {exc}")

    command.upgrade(_alembic_config(database_url), "head")

    engine = create_engine(database_url)
    try:
        table_names = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()

    assert "alembic_version" in table_names
    assert set(Base.metadata.tables).issubset(table_names)


def test_init_db_is_idempotent_after_alembic_upgrade() -> None:
    database_url = _migration_database_url()
    try:
        _recreate_database(database_url)
    except OperationalError as exc:
        pytest.skip(f"Postgres test database is unavailable: {exc}")

    command.upgrade(_alembic_config(database_url), "head")
    runtime_db.init_db(database_url)
    runtime_db.init_db(database_url)

    engine = create_engine(database_url)
    try:
        table_names = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()

    assert set(Base.metadata.tables).issubset(table_names)


def test_init_db_requires_alembic_version_when_migrations_required(monkeypatch) -> None:
    class FakeInspector:
        def get_table_names(self) -> list[str]:
            return []

    class FakeEngine:
        pass

    create_all_called = False

    def fail_create_all(_engine) -> None:
        nonlocal create_all_called
        create_all_called = True
        raise AssertionError("create_all should not run when migrations are required")

    engine = FakeEngine()
    monkeypatch.setenv("DB_MIGRATIONS_REQUIRED", "true")
    monkeypatch.setattr(runtime_db, "build_engine", lambda _database_url: engine)
    monkeypatch.setattr(runtime_db, "ensure_vector_extension", lambda _engine: None)
    monkeypatch.setattr(runtime_db, "inspect", lambda _engine: FakeInspector())
    monkeypatch.setattr(runtime_db.Base.metadata, "create_all", fail_create_all)

    with pytest.raises(RuntimeError, match="Alembic migrations are required"):
        runtime_db.init_db("postgresql+psycopg://test/test")

    assert create_all_called is False


def test_runtime_schema_keeps_compatibility_fallbacks(monkeypatch) -> None:
    class FakeInspector:
        def get_table_names(self) -> list[str]:
            return ["users"]

        def get_columns(self, table_name: str) -> list[dict[str, str]]:
            assert table_name == "users"
            return [{"name": "user_id"}]

    class FakeConnection:
        def __init__(self) -> None:
            self.statements: list[str] = []

        def execute(self, statement) -> None:
            self.statements.append(str(statement))

    class FakeBegin:
        def __init__(self, connection: FakeConnection) -> None:
            self.connection = connection

        def __enter__(self) -> FakeConnection:
            return self.connection

        def __exit__(self, *args: object) -> None:
            return None

    class FakeEngine:
        def __init__(self) -> None:
            self.connection = FakeConnection()

        def begin(self) -> FakeBegin:
            return FakeBegin(self.connection)

    engine = FakeEngine()
    monkeypatch.setattr(runtime_db, "inspect", lambda _engine: FakeInspector())
    for table in runtime_db.RUNTIME_SCHEMA_TABLES:
        monkeypatch.setattr(table, "create", lambda engine, checkfirst=True: None)

    runtime_db.ensure_runtime_schema(engine)

    assert any(
        "ALTER TABLE users ADD COLUMN password_hash TEXT" in statement
        for statement in engine.connection.statements
    )
