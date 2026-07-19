"""Parses `?field=value` / `?field__op=value` query params into validated
Filter objects, checked against a whitelist of real columns. Kept free of
any DB/FastAPI-request dependency so it's unit-testable on its own.
"""

from dataclasses import dataclass
from typing import Any

from starlette.datastructures import QueryParams

# Every filterable/sortable field, and the Python type its raw query-string
# value should be coerced to.
FIELD_TYPES: dict[str, type] = {
    "country": str,
    "sector": str,
    "parentSector": str,
    "year": int,
    "value": float,
}

SORTABLE_FIELDS = {*FIELD_TYPES.keys(), "id", "createdAt"}

OPERATORS = {"eq", "ne", "gt", "gte", "lt", "lte"}

RESERVED_PARAMS = {"page", "page_size", "sort_by", "order"}


class InvalidFilterError(ValueError):
    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)


@dataclass(frozen=True)
class Filter:
    field: str
    op: str
    value: Any


def parse_filters(query_params: QueryParams) -> list[Filter]:
    filters: list[Filter] = []

    for key, raw_value in query_params.multi_items():
        if key in RESERVED_PARAMS:
            continue

        field, _, suffix = key.partition("__")
        op = suffix or "eq"

        if op not in OPERATORS:
            raise InvalidFilterError(f'Unknown filter operator "{op}" in "{key}"')

        field_type = FIELD_TYPES.get(field)
        if field_type is None:
            raise InvalidFilterError(f'Cannot filter on unknown field "{field}"')

        try:
            value = field_type(raw_value)
        except (TypeError, ValueError) as exc:
            raise InvalidFilterError(
                f'Invalid value "{raw_value}" for field "{field}" (expected {field_type.__name__})'
            ) from exc

        filters.append(Filter(field=field, op=op, value=value))

    return filters


def validate_sort_field(field: str) -> str:
    if field not in SORTABLE_FIELDS:
        raise InvalidFilterError(f'Cannot sort by unknown field "{field}"')
    return field
