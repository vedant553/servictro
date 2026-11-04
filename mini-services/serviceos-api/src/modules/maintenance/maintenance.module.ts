import { Module } from '@nestjs/common';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { RenewalRemindersService } from './renewal-reminders.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, RenewalRemindersService],
  exports: [MaintenanceService, RenewalRemindersService],
})
export class MaintenanceModule {}
