from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="TREFFIT_", extra="ignore")

    # --- core ---
    app_name: str = "Treffit API"
    debug: bool = False
    secret_key: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_ttl_hours: int = 24 * 30

    # --- database ---
    database_url: str = "postgresql+asyncpg://treffit:treffit@localhost:5432/treffit"

    # --- telegram ---
    bot_token: str = ""
    # initData older than this is rejected even if the hash is valid, so a
    # leaked payload cannot be replayed forever.
    init_data_max_age_seconds: int = 24 * 3600
    # Dev login without Telegram. MUST stay false in production — it lets
    # anyone mint a session for an arbitrary telegram_id.
    allow_dev_auth: bool = False

    # --- product rules ---
    # Blind mode is the Treffit core: photos stay hidden until the chat
    # crosses the reveal threshold. Set false for classic Twinby behaviour
    # where photos are visible in the deck straight away.
    blind_mode: bool = True
    reveal_threshold: int = 3
    min_age: int = 18
    max_photos: int = 6
    daily_like_limit: int = 50
    daily_like_limit_premium: int = 500
    deck_page_size: int = 20

    # --- moderation ---
    # Photos run through NudeNet locally; only borderline ones reach a human.
    moderation_enabled: bool = True
    moderation_reject_score: float = 0.5
    moderation_review_score: float = 0.35
    # A dating photo with no detectable face is not auto-approved.
    moderation_require_face: bool = True
    admin_telegram_ids: str = ""

    # --- realtime ---
    # Empty = in-process hub (single worker). Set a redis:// URL to fan out
    # across workers and hosts.
    redis_url: str = ""
    realtime_channel: str = "treffit:events"

    # --- push notifications ---
    push_enabled: bool = True
    # Do not ping someone about every line of a fast conversation.
    push_cooldown_seconds: int = 180
    # HTTPS-адрес, по которому раздаётся сам Mini App (https://treffit.ru).
    # Именно его ждёт Telegram в web_app.url — ссылка вида t.me/бот/app
    # предназначена для шаринга и отклоняется с BUTTON_URL_INVALID.
    mini_app_url: str = ""

    # --- events sync ---
    # Города, по которым тянем афишу. Пусто — значит все поддерживаемые:
    # человек из Москвы должен видеть Москву, и для этого её надо забрать.
    kudago_locations: str = ""
    # Сотня за раз — уже слишком для крупных городов: источник отдаёт 502.
    # При отказе синхронизация всё равно уменьшит страницу сама.
    kudago_page_size: int = 50

    @property
    def kudago_location_list(self) -> list[str]:
        from .cities import SLUGS

        chosen = [item.strip() for item in self.kudago_locations.split(",") if item.strip()]
        return chosen or list(SLUGS)

    # --- media ---
    media_root: Path = Path("var/media")
    max_photo_bytes: int = 8 * 1024 * 1024

    # --- live mode ---
    live_radius_meters: int = 700
    live_window_hours: int = 2

    cors_origins: str = "*"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def admin_ids(self) -> set[int]:
        ids = set()
        for chunk in self.admin_telegram_ids.replace(";", ",").split(","):
            chunk = chunk.strip()
            if chunk.isdigit():
                ids.add(int(chunk))
        return ids


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
