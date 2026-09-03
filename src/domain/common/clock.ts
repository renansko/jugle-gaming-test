export interface Clock {
  now(): Date;
  nowMs(): number;
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }

  public nowMs(): number {
    return Date.now();
  }
}

export class SettableClock implements Clock {
  private currentTimeMs: number;

  public constructor(initialDate: Date = new Date()) {
    this.currentTimeMs = initialDate.getTime();
  }

  public now(): Date {
    return new Date(this.currentTimeMs);
  }

  public nowMs(): number {
    return this.currentTimeMs;
  }

  public setTime(date: Date): void {
    this.currentTimeMs = date.getTime();
  }

  public advanceMs(ms: number): void {
    this.currentTimeMs += ms;
  }
}
