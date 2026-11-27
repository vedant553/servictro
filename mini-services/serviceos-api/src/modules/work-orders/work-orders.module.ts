import { Module } from '@nestjs/common';
import { WorkOrdersController, RequestConversionController } from './work-orders.controller';
import { WorkOrdersService } from './work-orders.service';
import { FieldExecutionService } from './field-execution.service';
import { ReportsService } from './reports.service';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContractsModule } from '../contracts/contracts.module';
import { ServiceRequestsModule } from '../service-requests/service-requests.module';

@Module({
  imports: [FilesModule, NotificationsModule, ContractsModule, ServiceRequestsModule],
  controllers: [WorkOrdersController, RequestConversionController],
  providers: [WorkOrdersService, FieldExecutionService, ReportsService],
  exports: [WorkOrdersService, FieldExecutionService, ReportsService],
})
export class WorkOrdersModule {}
