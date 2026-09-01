import { Migration } from "@mikro-orm/migrations";

export class Migration20260831000100 extends Migration {
  public override async up(): Promise<void> {
    this.addSql(`create table "wallets" (
      "id" uuid not null, "player_id" varchar(128) not null, "currency" char(3) not null,
      "balance" numeric(20,2) not null, "version" integer not null, "created_at" timestamptz not null,
      "updated_at" timestamptz not null, constraint "wallets_pkey" primary key ("id"),
      constraint "wallets_player_currency_unique" unique ("player_id", "currency"),
      constraint "wallets_balance_non_negative" check ("balance" >= 0),
      constraint "wallets_version_positive" check ("version" >= 1),
      constraint "wallets_currency_format" check ("currency" ~ '^[A-Z]{3}$')
    );`);
    this.addSql(`create table "wager_transactions" (
      "id" uuid not null, "idempotency_key" varchar(255) not null, "provider_id" varchar(128) not null,
      "external_transaction_id" varchar(255) not null, "payload_hash" char(64) not null, "kind" varchar(24) not null,
      "status" varchar(24) not null, "failure_code" varchar(64) null, "created_at" timestamptz not null, "updated_at" timestamptz not null,
      constraint "wager_transactions_pkey" primary key ("id"), constraint "wager_transactions_idempotency_unique" unique ("idempotency_key"),
      constraint "wager_transactions_provider_external_unique" unique ("provider_id", "external_transaction_id"),
      constraint "wager_transactions_kind_valid" check ("kind" in ('BET','WIN','LOSS','REFUND','ROLLBACK','OPENING')),
      constraint "wager_transactions_status_valid" check ("status" in ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED'))
    );`);
    this.addSql(`create table "wallet_ledger_entries" (
      "id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" varchar(6) not null,
      "amount" numeric(20,2) not null, "currency" char(3) not null, "balance_before" numeric(20,2) not null,
      "balance_after" numeric(20,2) not null, "created_at" timestamptz not null, constraint "wallet_ledger_entries_pkey" primary key ("id"),
      constraint "wallet_ledger_entries_wallet_transaction_unique" unique ("wallet_id", "transaction_id"),
      constraint "wallet_ledger_entries_wallet_fk" foreign key ("wallet_id") references "wallets" ("id"),
      constraint "wallet_ledger_entries_transaction_fk" foreign key ("transaction_id") references "wager_transactions" ("id"),
      constraint "wallet_ledger_entries_direction_valid" check ("direction" in ('CREDIT','DEBIT')),
      constraint "wallet_ledger_entries_values_non_negative" check ("amount" > 0 and "balance_before" >= 0 and "balance_after" >= 0),
      constraint "wallet_ledger_entries_currency_format" check ("currency" ~ '^[A-Z]{3}$'),
      constraint "wallet_ledger_entries_reconciles" check (("direction" = 'CREDIT' and "balance_after" = "balance_before" + "amount") or ("direction" = 'DEBIT' and "balance_after" = "balance_before" - "amount"))
    );`);
    this.addSql(
      'create index "wallet_ledger_entries_wallet_created_id_index" on "wallet_ledger_entries" ("wallet_id", "created_at" desc, "id" desc);',
    );
    this.addSql(
      `create function prevent_wallet_ledger_mutation() returns trigger language plpgsql as $$ begin raise exception 'wallet ledger is append-only'; end; $$;`,
    );
    this.addSql(
      'create trigger "wallet_ledger_entries_immutable" before update or delete on "wallet_ledger_entries" for each row execute function prevent_wallet_ledger_mutation();',
    );
  }

  public override async down(): Promise<void> {
    this.addSql(
      'drop trigger if exists "wallet_ledger_entries_immutable" on "wallet_ledger_entries";',
    );
    this.addSql("drop function if exists prevent_wallet_ledger_mutation();");
    this.addSql('drop table if exists "wallet_ledger_entries";');
    this.addSql('drop table if exists "wager_transactions";');
    this.addSql('drop table if exists "wallets";');
  }
}
