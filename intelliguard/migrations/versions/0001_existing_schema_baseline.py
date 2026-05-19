from __future__ import annotations

from alembic import op
from sqlalchemy import text

from intelliguard.models import Base

revision = "0001_existing_schema_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(connection)


def downgrade() -> None:
    connection = op.get_bind()
    Base.metadata.drop_all(connection)
