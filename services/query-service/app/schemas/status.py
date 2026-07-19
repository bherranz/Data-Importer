from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LastImportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    status: str
    startedAt: datetime
    finishedAt: datetime | None


class StatusOut(BaseModel):
    totalRecords: int
    lastImport: LastImportOut | None
    schemaVersion: str | None
