from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0005_scenario_run_gates"
down_revision = "0004_tool_call_idempotency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    for statement in (
        "ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS target_id VARCHAR(120)",
        "ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS overall_result VARCHAR(32)",
        "ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS case_total INTEGER DEFAULT 0",
        "ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS case_passed INTEGER DEFAULT 0",
        "ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS evidence JSONB DEFAULT '{}'::jsonb",
        """
        CREATE INDEX IF NOT EXISTS ix_scenario_runs_deployment_result
        ON scenario_runs (deployment_id, status, overall_result)
        """,
    ):
        connection.execute(text(statement))


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(text("DROP INDEX IF EXISTS ix_scenario_runs_deployment_result"))
    for column in ("evidence", "case_passed", "case_total", "overall_result", "target_id"):
        connection.execute(text(f"ALTER TABLE scenario_runs DROP COLUMN IF EXISTS {column}"))
