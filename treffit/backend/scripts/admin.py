"""Операции из командной строки: разобраться в состоянии и выдать доступ.

    python -m scripts.admin status              что настроено и что в очередях
    python -m scripts.admin photos [N]          последние фото и их модерация
    python -m scripts.admin premium <tg_id>     выдать Premium
    python -m scripts.admin premium <tg_id> off снять Premium
    python -m scripts.admin verify <tg_id>      подтвердить анкету
    python -m scripts.admin queue               открытые заявки на верификацию
    python -m scripts.admin events              что лежит в афише и что из этого видно
    python -m scripts.admin deck <tg_id>        почему в колоде столько людей

Запускать от пользователя сервиса, с переменными из .env:

    sudo -u treffit env $(grep -v '^#' .env | grep -v '^$' | xargs -d '\\n') \\
        .venv/bin/python -m scripts.admin status
"""

import asyncio
import sys

from datetime import datetime, timedelta, timezone

from sqlalchemy import Integer, desc, func, or_, select

from app.config import settings
from app.db import SessionLocal
from app.models import Event, ModerationStatus, Photo, User, Verification, VerificationStatus
from app.services import review, verification as verification_service


async def cmd_status() -> None:
    async with SessionLocal() as session:
        admin_ids = settings.admin_ids
        print(f"Модераторы в .env: {sorted(admin_ids) or 'НЕ ЗАДАНЫ'}")
        if admin_ids:
            rows = await session.execute(select(User).where(User.telegram_id.in_(admin_ids)))
            known = {u.telegram_id: u for u in rows.scalars()}
            for tg_id in sorted(admin_ids):
                user = known.get(tg_id)
                # Бот не может написать тому, кто ни разу не открывал приложение.
                mark = f"@{user.username or user.first_name}" if user else "нет такого пользователя"
                print(f"  {tg_id}: {mark}")

        print(f"\nАвтомодерация: {'включена' if settings.moderation_enabled else 'ВЫКЛЮЧЕНА'}")
        print(f"Требовать лицо на фото: {settings.moderation_require_face}")
        print(f"Уведомления: {'включены' if settings.push_enabled else 'ВЫКЛЮЧЕНЫ'}")
        print(f"Токен бота: {'задан' if settings.bot_token else 'НЕ ЗАДАН'}")

        async def count(model, *where):
            query = select(func.count()).select_from(model)
            return int(await session.scalar(query.where(*where) if where else query) or 0)

        print(
            f"\nПользователей: {await count(User)}"
            f"\nФото всего: {await count(Photo)}"
            f"  ждут модератора: {await count(Photo, Photo.moderation_status == ModerationStatus.pending.value)}"
            f"\nЗаявок на верификацию: "
            f"{await count(Verification, Verification.status == VerificationStatus.submitted.value)}"
        )


async def cmd_deck(telegram_id: int) -> None:
    """Разобрать, из кого складывается колода.

    «Пока никого нового» имеет с десяток причин — от незаполненных анкет у
    остальных до того, что человек уже всех лайкнул. Считаем по шагам, а не
    гадаем.
    """
    from app.models import Swipe, SwipeAction
    from app.services import matching

    async with SessionLocal() as session:
        user = await _find(session, telegram_id)
        print(
            f"{user.first_name}: {user.gender or 'пол не указан'}, "
            f"ищет {user.seeking_gender} {user.seeking_age_min}–{user.seeking_age_max}, "
            f"город «{user.city or 'не указан'}»"
        )
        if not user.onboarded_at:
            print("\nАнкета не заполнена — поиск для неё закрыт.")
            return

        async def count(query):
            return int(await session.scalar(select(func.count()).select_from(query.subquery())) or 0)

        in_city = select(User).where(
            User.id != user.id,
            User.is_active.is_(True),
            User.is_banned.is_(False),
            User.onboarded_at.is_not(None),
            User.city == user.city,
        )
        liked = select(Swipe.target_id).where(
            Swipe.actor_id == user.id,
            Swipe.action.in_([SwipeAction.like.value, SwipeAction.superlike.value]),
        )
        passed = select(Swipe.target_id).where(
            Swipe.actor_id == user.id, Swipe.action == SwipeAction.pass_.value
        )

        print(f"\nВ городе заполненных анкет, кроме своей: {await count(in_city)}")
        print(f"  проходят фильтры (пол, возраст, блокировки): {await count(matching.candidate_query(user))}")
        print(f"  уже лайкнуты — в колоду не вернутся: {await count(select(User).where(User.id.in_(liked)))}")
        print(f"  пропущены — вернутся, когда новых не останется: {await count(select(User).where(User.id.in_(passed)))}")

        # Чаще всего колода пуста не из-за фильтров, а потому что вокруг
        # просто никого нет: остальные либо в других городах, либо бросили
        # анкету на полпути. Без этих двух строк «0 в городе» — тупик.
        others = select(User).where(User.id != user.id, User.is_active.is_(True), User.is_banned.is_(False))
        unfinished = await count(others.where(User.onboarded_at.is_(None)))
        elsewhere = await session.execute(
            select(User.city, func.count())
            .where(User.id != user.id, User.onboarded_at.is_not(None), User.city != user.city)
            .group_by(User.city)
            .order_by(func.count().desc())
        )
        rows = elsewhere.all()
        if rows:
            listed = ", ".join(f"{city or 'без города'} — {n}" for city, n in rows[:8])
            print(f"\nЗаполненные анкеты в других городах: {listed}")
            print(
                "  из них годятся, когда свой город кончится: "
                f"{await count(matching.candidate_query(user, same_city=False))}"
            )
        if unfinished:
            print(f"Не дозаполнили анкету (в поиске их нет): {unfinished}")

        found = await matching.find_candidates(session, user, 10)
        print(f"\nКолода сейчас отдаёт: {len(found)}")
        for candidate in found[:10]:
            print(f"  {candidate.first_name}, {candidate.age}")
        if not found:
            print("  Пусто. Смотрите строки выше: скорее всего некого показывать")
            print("  или все подходящие уже лайкнуты.")


async def cmd_events() -> None:
    """Почему в приложении столько событий, сколько их там.

    Считаем ровно тем же условием, что и /events: город пользователя плюс
    «ещё не закончилось или идёт постоянно». Расхождение между «в базе» и
    «видно» сразу показывает, где потерялись события.
    """
    now = datetime.now(timezone.utc)
    listable = or_(
        Event.is_permanent.is_(True),
        Event.ends_at >= now,
        Event.starts_at >= now - timedelta(hours=6),
    )

    async with SessionLocal() as session:
        rows = await session.execute(
            select(
                Event.city,
                func.count(),
                func.sum(func.cast(Event.is_permanent, Integer)),
            ).group_by(Event.city).order_by(desc(func.count()))
        )
        totals = rows.all()
        if not totals:
            print("Событий в базе нет. Запустите scripts.sync_events")
            return

        print(f"{'Город':<20}{'всего':>7}{'видно':>7}{'постоянных':>12}")
        for city, total, permanent in totals:
            visible = await session.scalar(
                select(func.count()).select_from(Event).where(Event.city == city, listable)
            )
            print(f"{city:<20}{total:>7}{visible:>7}{int(permanent or 0):>12}")

        cities_of_users = await session.execute(
            select(User.city, func.count()).where(User.is_active.is_(True)).group_by(User.city)
        )
        print("\nГорода пользователей:")
        for city, count in cities_of_users.all():
            visible = await session.scalar(
                select(func.count()).select_from(Event).where(Event.city == city, listable)
            )
            mark = "" if visible else "  ← событий для них нет"
            print(f"  {city}: {count} чел., видят {visible} событий{mark}")


async def cmd_photos(limit: int) -> None:
    async with SessionLocal() as session:
        rows = await session.execute(
            select(Photo, User).join(User, User.id == Photo.user_id).order_by(desc(Photo.id)).limit(limit)
        )
        items = rows.all()
        if not items:
            print("Фотографий пока нет.")
            return
        for photo, owner in items:
            scores = photo.moderation_scores or {}
            worst = max(scores.items(), key=lambda item: item[1], default=None)
            detail = f" · детектор: {worst[0]} {worst[1]:.2f}" if worst else ""
            print(
                f"#{photo.id} {owner.first_name} (tg {owner.telegram_id}) — "
                f"{photo.moderation_status}{detail}"
            )
            if photo.moderation_reason:
                print(f"      причина: {photo.moderation_reason}")


async def _find(session, telegram_id: int) -> User:
    user = await session.scalar(select(User).where(User.telegram_id == telegram_id))
    if user is None:
        sys.exit(f"Пользователь с telegram_id {telegram_id} не найден — пусть сначала откроет приложение")
    return user


async def cmd_premium(telegram_id: int, enable: bool) -> None:
    async with SessionLocal() as session:
        user = await _find(session, telegram_id)
        user.is_premium = enable
        await session.commit()
        print(f"{user.first_name} (tg {telegram_id}): Premium {'выдан' if enable else 'снят'}")


async def cmd_queue() -> None:
    async with SessionLocal() as session:
        rows = await session.execute(
            select(Verification, User)
            .join(User, User.id == Verification.user_id)
            .where(Verification.status == VerificationStatus.submitted.value)
            .order_by(Verification.created_at)
        )
        items = rows.all()
        if not items:
            print("Открытых заявок нет.")
            return
        for request, owner in items:
            print(
                f"#{request.id} {owner.first_name} (tg {owner.telegram_id}) — "
                f"жест: {verification_service.describe(request.gesture)}"
            )
        print("\nПодтвердить:  python -m scripts.admin verify <tg_id>")


async def cmd_verify(telegram_id: int) -> None:
    """Закрыть заявку, а не просто поставить флаг.

    Иначе она навсегда остаётся в очереди, а селфи — на диске, хотя
    смысла хранить его после проверки нет.
    """
    async with SessionLocal() as session:
        user = await _find(session, telegram_id)
        request = await session.scalar(
            select(Verification)
            .where(
                Verification.user_id == user.id,
                Verification.status == VerificationStatus.submitted.value,
            )
            .order_by(desc(Verification.created_at))
            .limit(1)
        )
        if request is not None:
            await review.decide_verification(
                session, request, approve=True, reason=None, admin_id=None
            )
            print(f"{user.first_name} (tg {telegram_id}): заявка #{request.id} закрыта, селфи удалено")
        else:
            user.is_verified = True
            await session.commit()
            print(f"{user.first_name} (tg {telegram_id}): галочка поставлена (заявки не было)")


async def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    command = args[0]

    if command == "status":
        await cmd_status()
    elif command == "photos":
        await cmd_photos(int(args[1]) if len(args) > 1 else 10)
    elif command == "premium":
        if len(args) < 2:
            sys.exit("Укажите telegram_id")
        await cmd_premium(int(args[1]), enable=(len(args) < 3 or args[2] != "off"))
    elif command == "queue":
        await cmd_queue()
    elif command == "events":
        await cmd_events()
    elif command == "deck":
        if len(args) < 2:
            sys.exit("Укажите telegram_id")
        await cmd_deck(int(args[1]))
    elif command == "verify":
        if len(args) < 2:
            sys.exit("Укажите telegram_id")
        await cmd_verify(int(args[1]))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    asyncio.run(main())
