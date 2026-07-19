from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import EmissionRecord, Import
from app.db.session import get_db
from app.schemas.status import LastImportOut, StatusOut

router = APIRouter(tags=["status"])


@router.get("/status", response_model=StatusOut)
async def get_status(db: AsyncSession = Depends(get_db)) -> StatusOut:
    # Runs first and rolls back the transaction on failure (e.g. table
    # doesn't exist), so it can't poison the queries that follow it.
    schema_version = await _latest_migration(db)

    total_records = (
        await db.execute(select(func.count()).select_from(EmissionRecord))
    ).scalar_one()

    last_import = (
        await db.execute(select(Import).order_by(Import.startedAt.desc()).limit(1))
    ).scalar_one_or_none()

    return StatusOut(
        totalRecords=total_records,
        lastImport=LastImportOut.model_validate(last_import) if last_import else None,
        schemaVersion=schema_version,
    )


async def _latest_migration(db: AsyncSession) -> str | None:
    try:
        result = await db.execute(
            text(
                "SELECT migration_name FROM _prisma_migrations "
                "WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1"
            )
        )
        row = result.first()
        return row[0] if row else None
    except Exception:
        # A failed statement leaves the session's transaction unusable for
        # any further queries until rolled back (e.g. if this table doesn't
        # exist yet on a brand new database).
        await db.rollback()
        return None
