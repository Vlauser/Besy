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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
