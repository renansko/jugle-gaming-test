import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/core";

@Entity({ tableName: "wallets" })
@Unique({ properties: ["playerId", "currency"] })
export class WalletEntity {
  @PrimaryKey({ type: "uuid" }) id!: string;
  @Property({ fieldName: "player_id", length: 128 }) playerId!: string;
  @Property({ length: 3 }) currency!: string;
  @Property({ columnType: "numeric(20,2)" }) balance!: string;
  @Property() version!: number;
  @Property({ fieldName: "created_at" }) createdAt!: Date;
  @Property({ fieldName: "updated_at" }) updatedAt!: Date;
}
