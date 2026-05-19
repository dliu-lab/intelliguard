from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0002_workflow_sdlc_foundation"
down_revision = "0001_existing_schema_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        text(
            "ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS workflow_root_id VARCHAR(120)"
        )
    )
    connection.execute(
        text(
            "UPDATE workflow_definitions "
            "SET workflow_root_id = workflow_definition_id "
            "WHERE workflow_root_id IS NULL"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE workflow_definitions "
            "ADD COLUMN IF NOT EXISTS version VARCHAR(40) NOT NULL DEFAULT 'v1'"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE workflow_definitions "
            "ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE workflow_definitions "
            "ADD COLUMN IF NOT EXISTS previous_workflow_definition_id VARCHAR(120)"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE workflow_definitions "
            "ADD COLUMN IF NOT EXISTS source_workflow_definition_id VARCHAR(120)"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE workflow_definitions "
            "ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'DRAFT'"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE workflow_definitions "
            "ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP WITH TIME ZONE"
        )
    )
    connection.execute(
        text("ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS locked_by VARCHAR(160)")
    )
    connection.execute(
        text(
            "ALTER TABLE workflow_definitions "
            "ADD COLUMN IF NOT EXISTS created_from_deployment_id VARCHAR(120)"
        )
    )
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS workflow_definition_versions (
                version_id VARCHAR(64) PRIMARY KEY,
                workflow_root_id VARCHAR(120) NOT NULL,
                workflow_definition_id VARCHAR(120) NOT NULL,
                previous_workflow_definition_id VARCHAR(120),
                source_workflow_definition_id VARCHAR(120),
                version VARCHAR(40) NOT NULL,
                version_number INTEGER NOT NULL,
                lifecycle_status VARCHAR(32),
                change_summary TEXT,
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
            CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_definition_versions_root_number
            ON workflow_definition_versions (workflow_root_id, version_number)
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_definition_versions_definition
            ON workflow_definition_versions (workflow_definition_id)
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT INTO workflow_definition_versions (
                version_id,
                workflow_root_id,
                workflow_definition_id,
                previous_workflow_definition_id,
                source_workflow_definition_id,
                version,
                version_number,
                lifecycle_status,
                change_summary,
                created_by,
                created_at,
                updated_at
            )
            SELECT
                'wfver_' || substring(md5(workflow_definition_id) for 16),
                COALESCE(workflow_root_id, workflow_definition_id),
                workflow_definition_id,
                previous_workflow_definition_id,
                source_workflow_definition_id,
                COALESCE(version, 'v1'),
                COALESCE(version_number, 1),
                COALESCE(lifecycle_status, 'DRAFT'),
                '',
                'system',
                COALESCE(created_at, now()),
                COALESCE(updated_at, now())
            FROM workflow_definitions
            WHERE NOT EXISTS (
                SELECT 1
                FROM workflow_definition_versions
                WHERE workflow_definition_versions.workflow_definition_id =
                    workflow_definitions.workflow_definition_id
            )
            """
        )
    )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(text("DROP TABLE IF EXISTS workflow_definition_versions"))
    for column_name in (
        "created_from_deployment_id",
        "locked_by",
        "locked_at",
        "lifecycle_status",
        "source_workflow_definition_id",
        "previous_workflow_definition_id",
        "version_number",
        "version",
        "workflow_root_id",
    ):
        connection.execute(
            text(f"ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS {column_name}")
        )
