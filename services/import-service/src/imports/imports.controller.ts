import { Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ImportsService } from './imports.service';
import { ImportSummaryDto } from './dto/import-summary.dto';

@ApiTags('imports')
@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload and ingest a CSV file of emissions data',
    description:
      'Accepts a wide-format CSV (Country, Sector, Parent sector, <year columns>...), ' +
      'pivots it into per-year records, and stores it in the database. Re-uploading the ' +
      'exact same file short-circuits with the original import summary instead of re-ingesting.',
  })
  @ApiResponse({ status: 201, description: 'Import completed', type: ImportSummaryDto })
  @ApiResponse({
    status: 200,
    description: 'File already imported previously; returning that summary',
  })
  @ApiResponse({ status: 400, description: 'File missing, empty, not a CSV, or malformed' })
  @ApiResponse({ status: 409, description: 'This exact file is already being imported' })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ImportSummaryDto> {
    const summary = await this.importsService.importFile(file);
    res.status(summary.duplicateOfExistingImport ? 200 : 201);
    return summary;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch the status/result of a previous import' })
  @ApiResponse({ status: 200, description: 'Import summary', type: ImportSummaryDto })
  @ApiResponse({ status: 404, description: 'Import not found' })
  async findOne(@Param('id') id: string): Promise<ImportSummaryDto> {
    return this.importsService.findOne(id);
  }
}
