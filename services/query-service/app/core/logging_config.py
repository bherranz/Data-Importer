import json
import logging

from app.core.config import get_settings


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "level": record.levelname,
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def build_log_config() -> dict:
    level = get_settings().log_level.upper()
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "json": {"()": JsonFormatter},
        },
        "handlers": {
            "default": {
                "class": "logging.StreamHandler",
                "formatter": "json",
            },
        },
        "root": {"handlers": ["default"], "level": level},
        "loggers": {
            "uvicorn": {"handlers": ["default"], "level": level, "propagate": False},
            "uvicorn.error": {"handlers": ["default"], "level": level, "propagate": False},
            "uvicorn.access": {"handlers": ["default"], "level": level, "propagate": False},
        },
    }
