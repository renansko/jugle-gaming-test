import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DependenciesHealthService } from "../../../infrastructure/health/dependencies-health.service";
import { PublicRoute } from "../auth/provider-identity.guard";

@PublicRoute()
@Controller("health")
export class HealthController {
  public constructor(
    @Inject(DependenciesHealthService)
    private readonly dependenciesHealth: DependenciesHealthService,
  ) {}

  @Get("live")
  public live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  public async ready(): Promise<{
    status: "ok";
    dependencies: { database: "up"; sqs: "up" };
  }> {
    const dependencies = await this.dependenciesHealth.check();
    if (dependencies.database === "down" || dependencies.sqs === "down") {
      throw new ServiceUnavailableException({ status: "error", dependencies });
    }
    return { status: "ok", dependencies: { database: "up", sqs: "up" } };
  }
}
