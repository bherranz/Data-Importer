import pytest

from app.core.config import get_settings

pytestmark = pytest.mark.asyncio


async def test_rate_limiter_returns_429_after_threshold(client):
    limit = int(get_settings().rate_limit.split("/")[0])

    statuses = []
    for _ in range(limit + 5):
        resp = await client.get("/emissions", params={"page_size": 1})
        statuses.append(resp.status_code)

    assert 429 in statuses
