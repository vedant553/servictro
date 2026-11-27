import { Module } from '@nestjs/common';
import { MobileController } from './mobile.controller';
import { WorkOrdersModule } from '../work-orders/work-orders.module';

@Module({
  imports: [WorkOrdersModule],
  controllers: [MobileController],
})
export class MobileModule {}
