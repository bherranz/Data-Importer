from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://importer:importer@localhost:5432/emissions?schema=public"
    port: int = 8000
    log_level: str = "info"
    rate_limit: str = "60/minute"
    default_page_size: int = 50
    max_page_size: int = 500

    @property
    def async_database_url(self) -> str:
        """Prisma writes a plain `postgresql://` URL; SQLAlchemy's async engine
        needs the asyncpg driver spelled out, and doesn't understand the
        Prisma-only `schema=` query param."""
        url = self.database_url
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if "?" in url:
            url = url.split("?", 1)[0]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
