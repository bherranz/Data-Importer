import { EmissionsCsvParserService, EmissionDataPoint } from './emissions-csv-parser.service';

describe('EmissionsCsvParserService', () => {
  let parser: EmissionsCsvParserService;

  beforeEach(() => {
    parser = new EmissionsCsvParserService();
  });

  async function run(csv: string, batchSize = 1000) {
    const batches: EmissionDataPoint[][] = [];
    const summary = await parser.parse(Buffer.from(csv), {
      batchSize,
      onBatch: async (batch) => {
        batches.push(batch);
      },
    });
    const points = batches.flat();
    return { summary, points, batches };
  }

  it('pivots a wide row into one data point per year with a value', async () => {
    const csv = ['Country,Sector,Parent sector,2019,2020', 'ABW,Energy,,1.5,2.5'].join('\n');

    const { summary, points } = await run(csv);

    expect(summary.totalRows).toBe(1);
    expect(summary.validRows).toBe(1);
    expect(summary.invalidRows).toBe(0);
    expect(points).toEqual([
      { country: 'ABW', sector: 'Energy', parentSector: null, year: 2019, value: 1.5 },
      { country: 'ABW', sector: 'Energy', parentSector: null, year: 2020, value: 2.5 },
    ]);
  });

  it('treats an empty year cell as a legitimate gap, not an error', async () => {
    const csv = ['Country,Sector,Parent sector,2019,2020', 'ABW,Energy,,,2.5'].join('\n');

    const { summary, points } = await run(csv);

    expect(summary.validRows).toBe(1);
    expect(summary.invalidRows).toBe(0);
    expect(points).toEqual([
      { country: 'ABW', sector: 'Energy', parentSector: null, year: 2020, value: 2.5 },
    ]);
  });

  it('skips a byte-identical repeated row and counts it as a duplicate', async () => {
    const csv = [
      'Country,Sector,Parent sector,2019,2020',
      'ABW,Energy,,1.5,2.5',
      'ABW,Energy,,1.5,2.5',
    ].join('\n');

    const { summary, points } = await run(csv);

    expect(summary.totalRows).toBe(2);
    expect(summary.validRows).toBe(1);
    expect(summary.duplicateRows).toBe(1);
    expect(points).toHaveLength(2);
  });

  it('flags a repeated key with conflicting values instead of silently overwriting', async () => {
    const csv = [
      'Country,Sector,Parent sector,2019,2020',
      'ABW,Energy,,1.5,2.5',
      'ABW,Energy,,9.9,2.5',
    ].join('\n');

    const { summary, points } = await run(csv);

    expect(summary.validRows).toBe(1);
    expect(summary.duplicateRows).toBe(0);
    expect(summary.invalidRows).toBe(1);
    expect(summary.errorSamples[0].reason).toMatch(/conflicting values/i);
    // Only the first occurrence's values were ingested.
    expect(points).toEqual([
      { country: 'ABW', sector: 'Energy', parentSector: null, year: 2019, value: 1.5 },
      { country: 'ABW', sector: 'Energy', parentSector: null, year: 2020, value: 2.5 },
    ]);
  });

  it('rejects rows missing a required country or sector', async () => {
    const csv = ['Country,Sector,Parent sector,2019', ',Energy,,1.5'].join('\n');

    const { summary, points } = await run(csv);

    expect(summary.invalidRows).toBe(1);
    expect(summary.validRows).toBe(0);
    expect(points).toHaveLength(0);
  });

  it('skips non-numeric year cells without failing the whole row', async () => {
    const csv = ['Country,Sector,Parent sector,2019,2020', 'ABW,Energy,,N/A,2.5'].join('\n');

    const { summary, points } = await run(csv);

    expect(summary.skippedCells).toBe(1);
    expect(summary.validRows).toBe(1);
    expect(points).toEqual([
      { country: 'ABW', sector: 'Energy', parentSector: null, year: 2020, value: 2.5 },
    ]);
  });

  it('throws when a required fixed column is missing from the header', async () => {
    const csv = ['Country,Sector,2019', 'ABW,Energy,1.5'].join('\n');

    await expect(run(csv)).rejects.toThrow(/missing required column/i);
  });

  it('throws when a header column is neither a fixed column nor a 4-digit year', async () => {
    const csv = ['Country,Sector,Parent sector,Notes', 'ABW,Energy,,hello'].join('\n');

    await expect(run(csv)).rejects.toThrow(/unexpected column/i);
  });

  it('flushes in batches according to batchSize', async () => {
    const csv = ['Country,Sector,Parent sector,2019,2020,2021', 'ABW,Energy,,1,2,3'].join('\n');

    const { batches, points } = await run(csv, 2);

    expect(points).toHaveLength(3);
    expect(batches.map((b) => b.length)).toEqual([2, 1]);
  });
});
