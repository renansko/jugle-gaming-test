import { Global, Module } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import mikroOrmConfig from "../../mikro-orm.config";
import { AppConfig, loadConfig } from "./config/app-config";
import { DependenciesHealthService } from "./health/dependencies-health.service";
import { OperationalMetrics } from "./observability/operational-metrics";
import { OperationalMetricsController } from "./observability/operational-metrics.controller";

@Global()
@Module({
  controllers: [OperationalMetricsController],
  providers: [
    { provide: AppConfig, useFactory: (): AppConfig => loadConfig(process.env) },
    { provide: MikroORM, useFactory: async (): Promise<MikroORM> => MikroORM.init(mikroOrmConfig) },
    DependenciesHealthService,
    OperationalMetrics,
  ],
  exports: [AppConfig, DependenciesHealthService, OperationalMetrics, MikroORM],
})
export class InfrastructureModule {}
