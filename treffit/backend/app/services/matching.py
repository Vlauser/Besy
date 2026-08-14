"""Compatibility scoring, candidate search and deck building."""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import Block, DeckCard, Event, Swipe, SwipeAction, User, UserEvent

# Canonical test definition. The frontend fetches this from GET /test/cards
# so the two can never drift apart.
TEST_CARDS: list[dict] = [
    {"id": 1, "q": "Пятница вечером", "left": "Вечеринка", "right": "Плед и сериал"},
    {"id": 2, "q": "Отпуск", "left": "Спонтанный трип", "right": "План по часам"},
    {"id": 3, "q": "Конфликт", "left": "Обсудить сразу", "right": "Сначала остыть"},
    {"id": 4, "q": "Первое свидание", "left": "Кофе днём", "right": "Бар вечером"},
    {"id": 5, "q": "Идеальные выходные", "left": "Город", "right": "Природа"},
    {"id": 6, "q": "Юмор", "left": "Чёрный", "right": "Добрый"},
]
CARD_BY_ID = {c["id"]: c for c in TEST_CARDS}
VALID_CHOICES = {"left", "right"}


def normalize_answers(raw: dict) -> dict[str, str]:
    """Keep only known question ids with a valid choice, as {"1": "left"}."""
    clean: dict[str, str] = {}
    for key, value in (raw or {}).items():
        try:
            qid = int(key)
        except (TypeError, ValueError):
            continue
        if qid in CARD_BY_ID and value in VALID_CHOICES:
            clean[str(qid)] = value
    return clean


def compute_compatibility(a_answers: dict, b_answers: dict, a_interests=None, b_interests=None) -> tuple[int, list[str]]:
    """Return (percent, shared_flags).

    Percent is the share of test questions both answered the same way,
    nudged by overlapping interests. Flags are the human-readable reasons
    shown on the match card — at most three, best first.
    """
    a = normalize_answers(a_answers)
    b = normalize_answers(b_answers)
    common = sorted(set(a) & set(b), key=int)

    flags: list[str] = []
    if common:
        agreed = [qid for qid in common if a[qid] == b[qid]]
        base = len(agreed) / len(common) * 100
        for qid in agreed:
            card = CARD_BY_ID[int(qid)]
            choice = card["left"] if a[qid] == "left" else card["right"]
            flags.append(f"Оба выбрали «{choice}»")
    else:
        # Nothing to compare on yet — sit in the middle rather than at zero.
        base = 50.0

    shared_interests = sorted(set(a_interests or []) & set(b_interests or []))
    if shared_interests:
        base += min(12.0, 4.0 * len(shared_interests))
        flags.append("Общие интересы: " + ", ".join(shared_interests[:3]))

    pct = int(max(5, min(99, round(base))))
    return pct, flags[:3]


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _birth_date_bounds(age_min: int, age_max: int) -> tuple[date, date]:
    """Ages map to an inclusive birth-date window (older bound first)."""
    today = date.today()
    oldest = today - timedelta(days=int((age_max + 1) * 365.2425) - 1)
    youngest = today - timedelta(days=int(age_min * 365.2425))
    return oldest, youngest


def candidate_query(user: User, *, exclude_swiped: bool = True):
    """Кого этому человеку вообще можно показать.

    `exclude_swiped=False` оставляет в выборке тех, кого он уже пропустил, —
    это нужно, чтобы колода не кончалась. Лайкнутые исключены всегда: их
    лайк ещё ждёт ответа, и показывать такого человека снова значит
    предлагать передумать за спиной у того, кто уже ответил.
    """
    age_min = max(settings.min_age, user.seeking_age_min)
    age_max = max(age_min, user.seeking_age_max)
    oldest, youngest = _birth_date_bounds(age_min, age_max)

    if exclude_swiped:
        skip = select(Swipe.target_id).where(Swipe.actor_id == user.id)
    else:
        skip = select(Swipe.target_id).where(
            Swipe.actor_id == user.id,
            Swipe.action.in_([SwipeAction.like.value, SwipeAction.superlike.value]),
        )
    blocked_by_me = select(Block.blocked_id).where(Block.user_id == user.id)
    blocked_me = select(Block.user_id).where(Block.blocked_id == user.id)

    q = select(User).where(
        User.id != user.id,
        User.is_active.is_(True),
        User.is_banned.is_(False),
        User.onboarded_at.is_not(None),
        User.birth_date.is_not(None),
        User.birth_date.between(oldest, youngest),
        not_(User.id.in_(skip)),
        not_(User.id.in_(blocked_by_me)),
        not_(User.id.in_(blocked_me)),
    )

    if user.seeking_gender != "any":
        q = q.where(User.gender == user.seeking_gender)
    # Respect the candidate's own preference too, so the deck is symmetric.
    if user.gender:
        q = q.where(or_(User.seeking_gender == "any", User.seeking_gender == user.gender))
    if user.city:
        q = q.where(User.city == user.city)
    return q


def _by_compatibility(user: User, pool: list[User], limit: int) -> list[User]:
    """Отсортировать по совпадению. Считается в Python: сравнение ответов
    SQL дёшево не ранжирует."""
    scored = []
    for candidate in pool:
        pct, _ = compute_compatibility(
            user.test_answers, candidate.test_answers, user.interests, candidate.interests
        )
        scored.append((pct, candidate))
    scored.sort(key=lambda item: (item[0], item[1].last_active_at), reverse=True)
    return [c for _, c in scored[:limit]]


async def find_candidates(session: AsyncSession, user: User, limit: int) -> list[User]:
    """Кандидаты по убыванию совпадения. Колода не кончается.

    Сначала те, кого человек ещё не видел. Если их не набирается, добираем
    ранее пропущенными — начиная с тех, кого пропустили давнее всего.

    Пустая колода — это тупик: человеку нечего делать, и он уходит. У живых
    приложений её не бывает, и «мимо» там означает «не сейчас», а не
    «никогда больше». Лайкнутые обратно не возвращаются: их лайк ещё ждёт
    ответа.
    """
    pool_size = max(limit * 5, 100)
    rows = await session.execute(
        candidate_query(user).order_by(User.last_active_at.desc()).limit(pool_size)
    )
    fresh = _by_compatibility(user, list(rows.scalars()), limit)
    if len(fresh) >= limit:
        return fresh

    seen = {c.id for c in fresh}
    # Давние «мимо» вперёд: только что пропущенный не должен возвращаться
    # следующей же карточкой.
    repeat_rows = await session.execute(
        candidate_query(user, exclude_swiped=False)
        .join(Swipe, and_(Swipe.target_id == User.id, Swipe.actor_id == user.id))
        .where(not_(User.id.in_(seen or {0})))
        .order_by(Swipe.created_at.asc())
        .limit(limit - len(fresh))
    )
    return fresh + list(repeat_rows.scalars())


async def score_pair(session: AsyncSession, a: User, b: User) -> tuple[int, list[str], int | None]:
    """Compatibility plus the first event both users are attending, if any."""
    pct, flags = compute_compatibility(a.test_answers, b.test_answers, a.interests, b.interests)
    event_id = await shared_event_id(session, a.id, b.id)
    return pct, flags, event_id


async def shared_event_id(session: AsyncSession, a_id: int, b_id: int) -> int | None:
    mine = select(UserEvent.event_id).where(UserEvent.user_id == a_id).subquery()
    row = await session.execute(
        select(Event.id)
        .join(mine, mine.c.event_id == Event.id)
        .join(UserEvent, and_(UserEvent.event_id == Event.id, UserEvent.user_id == b_id))
        .order_by(Event.starts_at.asc())
        .limit(1)
    )
    return row.scalar_one_or_none()


async def rebuild_deck(session: AsyncSession, user: User, limit: int | None = None) -> list[DeckCard]:
    """Refill the scratch pack with unscratched cards for fresh candidates.

    Cards the user already scratched are kept — the pack is a record of what
    they opened, not a volatile feed.
    """
    limit = limit or settings.deck_page_size
    existing = await session.execute(select(DeckCard.candidate_id).where(DeckCard.user_id == user.id))
    known = set(existing.scalars())

    # Drop stale unscratched cards for people who are gone or already swiped.
    stale = await session.execute(
        select(DeckCard).where(DeckCard.user_id == user.id, DeckCard.scratched_at.is_(None))
    )
    swiped = set(
        (await session.execute(select(Swipe.target_id).where(Swipe.actor_id == user.id))).scalars()
    )
    for card in stale.scalars():
        if card.candidate_id in swiped:
            await session.delete(card)
            known.discard(card.candidate_id)

    remaining = limit - len(known - swiped)
    created: list[DeckCard] = []
    if remaining > 0:
        for candidate in await find_candidates(session, user, remaining + len(known)):
            if candidate.id in known or len(created) >= remaining:
                continue
            pct, flags, event_id = await score_pair(session, user, candidate)
            card = DeckCard(
                user_id=user.id,
                candidate_id=candidate.id,
                compatibility_pct=pct,
                shared_flags=flags,
                event_id=event_id,
            )
            session.add(card)
            created.append(card)
            known.add(candidate.id)

    await session.flush()
    return created


async def daily_like_count(session: AsyncSession, user_id: int) -> int:
    """Likes sent since midnight UTC — the window the daily limit applies to."""
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    row = await session.execute(
        select(func.count())
        .select_from(Swipe)
        .where(
            Swipe.actor_id == user_id,
            Swipe.action.in_(["like", "superlike"]),
            Swipe.created_at >= start_of_day,
        )
    )
    return int(row.scalar_one())
