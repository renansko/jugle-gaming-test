import { Controller, Get, Headers, Inject, Res } from "@nestjs/common";
import { OperationalMetrics } from "./operational-metrics";

@Controller("metrics")
export class OperationalMetricsController {
  public constructor(
    @Inject(OperationalMetrics) private readonly metrics: OperationalMetrics,
  ) {}

  @Get()
  public snapshot(
    @Headers("accept") accept = "",
    @Res({ passthrough: true })
    response?: { setHeader(name: string, value: string): void },
  ): unknown {
    if (accept.includes("application/json")) {
      response?.setHeader("content-type", "application/json; charset=utf-8");
      return Object.fromEntries(this.metrics.snapshot());
    }

    response?.setHeader(
      "content-type",
      "text/plain; version=0.0.4; charset=utf-8",
    );
    return this.metrics.toPrometheusFormat();
  }
}
