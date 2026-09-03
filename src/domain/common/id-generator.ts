import { randomUUID } from "node:crypto";

export interface IdGenerator {
  generate(): string;
}

export class CryptoIdGenerator implements IdGenerator {
  public generate(): string {
    return randomUUID();
  }
}

export class DeterministicIdGenerator implements IdGenerator {
  private index = 0;
  private readonly predefinedIds: string[];

  public constructor(predefinedIds: string[] = []) {
    this.predefinedIds = [...predefinedIds];
  }

  public generate(): string {
    if (this.index < this.predefinedIds.length) {
      const id = this.predefinedIds[this.index];
      this.index += 1;
      if (id !== undefined) {
        return id;
      }
    }
    this.index += 1;
    return `det-id-${this.index}`;
  }
}
