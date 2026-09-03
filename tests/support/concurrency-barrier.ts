export class ConcurrencyBarrier {
  private readonly parties: number;
  private waiters: Array<() => void> = [];

  public constructor(parties: number) {
    if (parties <= 0) {
      throw new Error("Barrier parties must be positive");
    }
    this.parties = parties;
  }

  public async await(): Promise<void> {
    if (this.waiters.length + 1 >= this.parties) {
      const toNotify = [...this.waiters];
      this.waiters = [];
      for (const notify of toNotify) {
        notify();
      }
      return;
    }

    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  public getWaitingCount(): number {
    return this.waiters.length;
  }
}
