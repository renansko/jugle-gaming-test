import { Injectable } from "@nestjs/common";
import {
  type Counter,
  type Gauge,
  type Meter,
  type Span,
  type SpanOptions,
  type Tracer,
  metrics,
  trace,
} from "@opentelemetry/api";

export type MetricAttributes = Record<string, string | number | boolean>;

/** @wiki docs/brain/conventions/Observability.md */
@Injectable()
export class OpenTelemetryBridge {
  private readonly tracer: Tracer;
  private readonly meter: Meter;
  private readonly otelCounters = new Map<string, Counter>();
  private readonly otelGauges = new Map<string, Gauge>();

  public constructor() {
    const serviceName = "junglegaming-processor";
    this.tracer = trace.getTracer(serviceName);
    this.meter = metrics.getMeter(serviceName);
  }


  public getTracer(): Tracer {
    return this.tracer;
  }

  public getMeter(): Meter {
    return this.meter;
  }

  public async withSpan<T>(
    name: string,
    attributes: MetricAttributes,
    callback: (span: Span) => Promise<T>,
    options?: SpanOptions,
  ): Promise<T> {
    const span = this.tracer.startSpan(name, {
      ...options,
      attributes: attributes as Record<string, string | number | boolean>,
    });

    try {
      const result = await callback(span);
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (error) {
      span.setStatus({
        code: 2, // ERROR
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  public recordCounter(
    name: string,
    value = 1,
    attributes: MetricAttributes = {},
  ): void {
    let counter = this.otelCounters.get(name);
    if (!counter) {
      counter = this.meter.createCounter(name);
      this.otelCounters.set(name, counter);
    }
    counter.add(value, attributes as Record<string, string>);
  }

  public recordGauge(
    name: string,
    value: number,
    attributes: MetricAttributes = {},
  ): void {
    let gauge = this.otelGauges.get(name);
    if (!gauge) {
      gauge = this.meter.createGauge(name);
      this.otelGauges.set(name, gauge);
    }
    gauge.record(value, attributes as Record<string, string>);
  }
}
