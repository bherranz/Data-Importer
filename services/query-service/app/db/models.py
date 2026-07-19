"""Read-only mirror of the schema owned by import-service's Prisma migrations
(services/import-service/prisma/schema.prisma). This service never migrates
the database -- see docs/architecture.md for why a single writer owns the
schema and how the two definitions are kept in sync.
"""

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Prisma created this as a real Postgres enum type (see the ImportStatus
# enum in schema.prisma); create_type=False because this service never
# creates or alters schema, only import-service's migrations do.
import_status_enum = PGEnum(
    "PROCESSING", "COMPLETED", "FAILED", name="ImportStatus", create_type=False
)


class Base(DeclarativeBase):
    pass


class Import(Base):
    __tablename__ = "imports"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    filename: Mapped[str] = mapped_column(String)
    checksum: Mapped[str] = mapped_column(String, unique=True)
    status: Mapped[str] = mapped_column(import_status_enum)
    totalRows: Mapped[int] = mapped_column(Integer, default=0)
    validRows: Mapped[int] = mapped_column(Integer, default=0)
    duplicateRows: Mapped[int] = mapped_column(Integer, default=0)
    invalidRows: Mapped[int] = mapped_column(Integer, default=0)
    errorSummary: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    aggregates: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    startedAt: Mapped[object] = mapped_column(DateTime)
    finishedAt: Mapped[object | None] = mapped_column(DateTime, nullable=True)

    records: Mapped[list["EmissionRecord"]] = relationship(back_populates="import_")


class EmissionRecord(Base):
    __tablename__ = "emission_records"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    country: Mapped[str] = mapped_column(String)
    sector: Mapped[str] = mapped_column(String)
    parentSector: Mapped[str | None] = mapped_column(String, nullable=True)
    year: Mapped[int] = mapped_column(Integer)
    value: Mapped[float] = mapped_column(Float)
    createdAt: Mapped[object] = mapped_column(DateTime)
    importId: Mapped[str] = mapped_column(String, ForeignKey("imports.id"))

    import_: Mapped["Import"] = relationship(back_populates="records")
