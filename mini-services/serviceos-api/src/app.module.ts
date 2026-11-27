import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { IdentityModule } from './modules/identity/identity.module';
import { CustomersModule } from './modules/customers/customers.module';
import { SitesModule } from './modules/sites/sites.module';
import { AssetsModule } from './modules/assets/assets.module';
import { FilesModule } from './modules/files/files.module';
import { ServiceRequestsModule } from './modules/service-requests/service-requests.module';
import { WorkOrdersModule } from './modules/work-orders/work-orders.module';
import { ChecklistsModule } from './modules/checklists/checklists.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditModule } from './modules/audit/audit.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { MobileModule } from './modules/mobile/mobile.module';

/**
 * ServiceOS modular monolith — API process entrypoint (main.ts) and worker
 * process entrypoint (worker.ts) share this module graph. Domain modules own
 * their tables; cross-module access goes through exported application
 * services (Tech Spec §4 MODULE OWNERSHIP RULE).
 */
@Module({
  imports: [
    CommonModule,
    HealthModule,
    // Identity & tenancy (Phase 2)
    AuthModule,
    TenantsModule,
    IdentityModule,
    // Core business foundation (Phase 3)
    CustomersModule,
    SitesModule,
    AssetsModule,
    FilesModule,
    // Service operations (Phase 4)
    ServiceRequestsModule,
    ChecklistsModule,
    WorkOrdersModule,
    // Maintenance management (Phase 6)
    ContractsModule,
    MaintenanceModule,
    // Cross-cutting user-facing services
    NotificationsModule,
    AuditModule,
    AnalyticsModule,
    MobileModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
