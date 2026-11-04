import { Controller, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { Public, SkipEnvelope } from '../../common/auth/public.decorator';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { EnvToken, Defaults, type Env } from '../../common/config/env';
import { Inject } from '@nestjs/common';
import { FilesService } from './files.service';

class FileIdDto {
  @IsUUID('all')
  id!: string;
}

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    @Inject(EnvToken) private readonly env: Env,
  ) {}

  @Post()
  @RequirePermissions('files:write')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    // Interceptor hard ceiling (DoS guard); the service enforces MAX_UPLOAD_MB.
    FileInterceptor('file', {
      limits: { fileSize: Defaults.uploadInterceptorMaxBytes, files: 1 },
    }),
  )
  @ApiOperation({ summary: 'Upload a file (bytes-validated MIME, malware-scanned, checksum, signed download URL)' })
  async upload(
    @CurrentTenant() ctx: TenantContext,
    @UploadedFile() file: Express.Multer.File,
    @Query('ownerType') ownerType?: string,
    @Query('ownerId') ownerId?: string,
  ) {
    return this.files.upload(
      ctx,
      { buffer: file.buffer, size: file.size, originalname: file.originalname, mimetype: file.mimetype },
      { ownerType, ownerId },
    );
  }

  @Get(':id/download-url')
  @RequirePermissions('files:read')
  @ApiOperation({ summary: 'Short-lived signed download URL (after role + object-level authorization)' })
  async downloadUrl(@CurrentTenant() ctx: TenantContext, @Param() params: FileIdDto) {
    return this.files.getDownloadUrl(ctx, params.id);
  }

  /**
   * Signed download endpoint (local storage driver) — the HMAC token is the
   * authorization (same trust model as an S3 presigned URL). Public by
   * design, always expiring, scan-clean attachments only.
   */
  @Get('download/:token')
  @Public()
  @SkipEnvelope()
  @ApiOperation({ summary: 'Stream a file via a signed token (token = authorization)' })
  async download(
    @Param('token') token: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.files.resolveSignedDownload(token, sig);
    res.setHeader('Content-Type', result.contentType);
    // Sanitized ASCII filename; never the raw stored name verbatim.
    res.setHeader('Content-Disposition', `attachment; filename="${result.originalName.replace(/[^\x20-\x7e]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    result.stream.pipe(res);
  }
}
