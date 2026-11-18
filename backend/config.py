"""Settings from environment variables (and an optional .env file). Secrets never live in code."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT / "frontend"
SCENARIOS_PATH = FRONTEND_DIR / "data" / "scenarios.json"
STUDY_ITEMS_PATH = FRONTEND_DIR / "data" / "study_items.json"


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """Minimal .env loader. Real environment variables always win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _bool(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    llm_enabled: bool = False
    llm_provider: str = ""
    llm_api_key: str = field(default="", repr=False)
    llm_model: str = ""
    database_path: str = "./study.db"
    rate_limit_per_minute: int = 30

    @property
    def llm_active(self) -> bool:
        return self.llm_enabled and bool(self.llm_provider) and bool(self.llm_api_key)


def get_settings() -> Settings:
    load_dotenv()
    return Settings(
        llm_enabled=_bool(os.environ.get("LLM_ENABLED")),
        llm_provider=os.environ.get("LLM_PROVIDER", "").strip().lower(),
        llm_api_key=os.environ.get("LLM_API_KEY", "").strip(),
        llm_model=os.environ.get("LLM_MODEL", "").strip(),
        database_path=os.environ.get("DATABASE_PATH", "./study.db").strip() or "./study.db",
    )
