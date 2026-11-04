import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { MaintenanceModule } from '../modules/maintenance/maintenance.module';
import { WorkerRunner } from './worker-runner';
import { OutboxDispatcher } from './outbox-dispatcher.service';

/**
 * Worker dependency graph — deliberately narrower than AppModule: no HTTP
 * controllers, so the two processes can never double-run HTTP or cron work
 * (Tech Spec §3.1: API and worker are separate processes, one codebase).
 */
@Module({
  imports: [CommonModule, NotificationsModule, MaintenanceModule],
  providers: [WorkerRunner, OutboxDispatcher],
})
export class WorkerModule {}
