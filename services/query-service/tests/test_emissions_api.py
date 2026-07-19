import pytest

pytestmark = pytest.mark.asyncio


async def test_list_emissions_filters_by_country(client, seeded_import):
    resp = await client.get("/emissions", params={"country": "ESP"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["total"] == 2
    assert all(r["country"] == "ESP" for r in body["data"])


async def test_list_emissions_range_filter(client, seeded_import):
    resp = await client.get("/emissions", params={"country": "ESP", "year__gte": 2020})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["data"]) == 1
    assert body["data"][0]["year"] == 2020


async def test_list_emissions_pagination(client, seeded_import):
    resp = await client.get("/emissions", params={"country": "ESP", "page": 1, "page_size": 1})
    body = resp.json()
    assert len(body["data"]) == 1
    assert body["meta"]["total"] == 2
    assert body["meta"]["total_pages"] == 2


async def test_list_emissions_sorting_desc(client, seeded_import):
    resp = await client.get(
        "/emissions", params={"country": "ESP", "sort_by": "year", "order": "desc"}
    )
    years = [r["year"] for r in resp.json()["data"]]
    assert years == sorted(years, reverse=True)


async def test_list_emissions_rejects_unknown_filter_field(client):
    resp = await client.get("/emissions", params={"not_a_real_field": "x"})
    assert resp.status_code == 400


async def test_list_emissions_rejects_unknown_sort_field(client):
    resp = await client.get("/emissions", params={"sort_by": "importId"})
    assert resp.status_code == 400


async def test_get_emission_by_id(client, seeded_import):
    record_id = seeded_import["records"][0].id
    resp = await client.get(f"/emissions/{record_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == record_id


async def test_get_emission_not_found(client):
    resp = await client.get("/emissions/does-not-exist")
    assert resp.status_code == 404


async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_status_reflects_seeded_data(client, seeded_import):
    resp = await client.get("/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["totalRecords"] >= 3
    assert body["lastImport"] is not None
