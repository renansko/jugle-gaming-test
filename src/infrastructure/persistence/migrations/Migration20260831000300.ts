import { Migration } from "@mikro-orm/migrations";

export class Migration20260831000300 extends Migration {
  public override async up(): Promise<void> {
    this.addSql(
      `create table "inbox_messages" ("id" uuid not null, "consumer_name" varchar(100) not null, "message_id" varchar(255) not null, "payload_hash" char(64) not null, "processed_at" timestamptz not null, constraint "inbox_messages_pkey" primary key ("id"), constraint "inbox_messages_consumer_message_unique" unique ("consumer_name", "message_id"));`,
    );
    this.addSql(
      `create table "outbox_messages" ("id" uuid not null, "event_type" varchar(100) not null, "payload" jsonb not null, "attempt_count" integer not null default 0, "next_attempt_at" timestamptz not null, "lease_until" timestamptz null, "published_at" timestamptz null, "created_at" timestamptz not null, constraint "outbox_messages_pkey" primary key ("id"), constraint "outbox_messages_attempt_nonnegative" check ("attempt_count" >= 0));`,
    );
    this.addSql(
      'create index "outbox_messages_pending_index" on "outbox_messages" ("next_attempt_at") where "published_at" is null;',
    );
  }
  public override async down(): Promise<void> {
    this.addSql('drop table if exists "outbox_messages";');
    this.addSql('drop table if exists "inbox_messages";');
  }
}
