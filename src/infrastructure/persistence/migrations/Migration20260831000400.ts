import { Migration } from "@mikro-orm/migrations";

export class Migration20260831000400 extends Migration {
  public override async up(): Promise<void> {
    this.addSql(`alter table "wager_transactions"
      add column "reference_attempt_count" integer not null default 0,
      add column "next_reference_attempt_at" timestamptz null,
      add column "reference_lease_until" timestamptz null,
      add constraint "wager_transactions_reference_attempt_nonnegative" check ("reference_attempt_count" >= 0);`);
    this.addSql(`create index "wager_transactions_pending_reference_index"
      on "wager_transactions" ("next_reference_attempt_at") where "status" = 'PENDING_REFERENCE';`);
  }

  public override async down(): Promise<void> {
    this.addSql(
      'drop index if exists "wager_transactions_pending_reference_index";',
    );
    this.addSql(
      'alter table "wager_transactions" drop constraint if exists "wager_transactions_reference_attempt_nonnegative";',
    );
    this.addSql(
      'alter table "wager_transactions" drop column "reference_lease_until", drop column "next_reference_attempt_at", drop column "reference_attempt_count";',
    );
  }
}
