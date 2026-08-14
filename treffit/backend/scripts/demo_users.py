"""Демо-анкеты, чтобы приложение не было пустым.

    python -m scripts.demo_users add [N]      N анкет в каждый город (по умолчанию 20)
    python -m scripts.demo_users add 20 --afisha   только города, где есть афиша
    python -m scripts.demo_users add 20 --photos /srv/treffit/cats   свои картинки
    python -m scripts.demo_users status       сколько их сейчас и в каких городах
    python -m scripts.demo_users remove       убрать все демо-анкеты и их файлы

Без `--photos` коты рисуются кодом: скрипт обязан работать без сети, и
чужих изображений в репозитории быть не должно. С `--photos` берутся файлы
из указанной папки — годится всё, что читает Pillow (jpg, png, webp).
Файлов может быть меньше, чем анкет: они пойдут по кругу.

Это не люди. Настоящий человек может лайкнуть такую анкету и не получить
ответа — матч требует встречного лайка, а его не будет никогда. Поэтому:

• на фотографиях коты, а не лица: перепутать невозможно;
• `telegram_id` отрицательный — у живых пользователей Telegram он всегда
  положительный, так что войти под демо-анкетой нельзя ни при каких
  настройках, и `remove` не заденет никого живого;
• уведомления таким «пользователям» не уходят (см. services/push).

Убирать их — как только появятся живые люди.
"""

import asyncio
import io
import math
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageDraw
from sqlalchemy import func, select

from app import cities
from app.config import settings
from app.db import Base, SessionLocal, engine
from app.models import Photo, User
from app.services import media

# Живой telegram_id всегда положительный, так что этот диапазон не может
# пересечься с настоящим пользователем.
DEMO_TG_BASE = -1_000_000

FEMALE_NAMES = (
    "Аня", "Соня", "Лера", "Катя", "Маша", "Даша", "Настя", "Полина", "Вика", "Юля",
    "Ксюша", "Алиса", "Марина", "Лиза", "Кристина", "Оля", "Ира", "Женя", "Таня", "Света",
    "Милана", "Арина", "Варя", "Ника", "Рита", "Злата", "Ульяна", "Яна", "Инна", "Диана",
)
MALE_NAMES = (
    "Игорь", "Дима", "Марк", "Артём", "Саша", "Миша", "Кирилл", "Никита", "Ваня", "Егор",
    "Паша", "Рома", "Костя", "Лёша", "Влад", "Максим", "Данил", "Тимур", "Серёжа", "Антон",
    "Глеб", "Стас", "Боря", "Гриша", "Захар", "Лев", "Олег", "Руслан", "Федя", "Юра",
)

INTERESTS = (
    "музыка", "кино", "книги", "бег", "горы", "кофе", "театр", "фото", "готовка", "джаз",
    "велосипед", "йога", "настолки", "походы", "выставки", "сериалы", "танцы", "плавание",
    "языки", "история", "лыжи", "рыбалка", "гитара", "подкасты",
)

BIOS = (
    "Хожу на все выставки в городе.",
    "Читаю больше, чем сплю.",
    "Каждые выходные — новый маршрут.",
    "Ищу компанию на утренние пробежки.",
    "Готовлю пасту лучше, чем в ресторане.",
    "Люблю живую музыку и долгие разговоры.",
    "Могу час выбирать кофе и ни разу не пожалеть.",
    "Собираю виниловые пластинки.",
    "Планирую отпуск круглый год.",
    "Знаю, где в городе лучший вид на закат.",
    "Не умею кататься на коньках, но очень хочу научиться.",
    "Смотрю кино только в кинотеатре.",
    "По выходным уезжаю за город.",
    "Играю в настолки и всегда ищу четвёртого.",
    "Учу третий язык и опять застряла на артиклях.",
    "Хожу в горы и фотографирую всё подряд.",
)

# Пастельные фоны и масти котов — плоская заливка сжимается в килобайты,
# так что две с половиной тысячи анкет не съедят диск.
BACKGROUNDS = ((255, 214, 214), (214, 233, 255), (222, 245, 222), (255, 238, 205),
               (233, 222, 255), (255, 226, 240), (215, 245, 243), (240, 235, 220))
FURS = ((247, 168, 100), (120, 120, 128), (245, 245, 242), (86, 74, 68),
        (210, 180, 140), (60, 60, 66), (232, 200, 150))


def cat_photo(seed: int) -> bytes:
    """Нарисованный кот. Без сети и без чужих изображений в репозитории."""
    rng = random.Random(seed)
    width, height = 720, 960
    background = BACKGROUNDS[rng.randrange(len(BACKGROUNDS))]
    fur = FURS[rng.randrange(len(FURS))]
    dark = tuple(max(0, channel - 45) for channel in fur)
    light = tuple(min(255, channel + 38) for channel in fur)

    image = Image.new("RGB", (width, height), background)
    draw = ImageDraw.Draw(image)

    # Пара крупных кругов на фоне, чтобы карточки не выглядели одинаково.
    for _ in range(2):
        radius = rng.randint(150, 280)
        cx, cy = rng.randint(0, width), rng.randint(0, height)
        tint = tuple(max(0, channel - 18) for channel in background)
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=tint)

    cx, cy = width // 2, int(height * 0.46)
    head = int(width * 0.31)

    # Уши: треугольник с розовой серединой.
    for side in (-1, 1):
        base_x = cx + side * int(head * 0.62)
        tip = (base_x + side * int(head * 0.30), cy - int(head * 1.42))
        outer = (base_x + side * int(head * 0.72), cy - int(head * 0.42))
        inner = (base_x - side * int(head * 0.22), cy - int(head * 0.66))
        draw.polygon([tip, outer, inner], fill=fur)
        draw.polygon(
            [
                (tip[0] - side * int(head * 0.06), tip[1] + int(head * 0.20)),
                (outer[0] - side * int(head * 0.20), outer[1] - int(head * 0.06)),
                (inner[0] + side * int(head * 0.04), inner[1] + int(head * 0.04)),
            ],
            fill=(255, 190, 200),
        )

    draw.ellipse((cx - head, cy - head, cx + head, cy + head), fill=fur)

    # Полоски — только для мастей, на которых они видны.
    if rng.random() < 0.5:
        for index in range(3):
            offset = int(head * (0.30 + 0.20 * index))
            draw.arc(
                (cx - head + 20, cy - head + offset, cx + head - 20, cy + head - offset),
                start=200, end=250, fill=dark, width=12,
            )
            draw.arc(
                (cx - head + 20, cy - head + offset, cx + head - 20, cy + head - offset),
                start=290, end=340, fill=dark, width=12,
            )

    eye_dx, eye_dy = int(head * 0.38), int(head * 0.10)
    eye_w, eye_h = int(head * 0.20), int(head * 0.26)
    for side in (-1, 1):
        ex = cx + side * eye_dx
        draw.ellipse((ex - eye_w, cy - eye_dy - eye_h, ex + eye_w, cy - eye_dy + eye_h), fill=(252, 252, 250))
        pupil = int(eye_w * 0.46)
        draw.ellipse(
            (ex - pupil, cy - eye_dy - int(eye_h * 0.72), ex + pupil, cy - eye_dy + int(eye_h * 0.72)),
            fill=(38, 38, 44),
        )
        draw.ellipse(
            (ex - int(pupil * 0.9), cy - eye_dy - int(eye_h * 0.62),
             ex - int(pupil * 0.1), cy - eye_dy - int(eye_h * 0.10)),
            fill=(255, 255, 255),
        )

    nose_y = cy + int(head * 0.26)
    nose_w = int(head * 0.13)
    draw.polygon(
        [(cx - nose_w, nose_y - nose_w // 2), (cx + nose_w, nose_y - nose_w // 2), (cx, nose_y + nose_w)],
        fill=(226, 122, 138),
    )
    for side in (-1, 1):
        draw.arc(
            (cx + side * int(head * 0.22) - int(head * 0.22), nose_y,
             cx + side * int(head * 0.22) + int(head * 0.22), nose_y + int(head * 0.34)),
            start=0 if side < 0 else 180, end=180 if side < 0 else 360, fill=dark, width=9,
        )

    for row in range(3):
        angle = math.radians(-12 + row * 12)
        length = int(head * 0.95)
        for side in (-1, 1):
            start_x = cx + side * int(head * 0.44)
            start_y = nose_y - int(head * 0.02)
            end_x = start_x + side * int(length * math.cos(angle))
            end_y = start_y + int(length * math.sin(angle))
            draw.line((start_x, start_y, end_x, end_y), fill=light, width=7)

    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=86, optimize=True)
    return buffer.getvalue()


PHOTO_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}


def load_photo_pool(folder: Path) -> list[bytes]:
    """Прочитать папку с картинками. Пустая или отсутствующая — это ошибка.

    Молча свалиться на рисованных котов нельзя: человек указал папку именно
    затем, чтобы взяли его картинки, и подмена прошла бы незамеченной до
    первого взгляда на приложение.
    """
    if not folder.is_dir():
        sys.exit(f"Папки {folder} нет — положите в неё картинки или уберите --photos")

    pool: list[bytes] = []
    skipped: list[str] = []
    for path in sorted(folder.iterdir()):
        if not path.is_file() or path.suffix.lower() not in PHOTO_SUFFIXES:
            continue
        raw = path.read_bytes()
        try:
            # Приводим к JPEG сами: store_photo принимает не всякий формат,
            # а из папки прилетит что угодно, включая webp и палитровый png.
            image = Image.open(io.BytesIO(raw))
            image.load()
            pool.append(_to_card(image))
        except Exception:
            skipped.append(path.name)

    if not pool:
        sys.exit(f"В {folder} не нашлось ни одной читаемой картинки")
    print(f"Картинок в папке: {len(pool)}" + (f", пропущено нечитаемых: {len(skipped)}" if skipped else ""))
    if skipped:
        print("  " + ", ".join(skipped[:5]) + ("…" if len(skipped) > 5 else ""))
    return pool


def _to_card(image: Image.Image) -> bytes:
    """Обрезать по центру под вертикальную карточку 3:4 и пережать в JPEG."""
    image = image.convert("RGB")
    target = 720 / 960
    width, height = image.size
    if width / height > target:
        crop = int(height * target)
        box = ((width - crop) // 2, 0, (width - crop) // 2 + crop, height)
    else:
        crop = int(width / target)
        box = (0, (height - crop) // 2, width, (height - crop) // 2 + crop)
    image = image.resize((720, 960), Image.LANCZOS, box=box)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=86, optimize=True)
    return buffer.getvalue()


def _profile(rng: random.Random, city: str, index: int) -> dict:
    female = index % 2 == 0
    names = FEMALE_NAMES if female else MALE_NAMES
    seeking = "any" if rng.random() < 0.12 else ("male" if female else "female")
    age = rng.randint(19, 42)
    today = date.today()
    return {
        "first_name": names[rng.randrange(len(names))],
        "gender": "female" if female else "male",
        "seeking_gender": seeking,
        "birth_date": date(today.year - age, rng.randint(1, 12), rng.randint(1, 28)),
        "seeking_age_min": max(18, age - rng.randint(3, 10)),
        "seeking_age_max": age + rng.randint(3, 12),
        "city": city,
        "bio": BIOS[rng.randrange(len(BIOS))],
        "interests": rng.sample(INTERESTS, rng.randint(2, 5)),
        "test_answers": {str(q): rng.choice(["left", "right"]) for q in range(1, 7)},
        "is_verified": rng.random() < 0.3,
    }


async def cmd_add(per_city: int, only_afisha: bool, photos: Path | None) -> None:
    names = [cities.name_for_slug(slug) for slug in cities.SYNC_SLUGS] if only_afisha else list(cities.NAMES)
    total = per_city * len(names)
    print(f"{len(names)} городов × {per_city} = {total} анкет. Это займёт минуту-другую.")

    pool = load_photo_pool(photos) if photos else None
    if pool and len(pool) < total:
        print(f"Картинок меньше, чем анкет: каждая повторится примерно {round(total / len(pool))} раз.")

    settings.media_root.mkdir(parents=True, exist_ok=True)
    if settings.database_url.startswith("sqlite"):
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    now = datetime.now(timezone.utc)
    made = 0
    async with SessionLocal() as session:
        for city_index, city in enumerate(names):
            # Свой порядок картинок в каждом городе: подряд идущие карточки
            # не должны повторяться, пока папка не кончилась.
            order = list(range(len(pool))) if pool else []
            random.Random(city_index).shuffle(order)

            for index in range(per_city):
                serial = city_index * 1000 + index
                telegram_id = DEMO_TG_BASE - serial
                if await session.scalar(select(User.id).where(User.telegram_id == telegram_id)):
                    continue

                rng = random.Random(serial)
                user = User(telegram_id=telegram_id, **_profile(rng, city, index))
                # Разное «был в сети» — иначе колода выстроит всех в порядке
                # создания и первым городом станет тот, что завели раньше.
                user.last_active_at = now - timedelta(minutes=rng.randint(0, 60 * 24 * 5))
                user.consent_pdn_at = user.consent_photo_at = now
                user.test_completed_at = user.onboarded_at = now
                session.add(user)
                await session.flush()

                raw = pool[order[index % len(order)]] if pool else cat_photo(serial)
                stored = media.store_photo(raw, user.id)
                session.add(Photo(user_id=user.id, position=0, moderation_status="approved", **stored))
                made += 1

            await session.commit()
            print(f"  {city}: готово ({made} из {total})")

    print(f"\nДобавлено анкет: {made}")
    if made < total:
        print("Остальные уже были — команда повторяется без вреда.")


async def cmd_status() -> None:
    async with SessionLocal() as session:
        total = await session.scalar(
            select(func.count()).select_from(User).where(User.telegram_id < 0)
        )
        print(f"Демо-анкет всего: {int(total or 0)}")
        if not total:
            return
        rows = await session.execute(
            select(User.city, func.count())
            .where(User.telegram_id < 0)
            .group_by(User.city)
            .order_by(func.count().desc())
        )
        listed = rows.all()
        print(f"Городов: {len(listed)}")
        for city, count in listed[:10]:
            print(f"  {city}: {count}")
        if len(listed) > 10:
            print(f"  … и ещё {len(listed) - 10} городов")

        live = await session.scalar(
            select(func.count()).select_from(User).where(User.telegram_id > 0)
        )
        print(f"\nЖивых пользователей: {int(live or 0)}")


async def cmd_remove() -> None:
    async with SessionLocal() as session:
        photos = await session.execute(
            select(Photo.file_path, Photo.thumb_path)
            .join(User, User.id == Photo.user_id)
            .where(User.telegram_id < 0)
        )
        files = photos.all()
        users = await session.execute(select(User).where(User.telegram_id < 0))
        removed = 0
        for user in users.scalars():
            await session.delete(user)
            removed += 1
        await session.commit()

    # Файлы — после коммита: упади удаление на полпути, в базе не должно
    # остаться анкет с картинками, которых уже нет.
    for file_path, thumb_path in files:
        media.delete_files(file_path, thumb_path)

    print(f"Удалено демо-анкет: {removed}, файлов: {len(files) * 2}")


async def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    command = args[0]

    if command == "add":
        photos = None
        if "--photos" in args:
            position = args.index("--photos")
            if position + 1 >= len(args):
                sys.exit("После --photos укажите путь к папке с картинками")
            photos = Path(args[position + 1]).expanduser()
            args = args[:position] + args[position + 2:]

        rest = [a for a in args[1:] if not a.startswith("--")]
        per_city = int(rest[0]) if rest else 20
        if per_city < 1:
            sys.exit("Сколько анкет в город? Число должно быть больше нуля")
        await cmd_add(per_city, only_afisha="--afisha" in args, photos=photos)
    elif command == "status":
        await cmd_status()
    elif command == "remove":
        await cmd_remove()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except BrokenPipeError:
        # `… | head` закрывает трубу, и обычный print падает трейсбеком.
        # Наполнение при этом уже записано: команда повторяется без вреда и
        # дозаполнит остаток.
        sys.stderr.close()
