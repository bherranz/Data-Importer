import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StatusService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus() {
    const [totalRecords, lastImport, schemaVersion] = await Promise.all([
      this.prisma.emissionRecord.count(),
      this.prisma.import.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.getLatestSchemaMigration(),
    ]);

    return {
      totalRecords,
      lastImport: lastImport
        ? {
            id: lastImport.id,
            filename: lastImport.filename,
            status: lastImport.status,
            startedAt: lastImport.startedAt,
            finishedAt: lastImport.finishedAt,
          }
        : null,
      schemaVersion,
    };
  }

  private async getLatestSchemaMigration(): Promise<string | null> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ migration_name: string }>>(
        Prisma.sql`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`,
      );
      return rows[0]?.migration_name ?? null;
    } catch {
      return null;
    }
  }
}
