import { Migration } from "@mikro-orm/migrations";

export class Migration20260831000000 extends Migration {
  public override async up(): Promise<void> {
    this.addSql('create table "application_metadata" ("key" varchar(100) not null, "value" varchar(255) not null, "created_at" timestamptz not null default now(), constraint "application_metadata_pkey" primary key ("key"));');
  }

  public override async down(): Promise<void> {
    this.addSql('drop table if exists "application_metadata";');
  }
}
