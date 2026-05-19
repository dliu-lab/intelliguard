from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0003_deployment_runtime_persistence"
down_revision = "0002_workflow_sdlc_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS workflow_deployment_revisions (
                deployment_id VARCHAR(120) PRIMARY KEY,
                workflow_definition_id VARCHAR(120) NOT NULL,
                environment VARCHAR(40) NOT NULL,
                version VARCHAR(40) NOT NULL,
                status VARCHAR(32),
                manifest JSONB,
                manifest_hash VARCHAR(64) NOT NULL,
                graph_version_hash VARCHAR(64),
                agent_config_hashes JSONB,
                tool_config_hashes JSONB,
                evaluator_config_hashes JSONB,
                policy_hashes JSONB,
                kb_version_hashes JSONB,
                runtime_type VARCHAR(40),
                runtime_limits JSONB,
                created_by VARCHAR(160),
                created_at TIMESTAMP WITH TIME ZONE,
                activated_at TIMESTAMP WITH TIME ZONE,
                retired_at TIMESTAMP WITH TIME ZONE
            )
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_workflow_deployment_revisions_active
            ON workflow_deployment_revisions (workflow_definition_id, environment, status)
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS workflow_runtime_runs (
                run_id VARCHAR(64) PRIMARY KEY,
                deployment_id VARCHAR(120) NOT NULL,
                workflow_definition_id VARCHAR(120) NOT NULL,
                workflow_id VARCHAR(64),
                environment VARCHAR(40) NOT NULL,
                status VARCHAR(32),
                decision VARCHAR(32),
                idempotency_key VARCHAR(160),
                input_payload JSONB,
                output_payload JSONB,
                runtime_type VARCHAR(40),
                started_at TIMESTAMP WITH TIME ZONE,
                completed_at TIMESTAMP WITH TIME ZONE,
                error TEXT,
                created_at TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE
            )
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_runtime_runs_idempotency
            ON workflow_runtime_runs (deployment_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS runtime_event_outbox (
                outbox_id VARCHAR(64) PRIMARY KEY,
                run_id VARCHAR(64) NOT NULL,
                workflow_id VARCHAR(64),
                session_id VARCHAR(64),
                event_type VARCHAR(120) NOT NULL,
                payload JSONB,
                status VARCHAR(32),
                created_at TIMESTAMP WITH TIME ZONE,
                published_at TIMESTAMP WITH TIME ZONE,
                publish_attempts INTEGER
            )
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS service_connectors (
                connector_id VARCHAR(120) PRIMARY KEY,
                name VARCHAR(180) NOT NULL,
                connector_type VARCHAR(80) NOT NULL,
                environment VARCHAR(40) NOT NULL,
                config JSONB,
                status VARCHAR(32),
                owner VARCHAR(160),
                created_at TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE
            )
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS scenario_suites (
                suite_id VARCHAR(120) PRIMARY KEY,
                name VARCHAR(180) NOT NULL,
                description TEXT,
                workflow_definition_id VARCHAR(120) NOT NULL,
                environment VARCHAR(40) NOT NULL,
                scenarios JSONB,
                created_by VARCHAR(160),
                created_at TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE
            )
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS scenario_runs (
                scenario_run_id VARCHAR(120) PRIMARY KEY,
                suite_id VARCHAR(120) NOT NULL,
                deployment_id VARCHAR(120) NOT NULL,
                environment VARCHAR(40) NOT NULL,
                status VARCHAR(32),
                results JSONB,
                started_at TIMESTAMP WITH TIME ZONE,
                completed_at TIMESTAMP WITH TIME ZONE,
                error TEXT,
                created_at TIMESTAMP WITH TIME ZONE
            )
            """
        )
    )


def downgrade() -> None:
    connection = op.get_bind()
    for table_name in (
        "scenario_runs",
        "scenario_suites",
        "service_connectors",
        "runtime_event_outbox",
        "workflow_runtime_runs",
        "workflow_deployment_revisions",
    ):
        connection.execute(text(f"DROP TABLE IF EXISTS {table_name}"))
