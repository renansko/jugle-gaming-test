import { Injectable } from "@nestjs/common";

export type MetricLabels = Record<string, string>;

/** Low-cardinality in-process counters. Export can be wired to a metrics backend later. */
@Injectable()
export class OperationalMetrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  public increment(name: string, labels: MetricLabels = {}): void {
    const formattedKey = this.formatMetricKey(name, labels);
    const currentCount = this.counters.get(formattedKey) ?? 0;
    this.counters.set(formattedKey, currentCount + 1);
  }

  public snapshot(): ReadonlyMap<string, number> {
    return new Map([...this.counters, ...this.gauges]);
  }

  public observe(name: string, value: number, labels: MetricLabels = {}): void {
    const formattedKey = this.formatMetricKey(name, labels);
    this.gauges.set(formattedKey, value);
  }

  public set(name: string, value: number, labels: MetricLabels = {}): void {
    const formattedKey = this.formatMetricKey(name, labels);
    this.gauges.set(formattedKey, value);
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
