import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/core";

@Entity({ tableName: "inbox_messages" })
@Unique({ properties: ["consumerName", "messageId"] })
export class InboxMessageEntity {
  @PrimaryKey({ type: "uuid" }) id!: string;
  @Property({ fieldName: "consumer_name", length: 100 }) consumerName!: string;
  @Property({ fieldName: "message_id", length: 255 }) messageId!: string;
  @Property({ fieldName: "payload_hash", length: 64 }) payloadHash!: string;
  @Property({ fieldName: "processed_at" }) processedAt!: Date;
}
