import { Entity, Index, PrimaryKey, Property, Unique } from "@mikro-orm/core";

@Entity({ tableName: "wallet_ledger_entries" })
@Unique({ properties: ["walletId", "transactionId"] })
@Index({ properties: ["walletId", "createdAt", "id"] })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: "uuid" }) id!: string;
  @Property({ fieldName: "wallet_id", type: "uuid" }) walletId!: string;
  @Property({ fieldName: "transaction_id", type: "uuid" }) transactionId!: string;
  @Property({ length: 6 }) direction!: string;
  @Property({ columnType: "numeric(20,2)" }) amount!: string;
  @Property({ length: 3 }) currency!: string;
  @Property({ fieldName: "balance_before", columnType: "numeric(20,2)" }) balanceBefore!: string;
  @Property({ fieldName: "balance_after", columnType: "numeric(20,2)" }) balanceAfter!: string;
  @Property({ fieldName: "created_at" }) createdAt!: Date;
}
