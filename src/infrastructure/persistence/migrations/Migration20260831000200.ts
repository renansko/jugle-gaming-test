import { Migration } from "@mikro-orm/migrations";

export class Migration20260831000200 extends Migration {
  public override async up(): Promise<void> {
    this.addSql(`alter table "wager_transactions"
      add column "wallet_id" uuid null references "wallets" ("id"),
      add column "player_id" varchar(128) null,
      add column "currency" char(3) null,
      add column "amount" numeric(20,2) null,
      add column "round_id" varchar(255) null,
      add column "reference_external_transaction_id" varchar(255) null,
      add column "reference_transaction_id" uuid null references "wager_transactions" ("id"),
      add column "observed_balance" numeric(20,2) null;`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_amount_non_negative" check ("amount" is null or "amount" > 0);`);
    this.addSql(`create unique index "wager_transactions_reference_kind_unique" on "wager_transactions" ("reference_transaction_id", "kind") where "reference_transaction_id" is not null and "status" in ('PENDING','PENDING_REFERENCE','PROCESSED');`);
    this.addSql(`create index "wager_transactions_provider_external_index" on "wager_transactions" ("provider_id", "external_transaction_id");`);
  }

  public override async down(): Promise<void> {
    this.addSql('drop index if exists "wager_transactions_provider_external_index";');
    this.addSql('drop index if exists "wager_transactions_reference_kind_unique";');
    this.addSql('alter table "wager_transactions" drop constraint if exists "wager_transactions_amount_non_negative";');
    this.addSql(`alter table "wager_transactions" drop column "observed_balance", drop column "reference_transaction_id", drop column "reference_external_transaction_id", drop column "round_id", drop column "amount", drop column "currency", drop column "player_id", drop column "wallet_id";`);
  }
}
