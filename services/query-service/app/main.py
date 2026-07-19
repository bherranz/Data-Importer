from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api import routes_emissions, routes_health, routes_status
from app.core.limiter import limiter

app = FastAPI(
    title="Query Service",
    description="Read-optimized REST API over the imported emissions dataset.",
    version="1.0.0",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.include_router(routes_health.router)
app.include_router(routes_status.router)
app.include_router(routes_emissions.router)
