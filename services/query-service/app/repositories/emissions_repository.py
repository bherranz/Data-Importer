from sqlalchemy import Select, asc, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import EmissionRecord
from app.repositories.filters import Filter

_OPERATOR_FUNCS = {
    "eq": lambda col, v: col == v,
    "ne": lambda col, v: col != v,
    "gt": lambda col, v: col > v,
    "gte": lambda col, v: col >= v,
    "lt": lambda col, v: col < v,
    "lte": lambda col, v: col <= v,
}


def _apply_filters(stmt: Select, filters: list[Filter]) -> Select:
    for f in filters:
        column = getattr(EmissionRecord, f.field)
        stmt = stmt.where(_OPERATOR_FUNCS[f.op](column, f.value))
    return stmt


async def list_emissions(
    db: AsyncSession,
    filters: list[Filter],
    sort_by: str,
    order: str,
    page: int,
    page_size: int,
) -> tuple[list[EmissionRecord], int]:
    count_stmt = _apply_filters(select(func.count()).select_from(EmissionRecord), filters)
    total = (await db.execute(count_stmt)).scalar_one()

    sort_column = getattr(EmissionRecord, sort_by)
    order_fn = desc if order == "desc" else asc
    data_stmt = (
        _apply_filters(select(EmissionRecord), filters)
        .order_by(order_fn(sort_column), EmissionRecord.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await db.execute(data_stmt)).scalars().all()

    return list(rows), total
