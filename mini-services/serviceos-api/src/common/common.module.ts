import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './prisma/prisma.service';
import { TenantDbService } from './tenant/tenant-db.service';
import { AuditService } from './audit/audit.service';
import { OutboxService } from './outbox/outbox.service';
import { NumberingService } from './numbering/numbering.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { ServiceThrottlerGuard } from './auth/service-throttler.guard';
import { EnvToken, loadEnv } from './config/env';
import { StorageModule } from './storage/storage.module';

/** Cross-cutting infrastructure shared by every domain module. */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [EnvToken],
      useFactory: (env: { jwtAccessSecret: string; accessTokenTtlMinutes: number }) => ({
        secret: env.jwtAccessSecret,
        signOptions: { expiresIn: `${env.accessTokenTtlMinutes}m`, issuer: 'serviceos' },
      }),
    }),
    // Rate limiting (audit SEC-02): global default window from env; auth and
    // upload endpoints override with @Throttle decorators on their controllers.
    ThrottlerModule.forRootAsync({
      inject: [EnvToken],
      useFactory: (env: { throttleTtlMs: number; throttleLimit: number }) => [
        { name: 'default', ttl: env.throttleTtlMs, limit: env.throttleLimit },
      ],
    }),
    StorageModule,
  ],
  providers: [
    { provide: EnvToken, useValue: loadEnv() },
    PrismaService,
    TenantDbService,
    AuditService,
    OutboxService,
    NumberingService,
    JwtAuthGuard,
    PermissionsGuard,
    ServiceThrottlerGuard,
  ],
  exports: [
    EnvToken,
    PrismaService,
    TenantDbService,
    AuditService,
    OutboxService,
    NumberingService,
    JwtAuthGuard,
    PermissionsGuard,
    ServiceThrottlerGuard,
  ],
})
export class CommonModule {}
