import { Injectable, Inject } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import { randomUUID } from "node:crypto";
import { DomainError } from "../../domain/shared/domain-error";
import { Money } from "../../domain/shared/money";
import { Wallet } from "../../domain/wallet/wallet";
import { WalletLedgerEntryEntity } from "../../infrastructure/persistence/entities/wallet-ledger-entry.entity";
import { WagerTransactionEntity } from "../../infrastructure/persistence/entities/wager-transaction.entity";
import { WalletEntity } from "../../infrastructure/persistence/entities/wallet.entity";

export type LedgerPage = { items: Array<{ id: string; direction: string; amount: string; currency: string; balanceBefore: string; balanceAfter: string; createdAt: Date }>; nextCursor?: string };

/** @wiki docs/brain/functions/WageringService.md */
@Injectable()
export class WalletService {
  public constructor(@Inject(MikroORM) private readonly orm: MikroORM) {}

  public async create(input: { playerId: string; currency: string; initialBalance?: string }): Promise<WalletEntity> {
    const initialBalance = Money.create(input.initialBalance ?? "0", input.currency);
    try {
      return await this.orm.em.transactional(async (em) => {
        const wallet = Wallet.open({ id: randomUUID(), playerId: input.playerId, currency: input.currency, initialBalance });
        const walletEntity = em.create(WalletEntity, {
          id: wallet.id, playerId: wallet.playerId, currency: wallet.currency, balance: wallet.balance.amount,
          version: wallet.version, createdAt: wallet.createdAt, updatedAt: wallet.updatedAt,
        });
        if (!initialBalance.isZero()) {
          const transaction = em.create(WagerTransactionEntity, {
            id: randomUUID(), idempotencyKey: `opening:${wallet.id}`, providerId: "INTERNAL", externalTransactionId: wallet.id,
            payloadHash: "OPENING", kind: "OPENING", status: "PROCESSED", createdAt: wallet.createdAt, updatedAt: wallet.updatedAt,
          });
          const entry = {
            id: randomUUID(), walletId: wallet.id, transactionId: transaction.id, direction: "CREDIT",
            amount: initialBalance.amount, currency: initialBalance.currency, balanceBefore: "0.00", balanceAfter: initialBalance.amount, createdAt: wallet.createdAt,
          };
          em.persist([transaction, em.create(WalletLedgerEntryEntity, entry)]);
        }
        await em.persistAndFlush(walletEntity);
        return walletEntity;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new DomainError("WALLET_ALREADY_EXISTS", "Wallet already exists for player and currency");
      throw error;
    }
  }

  public async get(id: string): Promise<WalletEntity | null> { return this.orm.em.fork().findOne(WalletEntity, { id }); }

  public async ledger(walletId: string, cursor: string | undefined, limit: number): Promise<LedgerPage> {
    const pageSize = Math.min(Math.max(limit, 1), 100);
    const decoded = cursor ? this.decodeCursor(cursor) : undefined;
    const rows = await this.orm.em.fork().getConnection().execute<Array<WalletLedgerEntryEntity>>(
      `select id, direction, amount::text as amount, currency, balance_before::text as "balanceBefore", balance_after::text as "balanceAfter", created_at as "createdAt"
       from wallet_ledger_entries where wallet_id = ? and (? is null or (created_at, id) < (?::timestamptz, ?::uuid))
       order by created_at desc, id desc limit ?`,
      [walletId, decoded?.createdAt ?? null, decoded?.createdAt ?? null, decoded?.id ?? null, pageSize + 1],
    );
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize);
    const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? this.encodeCursor(last.createdAt, last.id) : undefined };
  }

  private encodeCursor(createdAt: Date, id: string): string { return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url"); }
  private decodeCursor(cursor: string): { createdAt: string; id: string } {
    try {
      const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (typeof value !== "object" || value === null || !("createdAt" in value) || !("id" in value) || typeof value.createdAt !== "string" || typeof value.id !== "string" || Number.isNaN(Date.parse(value.createdAt))) throw new Error();
      return { createdAt: value.createdAt, id: value.id };
    } catch { throw new DomainError("INVALID_CURSOR", "Cursor is invalid"); }
  }
  private isUniqueViolation(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "23505"; }
}
