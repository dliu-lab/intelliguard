from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0007_multi_role_auth_sessions"
down_revision = "0006_deployment_artifacts_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        text("ALTER TABLE users ADD COLUMN IF NOT EXISTS roles JSONB NOT NULL DEFAULT '[]'::jsonb")
    )
    connection.execute(
        text(
            "UPDATE users SET roles = jsonb_build_array(role) "
            "WHERE roles = '[]'::jsonb AND role IS NOT NULL"
        )
    )
    connection.execute(
        text("ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS active_role VARCHAR(80)")
    )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(text("ALTER TABLE user_sessions DROP COLUMN IF EXISTS active_role"))
    connection.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS roles"))
