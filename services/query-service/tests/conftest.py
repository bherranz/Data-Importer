import os
import uuid
from datetime import UTC, datetime

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://importer:importer@localhost:5432/emissions_test?schema=public",
)

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings  # noqa: E402
from app.db.models import EmissionRecord, Import  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402

settings = get_settings()


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine(settings.async_database_url)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def seeded_import(db_session: AsyncSession):
    import_id = str(uuid.uuid4())
    # Prisma stores TIMESTAMP WITHOUT TIME ZONE; asyncpg rejects tz-aware
    # values for that column type, so store naive UTC to match.
    now = datetime.now(UTC).replace(tzinfo=None)

    imp = Import(
        id=import_id,
        filename="fixture.csv",
        checksum=f"checksum-{import_id}",
        status="COMPLETED",
        totalRows=3,
        validRows=3,
        duplicateRows=0,
        invalidRows=0,
        startedAt=now,
        finishedAt=now,
    )
    records = [
        EmissionRecord(
            id=str(uuid.uuid4()),
            country="ESP",
            sector="Energy",
            parentSector=None,
            year=2019,
            value=10.5,
            createdAt=now,
            importId=import_id,
        ),
        EmissionRecord(
            id=str(uuid.uuid4()),
            country="ESP",
            sector="Energy",
            parentSector=None,
            year=2020,
            value=12.0,
            createdAt=now,
            importId=import_id,
        ),
        EmissionRecord(
            id=str(uuid.uuid4()),
            country="FRA",
            sector="Waste",
            parentSector=None,
            year=2020,
            value=3.2,
            createdAt=now,
            importId=import_id,
        ),
    ]

    db_session.add(imp)
    db_session.add_all(records)
    await db_session.commit()

    yield {"import": imp, "records": records}

    await db_session.execute(
        EmissionRecord.__table__.delete().where(EmissionRecord.importId == import_id)
    )
    await db_session.execute(Import.__table__.delete().where(Import.id == import_id))
    await db_session.commit()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession):
    # The app's module-level engine is created once at import time, outside
    # any event loop; pytest-asyncio gives each test its own loop, which
    # breaks asyncpg's pooled connections on Windows. Route requests through
    # this test's own session (already bound to the running loop) instead.
    async def _get_db_override():
        yield db_session

    app.dependency_overrides[get_db] = _get_db_override
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_db, None)
