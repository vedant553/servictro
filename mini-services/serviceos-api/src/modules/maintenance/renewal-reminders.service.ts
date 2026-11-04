import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Defaults } from '../../common/config/env';
import { childLogger } from '../../common/logging/logger';
import { daysBetweenUtcDays, isContractExpired, renewalHorizonFor } from './domain/expiry';

const log = childLogger({ service: 'serviceos-worker', job: 'renewals' });

/** Contract rows discovered across tenants by the worker's poller. */
export interface RenewalContractRow {
  id: string;
  tenantId: string;
  contractNo: string;
  endDate: Date;
  renewalStatus: string;
}

export interface RenewalPassResult {
  reminded: number;
  expired: number;
  dueSoon: number;
}

/**
 * AMC renewal pass (audit DATA-04/DATA-05) — extracted from WorkerRunner so
 * it runs identically in production (timer-driven, fed by the least-privilege
 * worker poller) and in tests (called directly with discovered rows).
 *
 * Correctness rules:
 *  - contracts that expired at ANY point in the past are still processed (the
 *    discovery query has no lower time bound): the pass must never miss an
 *    expiry because the worker was down or the database was restored;
 *  - a contract stays covered through the END of its endDate (UTC date) —
 *    entitlement queries use the same rule (contracts.service);
 *  - horizon reminders (90/60/30 + "expires today") are deduplicated by a
 *    stable key per (tenant, user, contract, horizon) — repeat passes are
 *    idempotent, even with multiple worker instances;
 *  - an expired contract gets a single coverage-lost notification.
 */
@Injectable()
export class RenewalRemindersService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Discovery query the worker executes on its least-privilege poller. */
  static discoveryQuery(now: Date): { where: { status: 'active'; endDate: { lte: Date } } } {
    const horizonDays = Math.max(...Defaults.renewalHorizons, 0);
    // Upper bound: end of the horizon day. NO lower bound — expired contracts
    // must still be picked up for the status flip + coverage-lost notice.
    return { where: { status: 'active' as const, endDate: { lte: endOfUtcDayPlus(now, horizonDays) } } };
  }

  async runPass(rows: RenewalContractRow[], now: Date = new Date()): Promise<RenewalPassResult> {
    let reminded = 0;
    let expired = 0;
    let dueSoon = 0;

    for (const contract of rows) {
      const daysRemaining = daysBetweenUtcDays(contract.endDate, now);
      try {
        await this.tenantDb.run(contract.tenantId, async (tx) => {
          if (isContractExpired(contract.endDate, now)) {
            await tx.serviceContract.update({
              where: { id: contract.id },
              data: { status: 'expired' },
            });
            expired++;
            await this.notifications.createForRoles(
              tx,
              contract.tenantId,
              ['owner', 'admin', 'contract_admin', 'service_manager'],
              {
                category: 'amc_renewal',
                title: `AMC ${contract.contractNo} has expired`,
                body: `Contract ended on ${contract.endDate.toISOString().slice(0, 10)} — coverage is no longer active. Renew to restore entitlements.`,
                entityType: 'contract',
                entityId: contract.id,
                dedupKey: `amc_renewal:${contract.id}:expired`,
              },
            );
            return;
          }
          if (daysRemaining <= Defaults.renewalHorizons[0] && contract.renewalStatus === 'not_due') {
            await tx.serviceContract.update({ where: { id: contract.id }, data: { renewalStatus: 'due_soon' } });
            dueSoon++;
          }
          const horizon = renewalHorizonFor(daysRemaining, Defaults.renewalHorizons);
          if (horizon !== null) {
            const created = await this.notifications.createForRoles(
              tx,
              contract.tenantId,
              ['owner', 'admin', 'contract_admin', 'service_manager'],
              {
                category: 'amc_renewal',
                title:
                  daysRemaining === 0
                    ? `AMC ${contract.contractNo} expires today`
                    : `AMC ${contract.contractNo} expires in ${daysRemaining} days`,
                body: `Contract ends on ${contract.endDate.toISOString().slice(0, 10)}. Review service history and start the renewal conversation.`,
                entityType: 'contract',
                entityId: contract.id,
                dedupKey: `amc_renewal:${contract.id}:d${horizon}`,
              },
            );
            reminded += created.length;
          }
        });
      } catch (error) {
        log.warn({ contractId: contract.id, err: error }, 'renewal_reminder_failed');
      }
    }
    if (reminded || expired || dueSoon) {
      log.info({ reminded, expired, dueSoon }, 'renewal_pass_complete');
    }
    return { reminded, expired, dueSoon };
  }
}

function endOfUtcDayPlus(now: Date, days: number): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days + 1));
}
