import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const FIXTURE_CSV = [
  'Country,Sector,Parent sector,2019,2020',
  'ABW,Energy,,1.5,2.5',
  'ABW,Energy,,1.5,2.5',
  'AFG,Energy,,3,4',
  'AFG,Energy,,9,4',
  ',,,1,',
].join('\n');

describe('Imports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.emissionRecord.deleteMany();
    await prisma.import.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a non-csv upload', async () => {
    await request(app.getHttpServer())
      .post('/imports')
      .attach('file', Buffer.from('hello'), 'notes.txt')
      .expect(400);
  });

  it('rejects an empty file', async () => {
    await request(app.getHttpServer())
      .post('/imports')
      .attach('file', Buffer.from(''), 'empty.csv')
      .expect(400);
  });

  it('rejects a CSV with a malformed header', async () => {
    const res = await request(app.getHttpServer())
      .post('/imports')
      .attach('file', Buffer.from('Country,Sector\nABW,Energy'), 'bad-header.csv')
      .expect(400);

    expect(res.body.message).toMatch(/CSV import failed/);
  });

  let importId: string;

  it('ingests a valid CSV, pivoting wide rows into long-format records', async () => {
    const res = await request(app.getHttpServer())
      .post('/imports')
      .attach('file', Buffer.from(FIXTURE_CSV), 'emissions-fixture.csv')
      .expect(201);

    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.totalRows).toBe(5);
    expect(res.body.validRows).toBe(2);
    expect(res.body.duplicateRows).toBe(1);
    expect(res.body.invalidRows).toBe(2);
    expect(res.body.aggregates.recordCount).toBe(4);
    expect(res.body.aggregates.year).toEqual({ min: 2019, max: 2020 });

    importId = res.body.id;

    const stored = await prisma.emissionRecord.findMany({ where: { importId } });
    expect(stored).toHaveLength(4);
  });

  it('short-circuits re-uploading the exact same file', async () => {
    const countBefore = await prisma.import.count();

    const res = await request(app.getHttpServer())
      .post('/imports')
      .attach('file', Buffer.from(FIXTURE_CSV), 'emissions-fixture.csv')
      .expect(200);

    expect(res.body.id).toBe(importId);
    expect(res.body.duplicateOfExistingImport).toBe(true);

    const countAfter = await prisma.import.count();
    expect(countAfter).toBe(countBefore);
  });

  it('fetches an import summary by id', async () => {
    const res = await request(app.getHttpServer()).get(`/imports/${importId}`).expect(200);
    expect(res.body.id).toBe(importId);
  });

  it('returns 404 for an unknown import id', async () => {
    await request(app.getHttpServer())
      .get('/imports/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });

  it('reflects the import in /status', async () => {
    const res = await request(app.getHttpServer()).get('/status').expect(200);
    expect(res.body.totalRecords).toBe(4);
    expect(res.body.lastImport.id).toBe(importId);
    expect(res.body.schemaVersion).toBeTruthy();
  });
});
