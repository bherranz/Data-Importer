import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { ImportStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmissionsCsvParserService } from './csv/emissions-csv-parser.service';
import { ImportSummaryDto } from './dto/import-summary.dto';
import { IMPORT_BATCH_SIZE } from './imports.constants';

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly csvParser: EmissionsCsvParserService,
    @Inject(IMPORT_BATCH_SIZE) private readonly batchSize: number,
  ) {}

  async importFile(file: Express.Multer.File): Promise<ImportSummaryDto> {
    if (!file || file.size === 0) {
      throw new BadRequestException('Uploaded file is empty or missing');
    }
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Only .csv files are accepted');
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.import.findUnique({ where: { checksum } });

    if (existing) {
      if (existing.status === ImportStatus.COMPLETED) {
        return { ...this.toSummary(existing), duplicateOfExistingImport: true };
      }
      if (existing.status === ImportStatus.PROCESSING) {
        throw new ConflictException(
          `This exact file is already being imported (import ${existing.id})`,
        );
      }
      // Previous attempt FAILED: clear it out and retry fresh.
      await this.prisma.import.delete({ where: { id: existing.id } });
    }

    const importRecord = await this.prisma.import.create({
      data: { filename: file.originalname, checksum, status: ImportStatus.PROCESSING },
    });

    try {
      const summary = await this.csvParser.parse(file.buffer, {
        batchSize: this.batchSize,
        onBatch: async (points) => {
          await this.prisma.emissionRecord.createMany({
            data: points.map((p) => ({ ...p, importId: importRecord.id })),
            skipDuplicates: true,
          });
        },
      });

      const aggregates = await this.computeAggregates(importRecord.id);

      const completed = await this.prisma.import.update({
        where: { id: importRecord.id },
        data: {
          status: ImportStatus.COMPLETED,
          totalRows: summary.totalRows,
          validRows: summary.validRows,
          duplicateRows: summary.duplicateRows,
          invalidRows: summary.invalidRows,
          errorSummary: summary.errorSamples as unknown as Prisma.InputJsonValue,
          aggregates: aggregates as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });

      return this.toSummary(completed);
    } catch (error) {
      this.logger.error(`Import ${importRecord.id} failed: ${(error as Error).message}`);
      await this.prisma.import.update({
        where: { id: importRecord.id },
        data: {
          status: ImportStatus.FAILED,
          errorSummary: [
            { row: 0, key: '', reason: (error as Error).message },
          ] as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      throw new BadRequestException({
        message: `CSV import failed: ${(error as Error).message}`,
        importId: importRecord.id,
      });
    }
  }

  async findOne(id: string): Promise<ImportSummaryDto> {
    const found = await this.prisma.import.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundException(`Import "${id}" not found`);
    }
    return this.toSummary(found);
  }

  private async computeAggregates(importId: string) {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        record_count: bigint;
        countries: bigint;
        sectors: bigint;
        min_year: number | null;
        max_year: number | null;
        min_value: number | null;
        max_value: number | null;
        avg_value: number | null;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*) AS record_count,
        COUNT(DISTINCT country) AS countries,
        COUNT(DISTINCT sector) AS sectors,
        MIN(year) AS min_year,
        MAX(year) AS max_year,
        MIN(value) AS min_value,
        MAX(value) AS max_value,
        AVG(value) AS avg_value
      FROM emission_records
      WHERE "importId" = ${importId}
    `);

    return {
      recordCount: Number(row?.record_count ?? 0),
      countries: Number(row?.countries ?? 0),
      sectors: Number(row?.sectors ?? 0),
      year: { min: row?.min_year ?? null, max: row?.max_year ?? null },
      value: {
        min: row?.min_value ?? null,
        max: row?.max_value ?? null,
        avg: row?.avg_value ?? null,
      },
    };
  }

  private toSummary(record: {
    id: string;
    filename: string;
    status: ImportStatus;
    totalRows: number;
    validRows: number;
    duplicateRows: number;
    invalidRows: number;
    errorSummary: Prisma.JsonValue;
    aggregates: Prisma.JsonValue;
    startedAt: Date;
    finishedAt: Date | null;
  }): ImportSummaryDto {
    return {
      id: record.id,
      filename: record.filename,
      status: record.status,
      totalRows: record.totalRows,
      validRows: record.validRows,
      duplicateRows: record.duplicateRows,
      invalidRows: record.invalidRows,
      errorSummary: record.errorSummary as unknown as ImportSummaryDto['errorSummary'],
      aggregates: record.aggregates as unknown as ImportSummaryDto['aggregates'],
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
    };
  }
}
