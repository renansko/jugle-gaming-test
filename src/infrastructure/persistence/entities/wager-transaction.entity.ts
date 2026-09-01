import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/core";

@Entity({ tableName: "wager_transactions" })
@Unique({ properties: ["idempotencyKey"] })
@Unique({ properties: ["providerId", "externalTransactionId"] })
export class WagerTransactionEntity {
  @PrimaryKey({ type: "uuid" }) id!: string;
  @Property({ fieldName: "idempotency_key", length: 255 }) idempotencyKey!: string;
  @Property({ fieldName: "provider_id", length: 128 }) providerId!: string;
  @Property({ fieldName: "external_transaction_id", length: 255 }) externalTransactionId!: string;
  @Property({ fieldName: "payload_hash", length: 64 }) payloadHash!: string;
  @Property({ fieldName: "wallet_id", type: "uuid", nullable: true }) walletId?: string;
  @Property({ fieldName: "player_id", length: 128, nullable: true }) playerId?: string;
  @Property({ length: 3, nullable: true }) currency?: string;
  @Property({ columnType: "numeric(20,2)", nullable: true }) amount?: string;
  @Property({ length: 24 }) kind!: string;
  @Property({ fieldName: "round_id", length: 255, nullable: true }) roundId?: string;
  @Property({ fieldName: "reference_external_transaction_id", length: 255, nullable: true }) referenceExternalTransactionId?: string;
  @Property({ fieldName: "reference_transaction_id", type: "uuid", nullable: true }) referenceTransactionId?: string;
  @Property({ length: 24 }) status!: string;
  @Property({ fieldName: "failure_code", nullable: true, length: 64 }) failureCode?: string;
  @Property({ fieldName: "observed_balance", columnType: "numeric(20,2)", nullable: true }) observedBalance?: string;
  @Property({ fieldName: "reference_attempt_count", default: 0 }) referenceAttemptCount?: number;
  @Property({ fieldName: "next_reference_attempt_at", nullable: true }) nextReferenceAttemptAt?: Date;
  @Property({ fieldName: "reference_lease_until", nullable: true }) referenceLeaseUntil?: Date;
  @Property({ fieldName: "created_at" }) createdAt!: Date;
  @Property({ fieldName: "updated_at" }) updatedAt!: Date;
}
