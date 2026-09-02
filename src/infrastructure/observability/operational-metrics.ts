import { Injectable, Optional } from "@nestjs/common";
import { OpenTelemetryBridge } from "./opentelemetry";

export type MetricLabels = Record<string, string>;

/** @wiki docs/brain/conventions/Observability.md */
@Injectable()
export class OperationalMetrics {
  private readonly counters = new Map<string, number>([
    ["wager_transactions_total{}", 0],
  ]);
  private readonly gauges = new Map<string, number>([
    ["wallet_lock_duration_ms{}", 0],
    ["wager_processing_latency_ms{}", 0],
    ["outbox_pending{}", 0],
    ["outbox_lag_ms{}", 0],
  ]);

  public constructor(
    @Optional()
    private readonly otel?: OpenTelemetryBridge,
  ) {}

  public increment(name: string, labels: MetricLabels = {}): void {
    const formattedKey = this.formatMetricKey(name, labels);
    const currentCount = this.counters.get(formattedKey) ?? 0;
    this.counters.set(formattedKey, currentCount + 1);
    this.otel?.recordCounter(name, 1, labels);
  }

  public snapshot(): ReadonlyMap<string, number> {
    return new Map([...this.counters, ...this.gauges]);
  }

  public observe(name: string, value: number, labels: MetricLabels = {}): void {
    const formattedKey = this.formatMetricKey(name, labels);
    this.gauges.set(formattedKey, value);
    this.otel?.recordGauge(name, value, labels);
  }

  public set(name: string, value: number, labels: MetricLabels = {}): void {
    const formattedKey = this.formatMetricKey(name, labels);
    this.gauges.set(formattedKey, value);
    this.otel?.recordGauge(name, value, labels);
  }

  public toPrometheusFormat(): string {
    const lines: string[] = [];
    const metricFamilies = this.groupMetricFamilies();

    for (const [name, entries] of metricFamilies) {
      const isCounter = name.endsWith("_total");
      const metricType = isCounter ? "counter" : "gauge";
      lines.push(`# HELP ${name} Metric ${name}`);
      lines.push(`# TYPE ${name} ${metricType}`);

      for (const entry of entries) {
        lines.push(this.formatPrometheusLine(name, entry.labels, entry.value));
      }
    }

    return `${lines.join("\n")}\n`;
  }

  private groupMetricFamilies(): Map<
    string,
    Array<{ labels: MetricLabels; value: number }>
  > {
    const families = new Map<
      string,
      Array<{ labels: MetricLabels; value: number }>
    >();

    for (const [key, value] of [...this.counters, ...this.gauges]) {
      const parsed = this.parseMetricKey(key);
      const group = families.get(parsed.name) ?? [];
      group.push({ labels: parsed.labels, value });
      families.set(parsed.name, group);
    }

    return families;
  }

  private parseMetricKey(key: string): { name: string; labels: MetricLabels } {
    const braceIndex = key.indexOf("{");
    if (braceIndex === -1) {
      return { name: key, labels: {} };
    }

    const name = key.slice(0, braceIndex);
    const rawLabels = key.slice(braceIndex + 1, -1);
    if (!rawLabels) {
      return { name, labels: {} };
    }

    const labels: MetricLabels = {};
    for (const pair of rawLabels.split(",")) {
      const [k, v] = pair.split("=");
      if (k && v) {
        labels[k] = v;
      }
    }
    return { name, labels };
  }

  private formatPrometheusLine(
    name: string,
    labels: MetricLabels,
    value: number,
  ): string {
    const labelPairs = Object.entries(labels);
    if (labelPairs.length === 0) {
      return `${name} ${value}`;
    }

    const labelStr = labelPairs
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    return `${name}{${labelStr}} ${value}`;
  }

  private formatMetricKey(name: string, labels: MetricLabels): string {
    const sortedLabelPairs = Object.entries(labels).sort(([keyA], [keyB]) =>
      keyA.localeCompare(keyB),
    );

    const serializedLabels = sortedLabelPairs
      .map(([key, value]) => `${key}=${value}`)
      .join(",");

    return `${name}{${serializedLabels}}`;
  }
}
