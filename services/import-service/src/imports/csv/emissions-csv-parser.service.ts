import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse';
import { Readable } from 'stream';

const FIXED_COLUMNS = ['Country', 'Sector', 'Parent sector'] as const;
const YEAR_COLUMN_PATTERN = /^\d{4}$/;
const MAX_ERROR_SAMPLES = 50;

export interface EmissionDataPoint {
  country: string;
  sector: string;
  parentSector: string | null;
  year: number;
  value: number;
}

export interface ParsedRowError {
  row: number;
  key: string;
  reason: string;
}

export interface CsvParseSummary {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  skippedCells: number;
  errorSamples: ParsedRowError[];
}

/**
 * The source dataset is "wide": one column per year (e.g. Climate Watch /
 * CAIT bulk exports). This parser pivots it into long-format data points
 * (one per country/sector/year) and streams them to `onBatch` as it reads,
 * so memory stays bounded to ~batchSize records regardless of file size.
 */
@Injectable()
export class EmissionsCsvParserService {
  async parse(
    buffer: Buffer,
    options: {
      batchSize: number;
      onBatch: (batch: EmissionDataPoint[]) => Promise<void>;
    },
  ): Promise<CsvParseSummary> {
    const parser = parse({ columns: true, skip_empty_lines: true, trim: true });
    Readable.from(buffer).pipe(parser);

    let yearColumns: string[] | null = null;
    let rowNumber = 0;
    let validRows = 0;
    let duplicateRows = 0;
    let invalidRows = 0;
    let skippedCells = 0;
    const errorSamples: ParsedRowError[] = [];
    // Tracks (country, sector, parentSector) -> raw year-value signature,
    // so exact repeats of a row are skipped and conflicting repeats are
    // flagged instead of silently overwriting each other.
    const seenRows = new Map<string, string>();

    let batch: EmissionDataPoint[] = [];

    const recordError = (row: number, key: string, reason: string) => {
      invalidRows++;
      if (errorSamples.length < MAX_ERROR_SAMPLES) {
        errorSamples.push({ row, key, reason });
      }
    };

    for await (const record of parser as AsyncIterable<Record<string, string>>) {
      rowNumber++;

      if (!yearColumns) {
        const headers = Object.keys(record);
        for (const fixed of FIXED_COLUMNS) {
          if (!headers.includes(fixed)) {
            throw new Error(`CSV is missing required column "${fixed}"`);
          }
        }
        yearColumns = headers.filter((h) => !(FIXED_COLUMNS as readonly string[]).includes(h));
        const invalidHeader = yearColumns.find((h) => !YEAR_COLUMN_PATTERN.test(h));
        if (invalidHeader) {
          throw new Error(
            `Unexpected column "${invalidHeader}" in CSV header; expected a 4-digit year`,
          );
        }
      }

      const country = (record['Country'] ?? '').trim();
      const sector = (record['Sector'] ?? '').trim();
      const parentSector = (record['Parent sector'] ?? '').trim() || null;

      if (!country || !sector) {
        recordError(rowNumber, `${country || '?'}|${sector || '?'}`, 'Missing country or sector');
        continue;
      }

      const key = `${country}|${sector}|${parentSector ?? ''}`;
      const signature = yearColumns.map((yc) => record[yc] ?? '').join(',');
      const existingSignature = seenRows.get(key);

      if (existingSignature !== undefined) {
        if (existingSignature === signature) {
          duplicateRows++;
        } else {
          recordError(
            rowNumber,
            key,
            'Duplicate row with conflicting values; kept first occurrence',
          );
        }
        continue;
      }
      seenRows.set(key, signature);

      let rowHadValue = false;
      for (const yearColumn of yearColumns) {
        const raw = record[yearColumn];
        if (raw === undefined || raw === '') continue;

        const value = Number(raw);
        if (!Number.isFinite(value)) {
          skippedCells++;
          continue;
        }

        batch.push({ country, sector, parentSector, year: Number(yearColumn), value });
        rowHadValue = true;

        if (batch.length >= options.batchSize) {
          await options.onBatch(batch);
          batch = [];
        }
      }

      if (rowHadValue) {
        validRows++;
      } else {
        recordError(rowNumber, key, 'No valid numeric values found for any year');
      }
    }

    if (batch.length > 0) {
      await options.onBatch(batch);
    }

    return {
      totalRows: rowNumber,
      validRows,
      duplicateRows,
      invalidRows,
      skippedCells,
      errorSamples,
    };
  }
}
