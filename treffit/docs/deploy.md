# Развёртывание Treffit

Инструкция под Ubuntu 20.04/22.04/24.04 на VPS (Aeza). Всё, что ниже, проверяемо
пошагово: после каждого блока есть команда, показывающая, что шаг удался.

**Важно:** путь `initData` и всё, что связано с Telegram (хаптика,
BackButton, геолокация, Stars), написано по документации, но на живом
клиенте не проверялось. Раздел «Проверка в Telegram» в конце — это не
формальность, а первый настоящий тест этой части.

---

## Быстрый путь

Шаги 1–7 (пакеты, пользователь, база, venv, миграции, сборка, systemd)
делает один скрипт. Домен, TLS и бота он не трогает — там нужны ваши
данные.

```bash
git clone https://github.com/Vlauser/Besy.git /srv/treffit/src
sudo bash /srv/treffit/src/treffit/deploy/bootstrap.sh
```

Скрипт идемпотентный: повторный запуск безопасен и **не перегенерирует
`.env`** — иначе сменился бы `SECRET_KEY`, а это разлогинит всех и сломает
секрет вебхука. В конце он печатает оставшиеся шаги с уже подставленными
путями.

Дальше — раздел 8 (nginx и TLS). Разделы 1–7 ниже нужны, если хотите
делать вручную или разбираться, что пошло не так.

---

## 0. Что понадобится

- Домен, направленный A-записью на IP сервера.
- Токен бота от [@BotFather](https://t.me/BotFather).
- **Python 3.11+.** Код использует `StrEnum` и `asyncio.to_thread`, так
  что системный python3 из Ubuntu 20.04 (3.8) не подойдёт. `bootstrap.sh`
  ставит 3.11 сам, при ручной установке добавьте
  `add-apt-repository ppa:deadsnakes/ppa`.
- Сервер: 2 CPU / 2 ГБ RAM хватает на старте. NudeNet держит модель в
  памяти (~150 МБ на воркер), это основной потребитель.

---

## 1. Система и пользователь

```bash
# На 20.04 сначала: add-apt-repository -y ppa:deadsnakes/ppa
apt update && apt install -y \
    python3.11 python3.11-venv python3-pip \
    postgresql redis-server nginx certbot python3-certbot-nginx git

adduser --system --group --home /srv/treffit treffit
mkdir -p /srv/treffit && chown treffit:treffit /srv/treffit
```

Проверка: `systemctl is-active postgresql redis-server nginx` → три `active`.

---

## 2. База данных

```bash
sudo -u postgres psql <<'SQL'
CREATE USER treffit WITH PASSWORD 'ЗАМЕНИТЕ_НА_СЛУЧАЙНЫЙ';
CREATE DATABASE treffit OWNER treffit;
SQL
```

Проверка: `psql "postgresql://treffit:ПАРОЛЬ@localhost/treffit" -c '\conninfo'`

---

## 3. Код и зависимости

```bash
sudo -u treffit git clone https://github.com/Vlauser/Besy.git /srv/treffit/src
sudo -u treffit ln -s /srv/treffit/src/treffit/backend /srv/treffit/backend
sudo -u treffit ln -s /srv/treffit/src/treffit/frontend /srv/treffit/frontend

cd /srv/treffit/backend
sudo -u treffit python3.11 -m venv .venv
sudo -u treffit .venv/bin/pip install -r requirements.txt
```

Проверка: `sudo -u treffit .venv/bin/python -c "import nudenet, redis; print('ok')"`

---

## 4. Конфигурация

```bash
sudo -u treffit cp .env.example .env
sudo -u treffit chmod 600 .env
openssl rand -hex 32     # это значение пойдёт в TREFFIT_SECRET_KEY
```

Минимум, что надо задать в `/srv/treffit/backend/.env`:

```ini
TREFFIT_SECRET_KEY=<вывод openssl rand -hex 32>
TREFFIT_BOT_TOKEN=<токен от BotFather>
TREFFIT_DATABASE_URL=postgresql+asyncpg://treffit:ПАРОЛЬ@localhost:5432/treffit
TREFFIT_REDIS_URL=redis://localhost:6379/0
TREFFIT_MEDIA_ROOT=/srv/treffit/backend/var/media
TREFFIT_MINI_APP_URL=https://ВАШ.ДОМЕН   # адрес сайта, НЕ ссылка t.me
TREFFIT_CORS_ORIGINS=https://treffit.example.com
TREFFIT_ADMIN_TELEGRAM_IDS=<ваш telegram_id>
TREFFIT_ALLOW_DEV_AUTH=false
```

`TREFFIT_SECRET_KEY` служит одновременно ключом подписи сессий **и**
секретом вебхука. Менять его — значит разлогинить всех и потребовать
повторного `setup_bot`.

`TREFFIT_ALLOW_DEV_AUTH=false` обязателен: при `true` кто угодно выпустит
себе сессию на любой `telegram_id`.

Свой `telegram_id` можно узнать у [@userinfobot](https://t.me/userinfobot).

---

## 5. Миграции

```bash
cd /srv/treffit/backend
sudo -u treffit .venv/bin/alembic upgrade head
```

Проверка: `psql ... -c '\dt'` → 15 таблиц, включая `alembic_version`.

Демо-анкеты (**только для тестового стенда**, не на проде):

```bash
sudo -u treffit .venv/bin/python -m scripts.seed
```

---

## 6. Сборка фронтенда

```bash
cd /srv/treffit/frontend
npm ci && npm run build
```

`dist/` раздаётся nginx напрямую. `VITE_API_URL` задавать не нужно: по
умолчанию клиент ходит в `/api`, а nginx проксирует это на бэкенд.

Проверка: `ls dist/index.html dist/assets/`

---

## 7. Сервисы

```bash
cp /srv/treffit/src/treffit/deploy/treffit-*.service /etc/systemd/system/
cp /srv/treffit/src/treffit/deploy/treffit-*.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now treffit-api treffit-sync.timer treffit-backup.timer
```

Проверка:

```bash
systemctl is-active treffit-api        # active
curl -s localhost:8000/health          # {"status":"ok"}
journalctl -u treffit-api -n 20        # в логе строка про Redis pub/sub
systemctl list-timers 'treffit-*'      # два таймера с ближайшим запуском
```

---

## 8. nginx и TLS

Сертификат выпускается в два приёма: полный конфиг ссылается на файлы,
которых до первого выпуска нет, и `nginx -t` на нём не пройдёт.

**8.1 — временный http-конфиг для проверки Let's Encrypt**

```bash
mkdir -p /var/www/certbot
cp /srv/treffit/src/treffit/deploy/nginx-acme.conf /etc/nginx/sites-available/treffit
sed -i 's/treffit.example.com/ВАШ.ДОМЕН/g' /etc/nginx/sites-available/treffit
ln -sf /etc/nginx/sites-available/treffit /etc/nginx/sites-enabled/treffit
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Проверка: `curl -s http://ВАШ.ДОМЕН/` → строка про ожидание сертификата.
Если не отвечает — DNS ещё не разошёлся; сверьте `dig +short ВАШ.ДОМЕН`
с реальным IP сервера, certbot без этого не выпустит сертификат.

**8.2 — выпуск сертификата**

```bash
certbot certonly --webroot -w /var/www/certbot -d ВАШ.ДОМЕН \
    --agree-tos --no-eff-email -m ваша@почта \
    --deploy-hook "systemctl reload nginx"
```

`certonly` вместо `--nginx` намеренно: certbot не редактирует наш конфиг,
и он остаётся единственным источником правды. `--deploy-hook` перечитает
nginx после автопродления.

**8.3 — полный конфиг**

```bash
cp /srv/treffit/src/treffit/deploy/nginx.conf /etc/nginx/sites-available/treffit
sed -i 's/treffit.example.com/ВАШ.ДОМЕН/g' /etc/nginx/sites-available/treffit
sed -i 's#/srv/treffit/frontend#/srv/treffit/src/treffit/frontend#g' \
    /etc/nginx/sites-available/treffit
nginx -t && systemctl reload nginx
```

Проверка:

```bash
curl -s https://ВАШ.ДОМЕН/api/health          # {"status":"ok"}
curl -s https://ВАШ.ДОМЕН/ | head -c 100      # html фронтенда
```

Продление автоматическое таймером certbot; проверить —
`systemctl list-timers certbot`.

---

## 9. Бот

В [@BotFather](https://t.me/BotFather):

1. `/newbot` → имя и username, токен уже в `.env`.
2. `/newapp` → выбрать бота, короткое имя `app`, URL `https://ВАШ.ДОМЕН`.
   Ссылку `https://t.me/ВАШ_БОТ/app` можно раздавать людям, но в
   `TREFFIT_MINI_APP_URL` идёт именно адрес сайта: в `web_app.url`
   Telegram принимает только его.

Затем зарегистрировать вебхук, команды и кнопку меню:

```bash
cd /srv/treffit/backend
sudo -u treffit env $(grep -v '^#' .env | xargs) \
    TREFFIT_PUBLIC_URL=https://ВАШ.ДОМЕН/api \
    .venv/bin/python -m scripts.setup_bot
```

Проверка:

```bash
sudo -u treffit env $(grep -v '^#' .env | xargs) \
    .venv/bin/python -m scripts.setup_bot --status
```

Должно показать username бота, адрес вебхука и `В очереди обновлений: 0`.
Непустая «Последняя ошибка» означает, что Telegram не смог достучаться —
почти всегда это TLS или неверный `TREFFIT_PUBLIC_URL`.

---

## 10. Проверка в Telegram

Этот раздел закрывает то, что нельзя проверить без реального клиента.

1. Напишите боту `/start` — должно прийти приветствие с кнопкой.
2. Откройте Mini App. Экрана Dev Login быть **не должно**: если он виден,
   `initData` не прошёл проверку. Смотрите `journalctl -u treffit-api`,
   типичная причина — токен в `.env` не от того бота.
3. Пройдите онбординг: согласия → анкета → фильтры → фото → тест.
4. Загрузите фото и проверьте, что оно попало в очередь:
   `GET https://ВАШ.ДОМЕН/api/admin/photos` (с вашим токеном) или через
   `/api/docs`.
5. Со второго аккаунта поставьте взаимный лайк — должен появиться попап
   матча у обоих без перезагрузки (это проверяет WebSocket через nginx).
6. Закройте приложение на втором аккаунте и напишите ему — должно прийти
   push-уведомление от бота.
7. Купите Premium за Stars и убедитесь, что галочка появилась. Если оплата
   «зависает» — не отвечает `pre_checkout_query`, смотрите логи вебхука.
8. Проверьте геолокацию: отметьтесь на событии кнопкой «Я на месте».

Если какой-то шаг падает — логи в `journalctl -u treffit-api -f`.

---

## 11. Эксплуатация

**Обновление:**

```bash
cd /srv/treffit/src && sudo -u treffit git pull
cd /srv/treffit/backend && sudo -u treffit .venv/bin/pip install -r requirements.txt
sudo -u treffit .venv/bin/alembic upgrade head
cd /srv/treffit/frontend && npm ci && npm run build
systemctl restart treffit-api
```

**Бэкапы** идут ночью в `/srv/treffit/backups`, хранятся 14 дней.
Проверить восстановление (а не только создание) стоит сразу:

```bash
systemctl start treffit-backup && ls -lh /srv/treffit/backups
createdb -U treffit treffit_restore_test
gunzip -c /srv/treffit/backups/treffit-*.sql.gz | psql -U treffit treffit_restore_test
```

Бэкапы лежат на том же диске, что и БД, — от потери сервера это не
спасает. Настройте копирование в другое место (`rclone`, S3, второй VPS).

**Управление из командной строки** — `scripts/admin.py`, если не хочется
ходить в API:

```bash
cd /srv/treffit/src/treffit/backend
RUN="sudo -u treffit env $(grep -v '^#' .env | grep -v '^$' | xargs -d '\n') .venv/bin/python"
$RUN -m scripts.admin status            # что настроено и что в очередях
$RUN -m scripts.admin photos            # последние фото и вердикт детектора
$RUN -m scripts.admin premium 123456789 # выдать Premium по telegram_id
```

**Модерация** — очереди на `https://ВАШ.ДОМЕН/api/docs`, раздел admin.
Смотреть `photos_pending` в `/api/admin/stats` хотя бы раз в день: пока
фото `pending`, его никто, кроме владельца, не видит.

**Масштабирование** — при росте нагрузки поднимайте `--workers` в
`treffit-api.service`. Redis уже настроен, события между воркерами ходят
через pub/sub.

---

## 12. Чего в этой инструкции нет

- **Мониторинг и алерты.** Нет ни метрик, ни оповещений о падении. Минимум
  на первое время — внешний пинг `/api/health`.
- **Уведомление Роскомнадзора** об обработке персональных данных по 152-ФЗ
  подаётся **до** начала обработки, а не после запуска. Плюс нужен текст
  политики конфиденциальности, на который ссылается экран согласий.
- **Ограничение частоты запросов** на API не реализовано.
