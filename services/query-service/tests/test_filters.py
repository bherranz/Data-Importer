import pytest
from starlette.datastructures import QueryParams

from app.repositories.filters import InvalidFilterError, parse_filters, validate_sort_field


def test_parses_simple_equality_filters():
    filters = parse_filters(QueryParams("country=ESP&sector=Energy"))
    assert {(f.field, f.op, f.value) for f in filters} == {
        ("country", "eq", "ESP"),
        ("sector", "eq", "Energy"),
    }


def test_parses_range_operators():
    filters = parse_filters(QueryParams("year__gte=2000&year__lte=2010"))
    assert {(f.field, f.op, f.value) for f in filters} == {
        ("year", "gte", 2000),
        ("year", "lte", 2010),
    }


def test_ignores_reserved_pagination_and_sort_params():
    filters = parse_filters(QueryParams("page=2&page_size=10&sort_by=year&order=desc&country=ESP"))
    assert [(f.field, f.op, f.value) for f in filters] == [("country", "eq", "ESP")]


def test_coerces_numeric_types():
    filters = parse_filters(QueryParams("year=2020&value=12.5"))
    values = {f.field: f.value for f in filters}
    assert values["year"] == 2020 and isinstance(values["year"], int)
    assert values["value"] == 12.5 and isinstance(values["value"], float)


def test_rejects_unknown_field():
    with pytest.raises(InvalidFilterError, match="unknown field"):
        parse_filters(QueryParams("totally_made_up=1"))


def test_rejects_unknown_operator():
    with pytest.raises(InvalidFilterError, match="operator"):
        parse_filters(QueryParams("year__wat=2020"))


def test_rejects_invalid_value_for_field_type():
    with pytest.raises(InvalidFilterError, match="Invalid value"):
        parse_filters(QueryParams("year=not-a-number"))


def test_validate_sort_field_accepts_whitelisted_field():
    assert validate_sort_field("year") == "year"


def test_validate_sort_field_rejects_non_whitelisted_field():
    with pytest.raises(InvalidFilterError):
        validate_sort_field("importId")
