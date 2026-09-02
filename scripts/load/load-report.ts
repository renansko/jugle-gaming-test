export interface LoadSample {
  readonly durationMs: number;
  readonly status?: number;
  readonly error?: string;
}

export interface LoadSummary {
  readonly requests: number;
  readonly successful: number;
  readonly businessRejections: number;
  readonly conflicts: number;
  readonly technicalFailures: number;
  readonly latencyMs: { readonly p50: number; readonly p95: number; readonly p99: number };
}

function percentile(sortedValues: readonly number[], percentileValue: number): number {
  const rank = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, rank)] ?? 0;
}

function classify(sample: LoadSample): keyof Omit<LoadSummary, "requests" | "latencyMs"> {
  if (sample.error || !sample.status || sample.status >= 500) return "technicalFailures";
  if (sample.status === 409) return "conflicts";
  if (sample.status >= 400) return "businessRejections";
  return "successful";
}

export function summarizeLoadSamples(samples: readonly LoadSample[]): LoadSummary {
  const durations = samples.map(({ durationMs }) => durationMs).sort((a, b) => a - b);
  const outcomes = {
    successful: 0,
    businessRejections: 0,
    conflicts: 0,
    technicalFailures: 0,
  };

  for (const sample of samples) outcomes[classify(sample)] += 1;

  return {
    requests: samples.length,
    ...outcomes,
    latencyMs: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
    },
  };
}
