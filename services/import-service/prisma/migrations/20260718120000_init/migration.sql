-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "imports" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PROCESSING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" JSONB,
    "aggregates" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emission_records" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "parentSector" TEXT,
    "year" INTEGER NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importId" TEXT NOT NULL,

    CONSTRAINT "emission_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "imports_checksum_key" ON "imports"("checksum");

-- CreateIndex
CREATE INDEX "emission_records_country_idx" ON "emission_records"("country");

-- CreateIndex
CREATE INDEX "emission_records_sector_idx" ON "emission_records"("sector");

-- CreateIndex
CREATE INDEX "emission_records_year_idx" ON "emission_records"("year");

-- CreateIndex
CREATE INDEX "emission_records_country_year_idx" ON "emission_records"("country", "year");

-- CreateIndex
CREATE UNIQUE INDEX "emission_records_importId_country_sector_year_key" ON "emission_records"("importId", "country", "sector", "year");

-- AddForeignKey
ALTER TABLE "emission_records" ADD CONSTRAINT "emission_records_importId_fkey" FOREIGN KEY ("importId") REFERENCES "imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
