import { Inject, Injectable } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import { randomUUID } from "node:crypto";
import { DomainError } from "../../domain/shared/domain-error";
import { Money } from "../../domain/shared/money";
import { Wallet } from "../../domain/wallet/wallet";
import { WalletLedgerEntryEntity } from "../../infrastructure/persistence/entities/wallet-ledger-entry.entity";
import { WagerTransactionEntity } from "../../infrastructure/persistence/entities/wager-transaction.entity";
import { WalletEntity } from "../../infrastructure/persistence/entities/wallet.entity";

export interface LedgerPageItem {
  id: string;
  direction: string;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
  createdAt: Date;
}

export interface LedgerPage {
  items: LedgerPageItem[];
  nextCursor?: string;
}

export interface CreateWalletInput {
  playerId: string;
  currency: string;
  initialBalance?: string;
}

interface DecodedCursor {
  createdAt: string;
  id: string;
}

/** @wiki docs/brain/functions/WageringService.md */
@Injectable()
export class WalletService {
  public constructor(
    @Inject(MikroORM)
    private readonly orm: MikroORM,
  ) {}

  public async create(input: CreateWalletInput): Promise<WalletEntity> {
    const initialBalance = Money.create(
      input.initialBalance ?? "0",
      input.currency,
    );

    try {
      return await this.orm.em.transactional(async (entityManager) => {
        const wallet = Wallet.open({
          id: randomUUID(),
          playerId: input.playerId,
          currency: input.currency,
          initialBalance,
        });

        const walletEntity = entityManager.create(WalletEntity, {
          id: wallet.id,
          playerId: wallet.playerId,
          currency: wallet.currency,
          balance: wallet.balance.amount,
          version: wallet.version,
          createdAt: wallet.createdAt,
          updatedAt: wallet.updatedAt,
        });

        entityManager.persist(walletEntity);

        if (!initialBalance.isZero()) {
          const openingTransaction = entityManager.create(
            WagerTransactionEntity,
            {
              id: randomUUID(),
              idempotencyKey: `opening:${wallet.id}`,
              providerId: "INTERNAL",
              externalTransactionId: wallet.id,
              payloadHash: "OPENING",
              kind: "OPENING",
              status: "PROCESSED",
              createdAt: wallet.createdAt,
              updatedAt: wallet.updatedAt,
            },
          );

          entityManager.persist(openingTransaction);
          await entityManager.flush();

          const initialLedgerEntry = entityManager.create(
            WalletLedgerEntryEntity,
            {
              id: randomUUID(),
              walletId: wallet.id,
              transactionId: openingTransaction.id,
              direction: "CREDIT",
              amount: initialBalance.amount,
              currency: initialBalance.currency,
              balanceBefore: "0.00",
              balanceAfter: initialBalance.amount,
              createdAt: wallet.createdAt,
            },
          );

          entityManager.persist(initialLedgerEntry);
        }

        await entityManager.flush();
        return walletEntity;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new DomainError(
          "WALLET_ALREADY_EXISTS",
          "Wallet already exists for player and currency",
        );
      }
      throw error;
    }
  }

  public async get(id: string): Promise<WalletEntity | null> {
    const isolatedEntityManager = this.orm.em.fork();
    return isolatedEntityManager.findOne(WalletEntity, { id });
  }

  private buildLedgerParameters(
    walletId: string,
    decodedCursor: DecodedCursor | undefined,
    pageSize: number,
  ): unknown[] {
    const cursorDate = decodedCursor ? decodedCursor.createdAt : null;
    const cursorId = decodedCursor ? decodedCursor.id : null;
    return [walletId, cursorDate, cursorDate, cursorId, pageSize + 1];
  }

  private buildNextCursor(
    hasMoreItems: boolean,
    lastItem?: WalletLedgerEntryEntity,
  ): string | undefined {
    if (!hasMoreItems || !lastItem) {
      return undefined;
    }
    return this.encodeCursor(lastItem.createdAt, lastItem.id);
  }

  public async ledger(
    walletId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<LedgerPage> {
    const pageSize = Math.min(Math.max(limit, 1), 100);
    const decodedCursor = cursor ? this.decodeCursor(cursor) : undefined;

    const query = `
      SELECT
        id,
        direction,
        amount::text as amount,
        currency,
        balance_before::text as "balanceBefore",
        balance_after::text as "balanceAfter",
        created_at as "createdAt"
      FROM wallet_ledger_entries
      WHERE wallet_id = ?
        AND (? is null OR (created_at, id) < (?::timestamptz, ?::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `;

    const parameters = this.buildLedgerParameters(
      walletId,
      decodedCursor,
      pageSize,
    );

    const rows = await this.orm.em
      .fork()
      .getConnection()
      .execute<Array<WalletLedgerEntryEntity>>(query, parameters);

    const hasMoreItems = rows.length > pageSize;
    const items = rows.slice(0, pageSize);
    const nextCursor = this.buildNextCursor(hasMoreItems, items.at(-1));

    return {
      items,
      nextCursor,
    };
  }

  private encodeCursor(createdAt: Date | string, id: string): string {
    const payload = {
      createdAt: new Date(createdAt).toISOString(),
      id,
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64url");
  }

  private validateCursorRecord(parsed: unknown): DecodedCursor {
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Cursor payload must be an object");
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.createdAt !== "string" || typeof record.id !== "string") {
      throw new Error("Cursor missing required fields");
    }
    if (Number.isNaN(Date.parse(record.createdAt))) {
      throw new Error("Invalid field types in cursor");
    }
    return {
      createdAt: record.createdAt,
      id: record.id,
    };
  }

  private decodeCursor(cursor: string): DecodedCursor {
    try {
      const jsonString = Buffer.from(cursor, "base64url").toString("utf8");
      return this.validateCursorRecord(JSON.parse(jsonString));
    } catch {
      throw new DomainError("INVALID_CURSOR", "Cursor is invalid");
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    );
  }
}
