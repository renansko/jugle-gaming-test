import { Global, Module } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import mikroOrmConfig from "../../mikro-orm.config";
import { AppConfig, loadConfig } from "./config/app-config";
import { DependenciesHealthService } from "./health/dependencies-health.service";
import { OperationalMetrics } from "./observability/operational-metrics";
import { OperationalMetricsController } from "./observability/operational-metrics.controller";
import { OpenTelemetryBridge } from "./observability/opentelemetry";
import { DashboardController } from "./observability/dashboard.controller";

@Global()
@Module({
  controllers: [OperationalMetricsController, DashboardController],
  providers: [
    {
      provide: AppConfig,
      useFactory: (): AppConfig => loadConfig(process.env),
    },
    {
      provide: MikroORM,
      useFactory: async (): Promise<MikroORM> => MikroORM.init(mikroOrmConfig),
    },
    DependenciesHealthService,
    OpenTelemetryBridge,
    OperationalMetrics,
  ],
  exports: [
    AppConfig,
    DependenciesHealthService,
    OpenTelemetryBridge,
    OperationalMetrics,
    MikroORM,
  ],
})
export class InfrastructureModule {}
