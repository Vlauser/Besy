"""Database models.

Naming note vs `docs/schema_api.md`: the doc used `matches` for the
per-user recommendation cards. A Twinby-style product needs both a
recommendation feed and a *mutual* match, so the two are split here:

    deck_cards  — precomputed candidates shown to one user (scratch pack)
    matches     — a mutual like between two users; owns exactly one chat
"""

from datetime import date, datetime, timezone
from enum import StrEnum

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

# JSONB on Postgres, plain JSON everywhere else (tests run on SQLite).
JsonCol = JSON().with_variant(JSONB(), "postgresql")

# SQLite only auto-increments a column declared exactly INTEGER PRIMARY KEY,
# so BIGINT keys must degrade to INTEGER there. Postgres still gets bigint.
PkType = BigInteger().with_variant(Integer(), "sqlite")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Gender(StrEnum):
    male = "male"
    female = "female"
    other = "other"


class SeekingGender(StrEnum):
    male = "male"
    female = "female"
    any = "any"


class SwipeAction(StrEnum):
    like = "like"
    pass_ = "pass"
    superlike = "superlike"


class ModerationStatus(StrEnum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class MessageType(StrEnum):
    text = "text"
    system = "system"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True, nullable=False)
    username: Mapped[str | None] = mapped_column(String(64))
    first_name: Mapped[str] = mapped_column(String(64), nullable=False)
    last_name: Mapped[str | None] = mapped_column(String(64))
    language_code: Mapped[str | None] = mapped_column(String(8))

    birth_date: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(16))
    seeking_gender: Mapped[str] = mapped_column(String(16), default=SeekingGender.any.value, nullable=False)
    seeking_age_min: Mapped[int] = mapped_column(Integer, default=18, nullable=False)
    seeking_age_max: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    city: Mapped[str] = mapped_column(String(64), default="Екатеринбург", nullable=False)
    bio: Mapped[str | None] = mapped_column(Text)
    interests: Mapped[list] = mapped_column(JsonCol, default=list, nullable=False)

    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)

    # {"1": "left", "2": "right", ...} — six either/or test cards
    test_answers: Mapped[dict] = mapped_column(JsonCol, default=dict, nullable=False)
    test_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    consent_pdn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consent_photo_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    is_premium: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    onboarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # reviewed_by_id is a second FK to users, so the join has to be named.
    photos: Mapped[list["Photo"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="Photo.position",
        foreign_keys="Photo.user_id",
    )

    __table_args__ = (
        CheckConstraint("seeking_age_min >= 18", name="ck_users_age_min_18"),
        Index("ix_users_discover", "is_active", "is_banned", "gender", "city"),
    )

    @property
    def age(self) -> int | None:
        if not self.birth_date:
            return None
        today = date.today()
        return today.year - self.birth_date.year - (
            (today.month, today.day) < (self.birth_date.month, self.birth_date.day)
        )

    @property
    def is_onboarded(self) -> bool:
        return bool(
            self.birth_date and self.gender and self.consent_pdn_at and self.test_completed_at and self.onboarded_at
        )


class Photo(Base):
    """A profile photo. The file is never served by a static handler — access
    always goes through the media router so reveal rules can be enforced."""

    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    position: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    file_path: Mapped[str] = mapped_column(String(255), nullable=False)
    thumb_path: Mapped[str | None] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(32), default="image/jpeg", nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    # Average-hash based placeholder gradient, safe to show before reveal.
    blur_gradient: Mapped[str] = mapped_column(String(128), default="linear-gradient(135deg,#B9C6FF,#6E85E8)")
    moderation_status: Mapped[str] = mapped_column(
        String(16), default=ModerationStatus.pending.value, nullable=False
    )
    moderation_reason: Mapped[str | None] = mapped_column(String(255))
    moderation_scores: Mapped[dict] = mapped_column(JsonCol, default=dict, nullable=False)
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped[User] = relationship(back_populates="photos", foreign_keys=[user_id])

    __table_args__ = (UniqueConstraint("user_id", "position", name="uq_photos_user_position"),)


class Verification(Base):
    """Selfie-with-gesture check.

    The selfie is never shown to other users — it exists only so a moderator
    can confirm the profile photos are of the same, real person.
    """

    __tablename__ = "verifications"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    gesture: Mapped[str] = mapped_column(String(32), nullable=False)
    file_path: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="requested", nullable=False)
    reason: Mapped[str | None] = mapped_column(String(255))
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (Index("ix_verifications_status", "status", "created_at"),)


class VerificationStatus(StrEnum):
    requested = "requested"
    submitted = "submitted"
    approved = "approved"
    rejected = "rejected"


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    external_id: Mapped[str | None] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    venue: Mapped[str | None] = mapped_column(String(255))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    city: Mapped[str] = mapped_column(String(64), default="Екатеринбург", nullable=False)
    source: Mapped[str] = mapped_column(String(32), default="kudago", nullable=False)
    # Афиша и страница события у источника. Храним ссылки, а не файлы:
    # картинки лежат на стороне КудаGo, качать их к себе — это и место, и
    # чужие права на изображения.
    image_url: Mapped[str | None] = mapped_column(String(500))
    site_url: Mapped[str | None] = mapped_column(String(500))

    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_events_source_external"),)


class UserEvent(Base):
    __tablename__ = "user_events"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "event_id", name="uq_user_events"),)


class Swipe(Base):
    __tablename__ = "swipes"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    target_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("actor_id", "target_id", name="uq_swipes_pair"),
        Index("ix_swipes_target_action", "target_id", "action"),
    )


class DeckCard(Base):
    """One scratch card in a user's pack — a precomputed recommendation."""

    __tablename__ = "deck_cards"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    compatibility_pct: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    shared_flags: Mapped[list] = mapped_column(JsonCol, default=list, nullable=False)
    event_id: Mapped[int | None] = mapped_column(ForeignKey("events.id", ondelete="SET NULL"))
    is_live: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    scratched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "candidate_id", name="uq_deck_cards_pair"),)


class Match(Base):
    """A mutual like. `user_a_id < user_b_id` always, so the pair is unique."""

    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    user_a_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    user_b_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    compatibility_pct: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    shared_flags: Mapped[list] = mapped_column(JsonCol, default=list, nullable=False)
    event_id: Mapped[int | None] = mapped_column(ForeignKey("events.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(String(16), default="swipe", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    chat: Mapped["Chat"] = relationship(back_populates="match", uselist=False)

    __table_args__ = (
        UniqueConstraint("user_a_id", "user_b_id", name="uq_matches_pair"),
        CheckConstraint("user_a_id < user_b_id", name="ck_matches_ordered"),
    )


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    match_id: Mapped[int] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    user_a_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    user_b_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)

    # Counted separately: each side earns their own reveal.
    msg_count_a: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    msg_count_b: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    revealed_a: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    revealed_b: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    unread_a: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    unread_b: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_push_a: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_push_b: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    match: Mapped[Match] = relationship(back_populates="chat")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="chat", cascade="all, delete-orphan", order_by="Message.id"
    )

    def other_id(self, user_id: int) -> int:
        return self.user_b_id if user_id == self.user_a_id else self.user_a_id

    def is_member(self, user_id: int) -> bool:
        return user_id in (self.user_a_id, self.user_b_id)

    def sent_count(self, user_id: int) -> int:
        return self.msg_count_a if user_id == self.user_a_id else self.msg_count_b

    def has_revealed(self, user_id: int) -> bool:
        """True when `user_id` has earned the right to see the other's photo."""
        return self.revealed_a if user_id == self.user_a_id else self.revealed_b


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), index=True, nullable=False)
    sender_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    type: Mapped[str] = mapped_column(String(16), default=MessageType.text.value, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    chat: Mapped[Chat] = relationship(back_populates="messages")

    __table_args__ = (Index("ix_messages_chat_id_desc", "chat_id", "id"),)


class LiveSession(Base):
    __tablename__ = "live_sessions"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True, nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    checked_in_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Block(Base):
    __tablename__ = "blocks"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    blocked_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "blocked_id", name="uq_blocks_pair"),)


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    target_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    reason: Mapped[str] = mapped_column(String(64), nullable=False)
    details: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Purchase(Base):
    __tablename__ = "purchases"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    product: Mapped[str] = mapped_column(String(32), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="XTR", nullable=False)
    payload: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    telegram_charge_id: Mapped[str | None] = mapped_column(String(128), unique=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
