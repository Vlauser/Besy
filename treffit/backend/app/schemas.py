from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import cities
from .config import settings
from .models import Gender, SeekingGender, SwipeAction


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------- auth ---------------------------


class TelegramAuthIn(BaseModel):
    init_data: str = Field(default="", description="window.Telegram.WebApp.initData")
    # Dev-only shortcut, rejected unless TREFFIT_ALLOW_DEV_AUTH=true.
    dev_telegram_id: int | None = None
    dev_first_name: str | None = None


class AuthOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    is_new: bool
    needs_onboarding: bool
    user: "MeOut"


# --------------------------- profile ---------------------------


class PhotoOut(ORMModel):
    id: int
    position: int
    gradient: str
    url: str | None = None
    locked: bool = False
    moderation_status: str
    moderation_reason: str | None = None


class MeOut(ORMModel):
    id: int
    telegram_id: int
    username: str | None
    first_name: str
    last_name: str | None
    birth_date: date | None
    age: int | None
    gender: str | None
    seeking_gender: str
    seeking_age_min: int
    seeking_age_max: int
    city: str
    bio: str | None
    interests: list[str]
    test_answers: dict[str, str]
    test_completed_at: datetime | None
    consent_pdn_at: datetime | None
    consent_photo_at: datetime | None
    is_premium: bool
    is_verified: bool
    is_onboarded: bool
    photos: list[PhotoOut] = []


class MeUpdate(BaseModel):
    first_name: str | None = Field(default=None, max_length=64)
    birth_date: date | None = None
    gender: Gender | None = None
    seeking_gender: SeekingGender | None = None
    seeking_age_min: int | None = Field(default=None, ge=18, le=99)
    seeking_age_max: int | None = Field(default=None, ge=18, le=99)
    city: str | None = Field(default=None, max_length=64)
    bio: str | None = Field(default=None, max_length=500)
    interests: list[str] | None = None

    @field_validator("interests")
    @classmethod
    def _limit_interests(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [i.strip()[:32] for i in value if i and i.strip()]
        return cleaned[:10]

    @field_validator("city")
    @classmethod
    def _known_city(cls, value: str | None) -> str | None:
        """Привести город к единому виду.

        И подбор, и афиша ищут точным совпадением названия, поэтому «мск»,
        «Москва » и «москва» обязаны стать одной «Москвой» — иначе и то и
        другое окажется пустым, без единой ошибки.

        Города не из справочника принимаются: он заведомо неполный, а отказ
        означал бы, что человеку из небольшого города приложением
        пользоваться нельзя вовсе.

        Валидатор срабатывает только когда поле прислано, поэтому None здесь
        значит не «не меняем», а «стереть» — а колонка NOT NULL, и запрос
        упал бы уже в базе, пятисотой ошибкой.
        """
        known = cities.normalize(value)
        if known is None:
            raise ValueError("Укажите город: буквы, пробелы и дефисы")
        return known

    @field_validator("birth_date")
    @classmethod
    def _adult_only(cls, value: date | None) -> date | None:
        if value is None:
            return None
        today = date.today()
        age = today.year - value.year - ((today.month, today.day) < (value.month, value.day))
        if age < settings.min_age:
            raise ValueError(f"Регистрация только с {settings.min_age} лет")
        if age > 100:
            raise ValueError("Проверьте дату рождения")
        return value


class ConsentIn(BaseModel):
    pdn: bool = False
    photo: bool = False


class TestAnswersIn(BaseModel):
    answers: dict[str, str]

    @field_validator("answers")
    @classmethod
    def _validate(cls, value: dict[str, str]) -> dict[str, str]:
        if not value:
            raise ValueError("Нужны ответы теста")
        return value


class TestCardOut(BaseModel):
    id: int
    q: str
    left: str
    right: str


# --------------------------- discovery ---------------------------


class CandidateOut(BaseModel):
    """A profile as shown in the swipe deck.

    In blind mode `photos[].url` is None and only the gradient is sent, so
    there is nothing in the payload to un-blur.
    """

    id: int
    first_name: str
    age: int | None
    city: str
    bio: str | None
    interests: list[str]
    compatibility_pct: int
    shared_flags: list[str]
    event: EventOut | None = None
    is_verified: bool
    is_online: bool = False
    photos: list[PhotoOut] = []
    photos_locked: bool = False


class DeckCardOut(BaseModel):
    id: int
    scratched: bool
    compatibility_pct: int | None = None
    candidate: CandidateOut | None = None
    event: EventOut | None = None
    is_live: bool = False


class SwipeIn(BaseModel):
    action: SwipeAction


class SwipeOut(BaseModel):
    matched: bool
    match_id: int | None = None
    chat_id: int | None = None
    likes_left: int | None = None
    candidate: CandidateOut | None = None


# --------------------------- matches & chats ---------------------------


class MatchOut(BaseModel):
    id: int
    chat_id: int | None
    compatibility_pct: int
    shared_flags: list[str]
    event: EventOut | None = None
    created_at: datetime
    other: CandidateOut


class MessageOut(ORMModel):
    id: int
    chat_id: int
    sender_id: int | None
    type: str
    body: str
    sent_at: datetime
    read_at: datetime | None
    mine: bool = False


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class ChatOut(BaseModel):
    id: int
    match_id: int
    other: CandidateOut
    revealed: bool
    remaining_to_reveal: int
    sent_count: int
    # Написал ли хоть кто-то из двоих. Чат заводится вместе с матчем и сразу
    # получает системное сообщение, поэтому «пусто» по последнему сообщению
    # не определить — а отличать свежий матч от начатого разговора нужно.
    has_conversation: bool = False
    unread: int
    last_message: MessageOut | None = None
    last_message_at: datetime | None = None
    started_at: datetime


class SendMessageOut(BaseModel):
    message: MessageOut
    reveal_unlocked: bool
    remaining_to_reveal: int
    system_message: MessageOut | None = None


class PhotoRevealOut(BaseModel):
    """What the client gets once a reveal is earned."""

    url: str
    gradient: str


# --------------------------- events & live ---------------------------


class EventOut(ORMModel):
    id: int
    title: str
    venue: str | None
    starts_at: datetime
    ends_at: datetime | None
    city: str
    lat: float | None = None
    lng: float | None = None
    image_url: str | None = None
    site_url: str | None = None
    # У постоянной экспозиции даты нет; starts_at у неё — день открытия,
    # и показывать его человеку незачем.
    is_permanent: bool = False
    attending: bool = False


class CheckinIn(BaseModel):
    event_id: int
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class LiveNeighbourOut(BaseModel):
    user_id: int
    first_name: str
    gradient: str
    distance_m: int


# --------------------------- события от людей ---------------------------


class MeetupAuthorOut(BaseModel):
    """Автор события в карточке. Ровно столько, сколько нужно решить,
    откликаться ли, — не вся анкета."""

    id: int
    first_name: str
    age: int | None = None
    is_verified: bool = False
    photo_url: str | None = None
    gradient: str = "linear-gradient(135deg,#B9C6FF,#6E85E8)"


class MeetupOut(BaseModel):
    id: int
    city: str
    address: str
    starts_at: datetime
    topic: str
    description: str | None = None
    image_url: str | None = None
    gradient: str
    author: MeetupAuthorOut
    # Заполняется только для своих событий: чужие счётчики автора не
    # касаются.
    responses: int | None = None
    mine: bool = False


class MeetupIn(BaseModel):
    city: str = Field(max_length=64)
    address: str = Field(min_length=3, max_length=255)
    starts_at: datetime
    topic: str = Field(min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("city")
    @classmethod
    def known_city(cls, value: str) -> str:
        city = cities.normalize(value)
        if not city:
            raise ValueError("Непонятный город")
        return city

    @field_validator("starts_at")
    @classmethod
    def not_in_the_past(cls, value: datetime) -> datetime:
        moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        # Небольшой запас: пока человек заполняет форму, время уходит.
        if moment < datetime.now(timezone.utc) - timedelta(minutes=5):
            raise ValueError("Событие не может начинаться в прошлом")
        return moment


class MeetupResponseIn(BaseModel):
    action: Literal["interested", "pass"]


class MeetupResponderOut(BaseModel):
    user_id: int
    first_name: str
    age: int | None = None
    is_verified: bool = False
    photo_url: str | None = None
    gradient: str = "linear-gradient(135deg,#B9C6FF,#6E85E8)"
    accepted: bool = False
    chat_id: int | None = None


# --------------------------- safety & payments ---------------------------


class BlockIn(BaseModel):
    user_id: int


class ReportIn(BaseModel):
    user_id: int
    reason: str = Field(max_length=64)
    details: str | None = Field(default=None, max_length=1000)


class InvoiceIn(BaseModel):
    product: str = Field(max_length=32)


class InvoiceOut(BaseModel):
    payload: str
    product: str
    amount: int
    currency: str = "XTR"
    invoice_link: str | None = None


# --------------------------- verification ---------------------------


class VerificationOut(BaseModel):
    status: str
    gesture: str | None = None
    instruction: str | None = None
    reason: str | None = None
    expires_at: datetime | None = None
    is_verified: bool = False


# --------------------------- admin ---------------------------


class AdminPhotoOut(BaseModel):
    id: int
    user_id: int
    user_name: str
    telegram_id: int
    url: str
    moderation_status: str
    moderation_reason: str | None
    moderation_scores: dict[str, float]
    created_at: datetime


class AdminVerificationOut(BaseModel):
    id: int
    user_id: int
    user_name: str
    gesture: str
    instruction: str
    selfie_url: str | None
    profile_photo_url: str | None
    status: str
    created_at: datetime


class AdminReportOut(BaseModel):
    id: int
    reporter_id: int
    target_id: int
    target_name: str
    target_banned: bool
    reason: str
    details: str | None
    created_at: datetime


class ReviewIn(BaseModel):
    approve: bool
    reason: str | None = Field(default=None, max_length=255)


class AdminStatsOut(BaseModel):
    users_total: int
    users_active: int
    users_banned: int
    photos_pending: int
    verifications_pending: int
    reports_open: int
    matches_total: int
    messages_total: int


class ConfigOut(BaseModel):
    """Product rules the client must not hardcode."""

    blind_mode: bool
    reveal_threshold: int
    min_age: int
    max_photos: int
    daily_like_limit: int
    # Клиенту нужно знать, есть ли смысл показывать экран dev-входа: в
    # проде его быть не должно, там пустой initData — это ошибка, а не
    # приглашение выбрать демо-профиль.
    dev_auth_allowed: bool
    # Список городов приходит с сервера: он же определяет, по каким городам
    # вообще собирается афиша, и расходиться этим двум спискам нельзя.
    cities: list[str]
    test_cards: list[TestCardOut]


AuthOut.model_rebuild()
CandidateOut.model_rebuild()
