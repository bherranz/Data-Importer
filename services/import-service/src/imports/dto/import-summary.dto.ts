import { ApiProperty } from '@nestjs/swagger';
import { ImportStatus } from '@prisma/client';

export class ImportAggregatesDto {
  @ApiProperty({ description: 'Number of emission data points created by this import' })
  recordCount!: number;

  @ApiProperty({ description: 'Distinct countries/regions represented' })
  countries!: number;

  @ApiProperty({ description: 'Distinct sectors represented' })
  sectors!: number;

  @ApiProperty({ type: Object, example: { min: 1850, max: 2014 } })
  year!: { min: number | null; max: number | null };

  @ApiProperty({ type: Object, example: { min: -1.2, max: 12000.5, avg: 45.3 } })
  value!: { min: number | null; max: number | null; avg: number | null };
}

export class ImportErrorSummaryDto {
  @ApiProperty()
  row!: number;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  reason!: string;
}

export class ImportSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  filename!: string;

  @ApiProperty({ enum: ImportStatus })
  status!: ImportStatus;

  @ApiProperty()
  totalRows!: number;

  @ApiProperty()
  validRows!: number;

  @ApiProperty({ description: 'Rows skipped because they exactly repeated an earlier row' })
  duplicateRows!: number;

  @ApiProperty({ description: 'Rows skipped due to validation errors or conflicting duplicates' })
  invalidRows!: number;

  @ApiProperty({ type: [ImportErrorSummaryDto], required: false })
  errorSummary?: ImportErrorSummaryDto[];

  @ApiProperty({ type: ImportAggregatesDto, required: false })
  aggregates?: ImportAggregatesDto;

  @ApiProperty()
  startedAt!: Date;

  @ApiProperty({ required: false, nullable: true })
  finishedAt!: Date | null;

  @ApiProperty({
    required: false,
    description: 'Set when this upload matched a previous import byte-for-byte',
  })
  duplicateOfExistingImport?: boolean;
}
