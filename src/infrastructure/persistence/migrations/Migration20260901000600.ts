import { Migration } from "@mikro-orm/migrations";

export class Migration20260901000600 extends Migration {
  public override async up(): Promise<void> {
    this.addSql(`alter table "wager_transactions"
      add column if not exists "game_id" varchar(255) null;`);
  }


  public override async down(): Promise<void> {
    this.addSql(
      'alter table "wager_transactions" drop column if exists "game_id";',
    );
  }
}
