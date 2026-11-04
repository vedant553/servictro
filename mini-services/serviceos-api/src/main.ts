import './common/config/load-env-file';
import { ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { PermissionsGuard } from './common/auth/permissions.guard';
import { ServiceThrottlerGuard } from './common/auth/service-throttler.guard';
import { EnvToken } from './common/config/env';
import { DomainError } from './common/errors/domain.error';
import { logger } from './common/logging/logger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// BigInt (money minor units, file sizes) serializes as string (documented in docs/API.md).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function toJSON(): string {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  const env = app.get(EnvToken);
  const reflector = app.get(Reflector);

  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready', 'health/worker'] });

  app.use(helmet({ contentSecurityPolicy: env.enableSwagger ? false : undefined }));
  // Correct client IPs behind the gateway/ALB (rate limiting, audit IP hash).
  // TRUST_PROXY defaults to 'loopback' — set it to your proxy topology in
  // production (docs/SECURITY.md).
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', env.trustProxy);
  // Populate req.cookies — required by the rotating refresh-token cookie
  // (auth.controller reads req.cookies[refreshCookieName]).
  app.use(cookieParser());
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.enableCors({ origin: env.corsOrigins, credentials: true });
  app.enableShutdownHooks();

  // Guard order (audit SEC-02): authentication first (so rate limiting can
  // key on the user id), then rate limiting, then permission checks.
  app.useGlobalGuards(
    app.get(JwtAuthGuard),
    app.get(ServiceThrottlerGuard),
    app.get(PermissionsGuard),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const details = errors.map((e) => ({
          field: e.property,
          reason: Object.values(e.constraints ?? {}).join('; '),
        }));
        return new DomainError('VALIDATION_FAILED', 'Request validation failed', 400, details);
      },
    }),
  );
  app.useGlobalInterceptors(new EnvelopeInterceptor(reflector));
  app.useGlobalFilters(new AllExceptionsFilter());

  if (env.enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('ServiceOS API')
      .setDescription('Industrial after-sales service & asset operations platform — REST API v1')
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addApiKey({ type: 'apiKey', name: 'X-Tenant-Id', in: 'header' }, 'tenant-id')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, { swaggerOptions: { persistAuthorization: true } });
  }

  await app.listen(env.port, '0.0.0.0');
  logger.info({ port: env.port, swagger: env.enableSwagger }, 'serviceos-api started');
}

bootstrap().catch((err) => {
  console.error('BOOT FAILED:', err);
  process.exit(1);
});
