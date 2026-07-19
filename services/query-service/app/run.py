"""Entrypoint used by Docker/local dev (`python -m app.run`) so uvicorn's own
loggers get our JSON formatter too, not just application code -- passing
log_config here is the only reliable way to do that, since uvicorn applies
its own default logging config after the app module is imported.
"""

import uvicorn

from app.core.config import get_settings
from app.core.logging_config import build_log_config

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.port,
        log_config=build_log_config(),
    )
