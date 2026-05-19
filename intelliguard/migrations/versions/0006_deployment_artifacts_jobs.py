from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0006_deployment_artifacts_jobs"
down_revision = "0005_scenario_run_gates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS workflow_generated_artifacts (
                artifact_id VARCHAR(120) PRIMARY KEY,
                deployment_id VARCHAR(120) NOT NULL,
                workflow_definition_id VARCHAR(120) NOT NULL,
                artifact_type VARCHAR(80) NOT NULL,
                artifact_name VARCHAR(240) NOT NULL,
                content TEXT,
                content_hash VARCHAR(64) NOT NULL,
                storage_uri TEXT,
                status VARCHAR(32),
                created_at TIMESTAMP WITH TIME ZONE
            )
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS deployment_jobs (
                job_id VARCHAR(120) PRIMARY KEY,
                deployment_id VARCHAR(120) NOT NULL,
                environment VARCHAR(40) NOT NULL,
                backend VARCHAR(80) NOT NULL,
                status VARCHAR(40),
                requested_by VARCHAR(160),
                image_ref TEXT,
                worker_pool VARCHAR(120),
                logs JSONB,
                metadata JSONB,
                started_at TIMESTAMP WITH TIME ZONE,
                completed_at TIMESTAMP WITH TIME ZONE,
                error TEXT,
                created_at TIMESTAMP WITH TIME ZONE
            )
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_workflow_generated_artifacts_deployment_id
            ON workflow_generated_artifacts (deployment_id)
            """
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_deployment_jobs_deployment_id "
            "ON deployment_jobs (deployment_id)"
        )
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_deployment_jobs_status ON deployment_jobs (status)")
    )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(text("DROP TABLE IF EXISTS deployment_jobs"))
    connection.execute(text("DROP TABLE IF EXISTS workflow_generated_artifacts"))
