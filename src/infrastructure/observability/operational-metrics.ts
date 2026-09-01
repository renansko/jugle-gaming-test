import { Injectable } from "@nestjs/common";

/** Low-cardinality in-process counters. Export can be wired to a metrics backend later. */
@Injectable()
export class OperationalMetrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  public increment(name: string, labels: Record<string, string> = {}): void {
    const key = `${name}{${Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(",")}}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  public snapshot(): ReadonlyMap<string, number> {
    return new Map([...this.counters, ...this.gauges]);
  }

  public observe(name: string, value: number, labels: Record<string, string> = {}): void {
    this.gauges.set(this.key(name, labels), value);
  }

  public set(name: string, value: number, labels: Record<string, string> = {}): void {
    this.gauges.set(this.key(name, labels), value);
  }

  private key(name: string, labels: Record<string, string>): string {
    return `${name}{${Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(",")}}`;
  }
}
