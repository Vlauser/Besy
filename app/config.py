from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Claude API ---
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-5"
    # Контроль качества и OCR маркировки через Claude. Выключите, чтобы не тратить токены.
    enable_claude: bool = True
    # Уровень усилий модели: low хватает для OCR + проверки выреза.
    claude_effort: str = "low"

    # --- Доступ ---
    # Если задан, сайт спрашивает пароль. Ключ Claude лежит на сервере,
    # поэтому без пароля любой, кто знает адрес, тратит ваши токены.
    app_password: str = ""

    # --- Формат результата (по референсу SBHA12-20) ---
    canvas_width: int = 812
    canvas_height: int = 677
    # Доля высоты холста, которую занимает деталь (референс: ~0.69)
    fill_height: float = 0.69
    # Предохранитель для широких деталей: максимум доли ширины холста
    fill_width_max: float = 0.88
    jpeg_quality: int = 92
    background: str = "#FFFFFF"

    # --- Сегментация ---
    rembg_model: str = "isnet-general-use"
    # Порог альфы, ниже которого пиксель считается фоном
    alpha_threshold: int = 12
    # Компоненты мельче этой доли от самого крупного отбрасываются (пыль, блики)
    min_component_ratio: float = 0.02

    # --- Очередь ---
    max_upload_mb: int = 40
    max_files_per_job: int = 300
    workers: int = 2

    data_dir: Path = Path("data")


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
