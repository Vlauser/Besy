"""event poster and source link

Revision ID: 8c2f01a5d7b4
Revises: 43a4e694eec8
Create Date: 2026-08-13 19:10:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = '8c2f01a5d7b4'
down_revision: str | None = '43a4e694eec8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Ссылки, а не файлы: афиши остаются на стороне источника.
    op.add_column('events', sa.Column('image_url', sa.String(length=500), nullable=True))
    op.add_column('events', sa.Column('site_url', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('events', 'site_url')
    op.drop_column('events', 'image_url')
