# Treffit — схема БД и API-эндпоинты (MVP)

Основано на: тест → скретч-пачка совпадений → карточка совпадения → блайнд-чат → скретч-reveal фото. Стек: FastAPI + PostgreSQL на Aeza VPS, авторизация через `initData` Telegram.

---

## 1. Таблицы БД

### `users`
| Поле | Тип | Комментарий |
|---|---|---|
| id | bigserial PK | внутренний id |
| telegram_id | bigint, unique | из `initDataUnsafe.user.id` |
| username | text, nullable | из Telegram |
| first_name | text | |
| birth_date | date | обязательное — проверка 18+ на уровне API |
| gender | text | |
| city | text | Екатеринбург по умолчанию |
| bio | text, nullable | |
| profile_photo_url | text, nullable | **отдельная от Telegram-аватарки**, приватная, отдаётся только после reveal |
| test_answers | jsonb | `{"1": "right", "2": "left", ...}` — 6 вопросов теста |
| consent_pdn_at | timestamptz, nullable | согласие на обработку перс. данных (152-ФЗ) |
| consent_photo_at | timestamptz, nullable | отдельное согласие на фото/гео — чувствительные данные |
| is_active | boolean default true | бан/soft-delete |
| created_at, updated_at | timestamptz | |

### `events`
| Поле | Тип | Комментарий |
|---|---|---|
| id | bigserial PK | |
| external_id | text | id из KudaGo, для синхронизации |
| title | text | |
| venue | text | |
| starts_at, ends_at | timestamptz | |
| lat, lng | double precision | для геозапросов Live-режима |
| source | text default 'kudago' | |

### `user_events`
| Поле | Тип | Комментарий |
|---|---|---|
| id | bigserial PK | |
| user_id | FK → users | |
| event_id | FK → events | |
| created_at | timestamptz | |

### `matches` (пачка скретч-карт)
| Поле | Тип | Комментарий |
|---|---|---|
| id | bigserial PK | |
| user_id | FK → users | «для кого» карта |
| candidate_id | FK → users | «кто» на карте |
| compatibility_pct | smallint | считается по пересечению `test_answers`, кэшируется |
| shared_flags | jsonb | массив строк для карточки совпадения |
| event_id | FK → events, nullable | если есть общее событие |
| is_live | boolean default false | пересчитывается по окну события |
| scratched_at | timestamptz, nullable | null = карта ещё не открыта |
| created_at | timestamptz | |

*Уникальность: (`user_id`, `candidate_id`).*

### `live_sessions` (чек-ин на месте)
| Поле | Тип | Комментарий |
|---|---|---|
| id | bigserial PK | |
| user_id | FK → users | |
| event_id | FK → events | |
| lat, lng | double precision | снимок из `LocationManager` |
| checked_in_at | timestamptz | |
| expires_at | timestamptz | окно события + буфер |

### `chats`
| Поле | Тип | Комментарий |
|---|---|---|
| id | bigserial PK | |
| user_a_id, user_b_id | FK → users | упорядоченная пара, unique |
| msg_count_a, msg_count_b | int default 0 | **считаются раздельно** — reveal у каждого свой |
| revealed_a | boolean default false | видит ли A фото B |
| revealed_b | boolean default false | видит ли B фото A |
| started_at, last_message_at | timestamptz | |

Порог reveal (`REVEAL_THRESHOLD = 3`) — константа на бэкенде, не на фронте.

### `messages`
| Поле | Тип | Комментарий |
|---|---|---|
| id | bigserial PK | |
| chat_id | FK → chats | |
| sender_id | FK → users | |
| type | text default 'text' | `text` / `system` |
| body | text | |
| sent_at | timestamptz | |

---

## 2. API-эндпоинты

### Авторизация
- `POST /auth/telegram` — принимает `initData`, проверяет хэш через bot token, создаёт/находит `user`, отдаёт сессионный токен

### Профиль
- `GET /me` — профиль + статус теста
- `PATCH /me` — city, bio, birth_date, consent-флаги
- `POST /me/photo` — загрузка приватного фото
- `POST /me/test-answers` — сохранить 6 ответов, пересчитать `matches` для этого пользователя
- `GET /me/test-answers` — для повторного прохождения

### Матчи (скретч-пачка)
- `GET /matches` — список карт: id, `compatibility_pct`, `event`, `scratched` (без имени/фото, пока не открыта)
- `POST /matches/{id}/scratch` — пометить открытой, вернуть полный teaser (имя, %, событие)
- `GET /matches/{id}` — детальная карточка: кольцо совместимости, `shared_flags`, событие

### Чаты
- `POST /chats` — начать чат по `match_id`
- `GET /chats` — список чатов: последнее сообщение, `revealed`
- `GET /chats/{id}/messages` — история
- `POST /chats/{id}/messages` — отправить сообщение → инкремент `msg_count_*` на бэкенде → если достигнут порог, ответ содержит `reveal_unlocked: true`
- `GET /chats/{id}/photo` — **фото собеседника, только если `revealed_*=true` для текущего юзера, иначе 403**

### События / Live
- `GET /events/nearby` — синхронизировано с ботом KudaGo
- `POST /events/{id}/attend` — «иду»
- `POST /live/checkin` — координаты из `LocationManager.getLocation()`, создаёт `live_session`, если в радиусе и окне события
- `GET /live/nearby` — кто ещё чекинился на этом событии

### Платежи (когда понадобится монетизация)
- `POST /payments/invoice` — `createInvoiceLink`, валюта `XTR`
- `POST /payments/webhook` — `successful_payment` от Telegram → выдать купленное (буст анкеты, доп. попытки и т.п.)

---

## 3. Критичный момент безопасности

**Фото не должно попадать на фронт до reveal — ни в каком виде.**
Блюр на клиенте — это только визуал. Реальная защита — `GET /chats/{id}/photo` физически не отдаёт URL/файл, пока `revealed_a`/`revealed_b` не true в БД. Если отдавать ссылку на фото заранее (даже с blur через CSS), человек откроет devtools/consolue и увидит файл до того, как «заслужил» reveal. Проверка — только на бэкенде, при каждом запросе.
