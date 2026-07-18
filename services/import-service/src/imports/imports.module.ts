import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { EmissionsCsvParserService } from './csv/emissions-csv-parser.service';
import { IMPORT_BATCH_SIZE } from './imports.constants';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: undefined, // default memoryStorage: buffer is streamed straight into the CSV parser
        limits: { fileSize: config.get<number>('MAX_UPLOAD_SIZE_BYTES') },
      }),
    }),
  ],
  controllers: [ImportsController],
  providers: [
    ImportsService,
    EmissionsCsvParserService,
    {
      provide: IMPORT_BATCH_SIZE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.get<number>('IMPORT_BATCH_SIZE'),
    },
  ],
})
export class ImportsModule {}
