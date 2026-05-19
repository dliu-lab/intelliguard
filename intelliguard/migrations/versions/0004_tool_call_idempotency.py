from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0004_tool_call_idempotency"
down_revision = "0003_deployment_runtime_persistence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        text("ALTER TABLE tool_calls ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160)")
    )
    connection.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_tool_calls_idempotency
            ON tool_calls (agent_id, tool_name, idempotency_key)
            WHERE idempotency_key IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(text("DROP INDEX IF EXISTS uq_tool_calls_idempotency"))
    connection.execute(text("ALTER TABLE tool_calls DROP COLUMN IF EXISTS idempotency_key"))
