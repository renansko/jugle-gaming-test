import { Controller, Get, Inject } from "@nestjs/common";
import { OperationalMetrics } from "./operational-metrics";

@Controller("metrics")
export class OperationalMetricsController {
  public constructor(
    @Inject(OperationalMetrics) private readonly metrics: OperationalMetrics,
  ) {}

  @Get()
  public snapshot(): Record<string, number> {
    return Object.fromEntries(this.metrics.snapshot());
  }
}
