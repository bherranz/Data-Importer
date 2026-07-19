from pydantic import BaseModel, ConfigDict


class EmissionRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    country: str
    sector: str
    parentSector: str | None
    year: int
    value: float
    importId: str


class PaginationMeta(BaseModel):
    total: int
    page: int
    page_size: int
    total_pages: int


class PaginatedEmissions(BaseModel):
    data: list[EmissionRecordOut]
    meta: PaginationMeta
