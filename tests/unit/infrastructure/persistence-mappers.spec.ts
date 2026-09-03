import { describe, expect, test } from "bun:test";
import { Money } from "../../../src/domain/shared/money";
import { WagerTransaction } from "../../../src/domain/wagering/wager-transaction";
import { Wallet } from "../../../src/domain/wallet/wallet";
import { WalletLedgerEntry } from "../../../src/domain/wallet/wallet-ledger-entry";
import { InboxMessage } from "../../../src/domain/messaging/inbox-message";
import { OutboxMessage } from "../../../src/domain/messaging/outbox-message";
import { WagerTransactionEntity } from "../../../src/infrastructure/persistence/entities/wager-transaction.entity";
import { WalletEntity } from "../../../src/infrastructure/persistence/entities/wallet.entity";
import { WalletLedgerEntryEntity } from "../../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity";
import { InboxMessageEntity } from "../../../src/infrastructure/persistence/entities/inbox-message.entity";
import { OutboxMessageEntity } from "../../../src/infrastructure/persistence/entities/outbox-message.entity";
import {
  wagerTransactionToDomain,
  wagerTransactionToPersistence,
} from "../../../src/infrastructure/persistence/mappers/wager-transaction.mapper";
import {
  walletToDomain,
  walletToPersistence,
} from "../../../src/infrastructure/persistence/mappers/wallet.mapper";
import {
  inboxMessageToDomain,
  inboxMessageToPersistence,
} from "../../../src/infrastructure/persistence/mappers/inbox-message.mapper";
import {
  outboxMessageToDomain,
  outboxMessageToPersistence,
} from "../../../src/infrastructure/persistence/mappers/outbox-message.mapper";
import {
  walletLedgerEntryToDomain,
  walletLedgerEntryToPersistence,
} from "../../../src/infrastructure/persistence/mappers/wallet-ledger-entry.mapper";

describe("Persistence Mappers (Issue #18)", () => {
  describe("WagerTransaction Mapper", () => {
    test("maps WagerTransactionEntity to domain and back to entity", () => {
      const entity = new WagerTransactionEntity();
      entity.id = "tx-123";
      entity.idempotencyKey = "key-123";
      entity.providerId = "prov-1";
      entity.externalTransactionId = "ext-1";
      entity.payloadHash = "hash-1";
      entity.walletId = "wall-1";
      entity.playerId = "play-1";
      entity.currency = "BRL";
      entity.amount = "50.00";
      entity.kind = "BET";
      entity.roundId = "round-1";
      entity.gameId = "game-1";
      entity.status = "PROCESSED";
      entity.failureCode = undefined;
      entity.observedBalance = "100.00";
      entity.referenceAttemptCount = 0;
      entity.createdAt = new Date("2026-09-02T20:00:00Z");
      entity.updatedAt = new Date("2026-09-02T20:01:00Z");

      const domain = wagerTransactionToDomain(entity);
      expect(domain.id).toBe("tx-123");
      expect(domain.status).toBe("PROCESSED");
      expect(domain.money?.amount).toBe("50.00");
      expect(domain.observedBalance?.amount).toBe("100.00");

      const targetEntity = new WagerTransactionEntity();
      const mappedBack = wagerTransactionToPersistence(domain, targetEntity);
      expect(mappedBack.id).toBe("tx-123");
      expect(mappedBack.status).toBe("PROCESSED");
      expect(mappedBack.amount).toBe("50.00");
      expect(mappedBack.observedBalance).toBe("100.00");
    });
  });

  describe("Wallet Mapper", () => {
    test("maps Wallet to persistence correctly", () => {
      const domain = Wallet.open({
        id: "wall-1",
        playerId: "play-1",
        currency: "BRL",
        initialBalance: Money.create("200.00", "BRL"),
      });

      const entity = walletToPersistence(domain);
      expect(entity.id).toBe("wall-1");
      expect(entity.playerId).toBe("play-1");
      expect(entity.currency).toBe("BRL");
      expect(entity.balance).toBe("200.00");
      expect(entity.version).toBe(1);

      const domainAgain = walletToDomain(entity);
      expect(domainAgain.balance.amount).toBe("200.00");
    });
  });

  describe("InboxMessage Mapper", () => {
    test("maps InboxMessageEntity to domain and back to entity", () => {
      const entity = new InboxMessageEntity();
      entity.id = "in-1";
      entity.consumerName = "SqsWagerConsumer";
      entity.messageId = "msg-99";
      entity.payloadHash = "hash-99";
      entity.processedAt = new Date("2026-09-02T21:00:00Z");

      const domain = inboxMessageToDomain(entity);
      expect(domain.id).toBe("in-1");
      expect(domain.hasSamePayload("hash-99")).toBe(true);

      const mappedBack = inboxMessageToPersistence(domain);
      expect(mappedBack.id).toBe("in-1");
      expect(mappedBack.consumerName).toBe("SqsWagerConsumer");
      expect(mappedBack.messageId).toBe("msg-99");
      expect(mappedBack.payloadHash).toBe("hash-99");
      expect(mappedBack.processedAt).toEqual(entity.processedAt);
    });
  });

  describe("OutboxMessage Mapper", () => {
    test("maps OutboxMessageEntity to domain and back to entity", () => {
      const entity = new OutboxMessageEntity();
      entity.id = "out-1";
      entity.eventType = "WagerTransactionProcessed.v1";
      entity.payload = { foo: "bar" };
      entity.attemptCount = 1;
      entity.nextAttemptAt = new Date("2026-09-02T22:00:00Z");
      entity.leaseUntil = new Date("2026-09-02T22:01:00Z");
      entity.leaseToken = "token-xyz";
      entity.publishedAt = undefined;
      entity.createdAt = new Date("2026-09-02T21:59:00Z");

      const domain = outboxMessageToDomain(entity);
      expect(domain.id).toBe("out-1");
      expect(domain.eventType).toBe("WagerTransactionProcessed.v1");
      expect(domain.leaseToken).toBe("token-xyz");

      const mappedBack = outboxMessageToPersistence(domain);
      expect(mappedBack.id).toBe("out-1");
      expect(mappedBack.leaseToken).toBe("token-xyz");
      expect(mappedBack.attemptCount).toBe(1);
    });
  });

  describe("WalletLedgerEntry Mapper", () => {
    test("maps WalletLedgerEntry to persistence entity and back", () => {
      const entry = WalletLedgerEntry.create({
        id: "entry-1",
        walletId: "wall-1",
        transactionId: "tx-1",
        direction: "CREDIT",
        money: Money.create("50.00", "BRL"),
        balanceBefore: Money.create("100.00", "BRL"),
        balanceAfter: Money.create("150.00", "BRL"),
      });

      const entity = walletLedgerEntryToPersistence(entry);
      expect(entity.id).toBe("entry-1");
      expect(entity.walletId).toBe("wall-1");
      expect(entity.direction).toBe("CREDIT");
      expect(entity.amount).toBe("50.00");
      expect(entity.balanceBefore).toBe("100.00");
      expect(entity.balanceAfter).toBe("150.00");

      const domainAgain = walletLedgerEntryToDomain(entity);
      expect(domainAgain.id).toBe("entry-1");
      expect(domainAgain.money.amount).toBe("50.00");
      expect(domainAgain.balanceAfter.amount).toBe("150.00");
    });
  });
});
