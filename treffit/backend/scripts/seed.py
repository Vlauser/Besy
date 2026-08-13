"""Populate a development database with demo profiles and events.

    python -m scripts.seed

Safe to re-run: users are keyed by telegram_id and updated in place.
"""

import asyncio
import io
import random
from datetime import date, datetime, timedelta, timezone

from PIL import Image, ImageDraw
from sqlalchemy import select

from app.config import settings
from app.db import Base, SessionLocal, engine
from app.models import Event, Photo, User
from app.services import media

DEMO_USERS = [
    ("Аня", "female", "male", 1996, ["музыка", "джаз", "бег"], "Люблю живую музыку и утренние пробежки."),
    ("Соня", "female", "male", 1999, ["арт", "граффити", "кино"], "Хожу на все выставки в городе."),
    ("Лера", "female", "male", 1994, ["книги", "кофе", "театр"], "Читаю больше, чем сплю."),
    ("Игорь", "male", "female", 1993, ["сериалы", "готовка", "книги"], "Готовлю лучшую пасту в Екатеринбурге."),
    ("Дима", "male", "female", 1991, ["горы", "фото", "бег"], "Каждые выходные — новый маршрут."),
    ("Марк", "male", "female", 1997, ["музыка", "джаз", "кино"], "Играю на саксофоне по четвергам."),
]

DEMO_EVENTS = [
    ("Джаз-вечер в Tele-Club", "Tele-Club", 3, 56.8360, 60.6100),
    ("Выставка граффити", "Ельцин Центр", 30, 56.8447, 60.5878),
    ("Лекция про кино", "Дом Печати", 54, 56.8300, 60.5960),
]

COLORS = [(143, 184, 255), (185, 198, 255), (169, 198, 255), (183, 203, 255), (110, 133, 232), (61, 107, 255)]


def demo_photo(seed: int) -> bytes:
    """A generated placeholder — no real people in seed data."""
    rng = random.Random(seed)
    image = Image.new("RGB", (720, 960), COLORS[seed % len(COLORS)])
    draw = ImageDraw.Draw(image)
    for _ in range(12):
        x, y = rng.randint(0, 720), rng.randint(0, 960)
        radius = rng.randint(60, 220)
        shade = tuple(min(255, c + rng.randint(-40, 40)) for c in COLORS[(seed + 1) % len(COLORS)])
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=shade)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=88)
    return buffer.getvalue()


async def seed_events(session) -> None:
    now = datetime.now(timezone.utc)
    for index, (title, venue, hours, lat, lng) in enumerate(DEMO_EVENTS):
        external_id = f"demo-{index}"
        existing = await session.scalar(select(Event).where(Event.external_id == external_id))
        starts_at = now + timedelta(hours=hours)
        if existing:
            existing.starts_at = starts_at
            continue
        session.add(
            Event(
                external_id=external_id,
                title=title,
                venue=venue,
                starts_at=starts_at,
                ends_at=starts_at + timedelta(hours=4),
                lat=lat,
                lng=lng,
                source="demo",
            )
        )


async def seed_users(session) -> None:
    now = datetime.now(timezone.utc)
    for index, (name, gender, seeking, birth_year, interests, bio) in enumerate(DEMO_USERS):
        telegram_id = 900_000 + index
        user = await session.scalar(select(User).where(User.telegram_id == telegram_id))
        if user is None:
            user = User(telegram_id=telegram_id, first_name=name)
            session.add(user)

        rng = random.Random(index)
        user.first_name = name
        user.gender = gender
        user.seeking_gender = seeking
        user.birth_date = date(birth_year, 1 + index % 12, 1 + index % 28)
        user.city = "Екатеринбург"
        user.bio = bio
        user.interests = interests
        user.test_answers = {str(q): rng.choice(["left", "right"]) for q in range(1, 7)}
        user.test_completed_at = now
        user.consent_pdn_at = now
        user.consent_photo_at = now
        user.onboarded_at = now
        user.last_active_at = now
        user.is_verified = index % 2 == 0
        await session.flush()

        has_photo = await session.scalar(select(Photo).where(Photo.user_id == user.id))
        if has_photo is None:
            stored = media.store_photo(demo_photo(index), user.id)
            session.add(
                Photo(user_id=user.id, position=0, moderation_status="approved", **stored)
            )


async def main() -> None:
    settings.media_root.mkdir(parents=True, exist_ok=True)
    if settings.database_url.startswith("sqlite"):
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as session:
        await seed_events(session)
        await seed_users(session)
        await session.commit()

    print(f"Seeded {len(DEMO_USERS)} profiles and {len(DEMO_EVENTS)} events.")
    print("Log in as any of them with POST /auth/telegram {\"dev_telegram_id\": 900000}")
    print("(requires TREFFIT_ALLOW_DEV_AUTH=true)")


if __name__ == "__main__":
    asyncio.run(main())
