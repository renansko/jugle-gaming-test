export interface BackoffPolicy {
  computeDelayMs(
    attempt: number,
    baseMs?: number,
    maxJitterMs?: number,
  ): number;
  delay(ms: number): Promise<void>;
}

export class DefaultBackoffPolicy implements BackoffPolicy {
  public computeDelayMs(
    attempt: number,
    baseMs = 20,
    maxJitterMs = 20,
  ): number {
    const baseDelayMs = baseMs * 2 ** attempt;
    const jitterMs =
      maxJitterMs > 0 ? Math.floor(Math.random() * maxJitterMs) : 0;
    return baseDelayMs + jitterMs;
  }

  public async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}

export class ZeroBackoffPolicy implements BackoffPolicy {
  public computeDelayMs(
    _attempt: number,
    _baseMs = 0,
    _maxJitterMs = 0,
  ): number {
    return 0;
  }

  public async delay(_ms: number): Promise<void> {
    await Promise.resolve();
  }
}
