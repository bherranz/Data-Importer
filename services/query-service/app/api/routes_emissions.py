from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.limiter import limiter
from app.db.models import EmissionRecord
from app.db.session import get_db
from app.repositories import emissions_repository
from app.repositories.filters import InvalidFilterError, parse_filters, validate_sort_field
from app.schemas.emission import EmissionRecordOut, PaginatedEmissions, PaginationMeta

router = APIRouter(tags=["emissions"])
settings = get_settings()


@router.get("/emissions", response_model=PaginatedEmissions)
@limiter.limit(settings.rate_limit)
async def list_emissions(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(settings.default_page_size, ge=1, le=settings.max_page_size),
    sort_by: str = Query("year"),
    order: str = Query("asc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
) -> PaginatedEmissions:
    """Filter by any column via `?field=value`, or `?field__op=value` with
    op in eq/ne/gt/gte/lt/lte (e.g. `?year__gte=2000&country=ESP`)."""
    try:
        filters = parse_filters(request.query_params)
        sort_by = validate_sort_field(sort_by)
    except InvalidFilterError as exc:
        raise HTTPException(status_code=400, detail=exc.detail) from exc

    rows, total = await emissions_repository.list_emissions(
        db, filters, sort_by, order, page, page_size
    )

    total_pages = (total + page_size - 1) // page_size if total else 0
    return PaginatedEmissions(
        data=[EmissionRecordOut.model_validate(r) for r in rows],
        meta=PaginationMeta(total=total, page=page, page_size=page_size, total_pages=total_pages),
    )


@router.get("/emissions/{record_id}", response_model=EmissionRecordOut)
async def get_emission(record_id: str, db: AsyncSession = Depends(get_db)) -> EmissionRecordOut:
    record = await db.get(EmissionRecord, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f'Emission record "{record_id}" not found')
    return EmissionRecordOut.model_validate(record)
