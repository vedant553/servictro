import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma access point. Business code must NOT use this directly for
 * tenant-owned data — use TenantDbService.run() which enforces the tenant
 * transaction + RLS context. Direct access is allowed only for platform-scope
 * tables (users, tenants, memberships, invitations, refresh_tokens) in the
 * identity/auth paths.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
