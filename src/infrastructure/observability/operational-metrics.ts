import { Injectable, Optional } from "@nestjs/common";
import type { OpenTelemetryBridge } from "./opentelemetry";


export type MetricLabels = Record<string, string>;

const HISTOGRAM_BUCKETS = new Map<string, readonly number[]>([
  ["wager_processing_latency_ms", [5, 10, 25, 50, 100, 250, 500, 1_000]],
]);

interface HistogramValue {
  readonly labels: MetricLabels;
  readonly buckets: number[];
  count: number;
  sum: number;
}

/** @wiki docs/brain/conventions/Observability.md */
@Injectable()
export class OperationalMetrics {
  private readonly counters = new Map<string, number>([
    ["wager_transactions_total{}", 0],
    ["consumer_drain_total{}", 0],
    ["consumer_visibility_released_total{}", 0],
    ["sqs_redeliveries_total{}", 0],
    ["shutdown_failures_total{}", 0],
  ]);
  private readonly gauges = new Map<string, number>([
    ["wallet_lock_duration_ms{}", 0],
    ["outbox_pending{}", 0],
    ["outbox_lag_ms{}", 0],
  ]);
  private readonly histograms = new Map<string, HistogramValue>();

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
    return new Map([
      ...this.counters,
      ...this.gauges,
      ["wager_processing_latency_ms{}", 0],
    ]);
  }

  public observe(name: string, value: number, labels: MetricLabels = {}): void {
    if (HISTOGRAM_BUCKETS.has(name)) {
      this.observeHistogram(name, value, labels);
      this.otel?.recordHistogram(name, value, labels);
      return;
    }

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

    lines.push(...this.formatHistograms());

    return `${lines.join("\n")}\n`;
  }

  private observeHistogram(
    name: string,
    value: number,
    labels: MetricLabels,
  ): void {
    const key = this.formatMetricKey(name, labels);
    const boundaries = HISTOGRAM_BUCKETS.get(name) ?? [];
    const histogram = this.histograms.get(key) ?? {
      labels,
      buckets: boundaries.map(() => 0),
      count: 0,
      sum: 0,
    };

    histogram.count += 1;
    histogram.sum += value;
    boundaries.forEach((boundary, index) => {
      if (value <= boundary) {
        histogram.buckets[index] = (histogram.buckets[index] ?? 0) + 1;
      }
    });
    this.histograms.set(key, histogram);
  }

  private formatHistograms(): string[] {
    const lines: string[] = [];

    for (const [key, histogram] of this.histograms) {
      const { name } = this.parseMetricKey(key);
      lines.push(`# HELP ${name} Distribution of ${name}`);
      lines.push(`# TYPE ${name} histogram`);
      this.appendHistogramSamples(lines, name, histogram);
    }

    return lines;
  }

  private appendHistogramSamples(
    lines: string[],
    name: string,
    histogram: HistogramValue,
  ): void {
    const boundaries = HISTOGRAM_BUCKETS.get(name) ?? [];
    boundaries.forEach((boundary, index) => {
      lines.push(
        this.formatPrometheusLine(
          `${name}_bucket`,
          { ...histogram.labels, le: String(boundary) },
          histogram.buckets[index] ?? 0,
        ),
      );
    });
    lines.push(
      this.formatPrometheusLine(
        `${name}_bucket`,
        { ...histogram.labels, le: "+Inf" },
        histogram.count,
      ),
      this.formatPrometheusLine(`${name}_sum`, histogram.labels, histogram.sum),
      this.formatPrometheusLine(`${name}_count`, histogram.labels, histogram.count),
    );
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
