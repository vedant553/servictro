import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Tenant-scoped transaction host — THE multi-tenant control point.
 *
 * Every read/write of tenant-owned data runs inside one interactive Prisma
 * transaction that first sets the transaction-local PostgreSQL variable
 * `app.tenant_id`. Row-level security policies (FORCE RLS, non-owner app role)
 * enforce the same boundary in the database as defence-in-depth (Tech Spec
 * §15.2/§15.3; ADR-005). Transaction-local settings cannot leak across
 * pooled connections.
 */
@Injectable()
export class TenantDbService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run `fn` inside the tenant transaction. `fn` receives the transaction
   * client; repositories must use it exclusively.
   */
  async run<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
        return fn(tx);
      },
      { timeout: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}

export type TenantTx = Prisma.TransactionClient;
