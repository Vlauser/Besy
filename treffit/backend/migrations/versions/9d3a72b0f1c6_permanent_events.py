"""permanent events

Revision ID: 9d3a72b0f1c6
Revises: 8c2f01a5d7b4
Create Date: 2026-08-13 20:05:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = '9d3a72b0f1c6'
down_revision: str | None = '8c2f01a5d7b4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Постоянная экспозиция: идёт всегда, конкретной даты у неё нет.
    op.add_column(
        'events',
        sa.Column('is_permanent', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column('events', 'is_permanent')
