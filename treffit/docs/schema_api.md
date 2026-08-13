# Treffit — схема БД и API

Справочник по тому, что реально реализовано в `backend/`. Источник истины —
`backend/app/models.py` (таблицы) и `GET /docs` у запущенного сервиса
(OpenAPI со всеми схемами запросов и ответов).

Стек: FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL, авторизация через
`initData` Telegram, миграции — Alembic.

---

## 0. Что изменилось против первой редакции документа

Первая редакция называла `matches` пачку рекомендаций для одного человека.
Twinby-подобному продукту нужны обе сущности сразу, поэтому они разделены:

| Было | Стало | Смысл |
|---|---|---|
| `matches` | `deck_cards` | кандидаты, показанные одному пользователю (скретч-пачка) |
| — | `matches` | **взаимный** лайк двоих; владеет ровно одним чатом |
| — | `swipes` | лайк / пропуск / суперлайк — основа свайп-колоды |
| — | `photos` | несколько фото на анкету + статус модерации |
| — | `blocks`, `reports` | блокировки и жалобы |
| — | `purchases` | покупки за Telegram Stars |

Остальные таблицы (`users`, `events`, `user_events`, `live_sessions`,
`chats`, `messages`) сохранили исходный смысл и обросли полями.

---

## 1. Таблицы

### `users`
Ключевые поля: `telegram_id` (unique), `first_name`, `birth_date`,
`gender`, `seeking_gender`, `seeking_age_min/max`, `city`, `bio`,
`interests` (jsonb), `test_answers` (jsonb `{"1":"left",…}`),
`test_completed_at`, `consent_pdn_at`, `consent_photo_at`,
`is_premium`, `is_verified`, `is_active`, `is_banned`, `onboarded_at`,
`last_active_at`.

- `birth_date` проверяется на 18+ в схеме запроса и **замораживается** после
  первого сохранения — иначе можно зарегистрироваться взрослым и потом
  поправить возраст.
- `is_onboarded` — вычисляемое свойство: дата рождения + пол + согласие ПДн +
  пройденный тест. Без него закрыт весь социальный API (HTTP 428).

### `photos`
`user_id`, `position` (unique вместе с `user_id`), `file_path`, `thumb_path`,
`blur_gradient`, `moderation_status` (`pending`/`approved`/`rejected`).

Файл никогда не отдаётся статикой — только через `/media/photos/{id}`,
где проверяются права. `blur_gradient` — двухцветный CSS-градиент, снятый с
самого изображения: он показывается **вместо** фото, поэтому «расблюрить»
нечего, настоящие пиксели не покидают сервер. EXIF снимается при загрузке
(перекодирование в JPEG), иначе геометка из фото — прямая утечка адреса.

### `swipes`
`actor_id`, `target_id`, `action` (`like`/`pass`/`superlike`),
unique по паре. Взаимный `like`/`superlike` создаёт `matches`.

### `deck_cards`
Скретч-пачка: `user_id`, `candidate_id` (unique пара),
`compatibility_pct`, `shared_flags` (jsonb), `event_id`, `is_live`,
`scratched_at` (null = не открыта).

### `matches`
Взаимный лайк: `user_a_id < user_b_id` (constraint), поэтому пара уникальна.
`compatibility_pct`, `shared_flags`, `event_id`, `source`, `is_active`.

### `chats`
`match_id` (unique), `user_a_id`, `user_b_id`, **`msg_count_a` /
`msg_count_b`**, `revealed_a` / `revealed_b`, `unread_a` / `unread_b`,
`last_message_at`.

Счётчики раздельные: reveal зарабатывает каждый сам за себя.
`revealed_a = true` означает «A заслужил увидеть фото B».

### `messages`
`chat_id`, `sender_id` (null у системных), `type` (`text`/`system`),
`body`, `sent_at`, `read_at`.

### `events`, `user_events`, `live_sessions`
Как в исходной схеме. Гео считается формулой гаверсинуса в Python —
PostGIS ради одного радиуса не нужен.

### `blocks`, `reports`
Блокировка скрывает обоих друг от друга и деактивирует общий матч.
Жалоба неявно блокирует. Пять независимых жалобщиков — автобан.

### `purchases`
`product`, `amount`, `currency` (`XTR`), `payload` (unique),
`telegram_charge_id` (unique), `status`.

---

## 2. Эндпоинты

Полная спецификация с телами запросов — `GET /docs`.

### Служебные
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/health` | проверка живости |
| GET | `/config` | правила продукта для клиента: `blind_mode`, `reveal_threshold`, `min_age`, `max_photos`, лимит лайков, карточки теста |

`/config` только сообщает UI, что рисовать. Порог reveal применяется на
сервере; клиент ничего им не открывает.

### Авторизация
| Метод | Путь | |
|---|---|---|
| POST | `/auth/telegram` | `{init_data}` → проверка HMAC → JWT. Поля `dev_telegram_id`/`dev_first_name` работают только при `TREFFIT_ALLOW_DEV_AUTH=true` |

Проверка `initData`: ключ подписи — `HMAC_SHA256("WebAppData", bot_token)`,
плюс отказ по возрасту `auth_date`, чтобы перехваченную строку нельзя было
переигрывать вечно.

### Профиль
`GET /me` · `PATCH /me` · `DELETE /me` (мягкое удаление) ·
`POST /me/consent` · `GET|POST /me/test-answers` ·
`POST /me/photos` · `DELETE /me/photos/{id}` · `POST /me/photos/{id}/primary`

Сохранение ответов теста инвалидирует нестёртые карты пачки — проценты
кэшируются на картах.

### Поиск и свайпы
| Метод | Путь | |
|---|---|---|
| GET | `/discover` | свайп-колода: кандидаты, отсортированные по совместимости |
| POST | `/discover/{user_id}/swipe` | `{action}` → `{matched, match_id, chat_id, likes_left}` |
| GET | `/discover/likes` | кто лайкнул вас (402 без Premium) |
| GET | `/deck` | скретч-пачка; закрытая карта содержит только свой `id` |
| POST | `/deck/{card_id}/scratch` | открыть карту — **только этот ответ** отдаёт анкету |

### Матчи и чаты
`GET /matches` · `GET /chats` · `GET /chats/{id}` ·
`GET /chats/{id}/messages` · `POST /chats/{id}/messages` ·
`POST /chats/{id}/read` · `GET /chats/{id}/photo`

`POST /chats/{id}/messages` возвращает `{message, reveal_unlocked,
remaining_to_reveal, system_message}`.

### События и Live
`GET /events` · `POST|DELETE /events/{id}/attend` ·
`POST /live/checkin` · `GET /live/nearby`

Чек-ин отклоняется вне радиуса (`TREFFIT_LIVE_RADIUS_METERS`) и вне окна
события — иначе Live перестаёт означать «человек действительно здесь».

### Безопасность и платежи
`POST /safety/block` · `DELETE /safety/block/{id}` · `GET /safety/blocks` ·
`POST /safety/report` · `GET /safety/reports/mine`
`GET /payments/products` · `POST /payments/invoice` · `POST /payments/webhook` · `GET /payments/mine`

Вебхук Telegram ничем не подписан, поэтому единственная защита — общий
секрет из `setWebhook(secret_token=…)`, он сверяется с заголовком
`X-Telegram-Bot-Api-Secret-Token`. Повторная доставка не начисляет покупку
дважды.

### WebSocket `/ws?token=<jwt>`
Сервер шлёт: `ready`, `message`, `read`, `typing`, `match`, `superlike`,
`reveal`. Клиент шлёт только `ping` и `typing` — отправка сообщений идёт
по HTTP, чтобы счётчик reveal имел ровно один путь исполнения.

Хаб внутрипроцессный (`app/ws.py`), поэтому сервис запускается **в один
воркер**. Для горизонтального масштабирования нужен Redis pub/sub.

---

## 3. Критичный момент безопасности

**Фото не попадает на фронт до reveal — ни в каком виде.**

Реализовано в одной точке — `serializers.can_view_photos()`, через которую
проходит любой ответ с чужими фото:

1. В ответах API у закрытых фото `url = null`, приходит только градиент —
   расблюривать в devtools нечего.
2. `GET /chats/{id}/photo` возвращает 403, пока `revealed_*` не `true` в БД.
3. `GET /media/photos/{id}` перепроверяет то же правило при каждом запросе
   к файлу и требует `approved` модерации для всех, кроме владельца.
4. Статической раздачи каталога с медиа нет нигде в приложении.

Тесты на это: `backend/tests/test_flow.py` —
`test_photo_is_withheld_until_the_reveal_is_earned`,
`test_photo_bytes_are_refused_before_reveal`,
`test_candidate_payload_never_carries_a_locked_url`.
