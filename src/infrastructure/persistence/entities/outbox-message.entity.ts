import { Entity, Index, PrimaryKey, Property } from "@mikro-orm/core";

@Entity({ tableName: "outbox_messages" })
@Index({ properties: ["publishedAt", "nextAttemptAt"] })
export class OutboxMessageEntity {
  @PrimaryKey({ type: "uuid" }) id!: string;
  @Property({ fieldName: "event_type", length: 100 }) eventType!: string;
  @Property({ columnType: "jsonb" }) payload!: Record<string, unknown>;
  @Property({ fieldName: "attempt_count" }) attemptCount!: number;
  @Property({ fieldName: "next_attempt_at" }) nextAttemptAt!: Date;
  @Property({ fieldName: "lease_until", nullable: true }) leaseUntil?: Date;
  @Property({ fieldName: "published_at", nullable: true }) publishedAt?: Date;
  @Property({ fieldName: "created_at" }) createdAt!: Date;
}
