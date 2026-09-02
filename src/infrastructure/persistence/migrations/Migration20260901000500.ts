import { Migration } from "@mikro-orm/migrations";

export class Migration20260901000500 extends Migration {
  public override async up(): Promise<void> {
    this.addSql(
      'alter table "outbox_messages" add column "lease_token" uuid null;',
    );
  }

  public override async down(): Promise<void> {
    this.addSql(
      'alter table "outbox_messages" drop column if exists "lease_token";',
    );
  }
}
