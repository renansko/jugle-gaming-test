import { randomUUID } from "node:crypto";
import {
  SQSClient,
  SendMessageBatchCommand,
  type SendMessageBatchCommandOutput,
} from "@aws-sdk/client-sqs";
import { type EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { AppConfig } from "../config/app-config";
import { OperationalMetrics } from "../observability/operational-metrics";
import { OutboxMessageEntity } from "../persistence/entities/outbox-message.entity";

export interface PublishBatchResult {
  published: number;
  retried: number;
}

interface ClaimedOutboxMessage {
  id: string;
  lease_token: string;
}

interface OutboxClaim {
  ids: string[];
  leaseToken: string;
}

/** @wiki docs/brain/services/MessagingWorkers.md */
@Injectable()
export class OutboxPublisher {
  private readonly client: SQSClient;

  public constructor(
    @Inject(AppConfig)
    private readonly config: AppConfig,
    @Inject(MikroORM)
    private readonly orm: MikroORM,
    @Inject(OperationalMetrics)
    private readonly metrics: OperationalMetrics,
    @Optional() clientOverride?: SQSClient,
  ) {
    this.client =
      clientOverride ??
      new SQSClient({
        region: config.awsRegion,
        endpoint: config.sqsEndpoint,
        credentials: {
          accessKeyId: config.awsAccessKeyId,
          secretAccessKey: config.awsSecretAccessKey,
        },
      });
  }

  public async publishBatch(limit = 10): Promise<PublishBatchResult> {
    const entityManager = this.orm.em.fork();
    const claim = await this.claimBatch(entityManager, limit);
    const messages = await this.loadClaimedMessages(entityManager, claim);

    if (messages.length === 0) {
      await this.updateGauges(entityManager);
      return { published: 0, retried: 0 };
    }

    const batchEntries = messages.map((message) => ({
      Id: message.id,
      MessageBody: JSON.stringify(message.payload),
      MessageGroupId: this.messageGroupId(message),
      MessageDeduplicationId: message.id,
    }));

    let sendResponse: SendMessageBatchCommandOutput;
    try {
      sendResponse = await this.client.send(
        new SendMessageBatchCommand({
          QueueUrl: this.config.eventQueueUrl,
          Entries: batchEntries,
        }),
      );
    } catch {
      await this.finalizeFailedMessages(
        entityManager,
        messages,
        claim.leaseToken,
      );
      await this.updateGauges(entityManager);
      this.metrics.increment("outbox_retries_total", {
        status: "transport_error",
      });
      return { published: 0, retried: messages.length };
    }

    const successfulIds = new Set(
      (sendResponse.Successful ?? []).map((entry) => entry.Id),
    );
    const successfulMessages = messages.filter((message) =>
      successfulIds.has(message.id),
    );
    const failedMessages = messages.filter(
      (message) => !successfulIds.has(message.id),
    );

    await this.finalizePublishedMessages(
      entityManager,
      successfulMessages,
      claim.leaseToken,
    );
    await this.finalizeFailedMessages(
      entityManager,
      failedMessages,
      claim.leaseToken,
    );
    await this.updateGauges(entityManager);

    if (successfulMessages.length > 0) {
      this.metrics.increment("outbox_published_total", { status: "published" });
    }
    if (failedMessages.length > 0) {
      this.metrics.increment("outbox_retries_total", { status: "retry" });
    }

    return {
      published: successfulMessages.length,
      retried: failedMessages.length,
    };
  }

  public stop(): void {
    this.client.destroy();
  }

  private async claimBatch(
    entityManager: EntityManager,
    limit: number,
  ): Promise<OutboxClaim> {
    const leaseToken = randomUUID();
    const leaseUntil = new Date(Date.now() + 60_000);
    const claimQuery = `
      WITH claimed AS (
        SELECT id
        FROM outbox_messages
        WHERE published_at IS NULL
          AND next_attempt_at <= NOW()
          AND (lease_until IS NULL OR lease_until < NOW())
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ?
      )
      UPDATE outbox_messages outbox_alias
      SET lease_until = ?, lease_token = ?
      FROM claimed
      WHERE outbox_alias.id = claimed.id
      RETURNING outbox_alias.id, outbox_alias.lease_token
    `;

    const claimedRows = await entityManager.transactional(
      (transactionManager) =>
        transactionManager
          .getConnection()
          .execute<ClaimedOutboxMessage[]>(claimQuery, [
            limit,
            leaseUntil,
            leaseToken,
          ]),
    );

    return {
      ids: claimedRows.map((row) => row.id),
      leaseToken,
    };
  }

  private async loadClaimedMessages(
    entityManager: EntityManager,
    claim: OutboxClaim,
  ): Promise<OutboxMessageEntity[]> {
    if (claim.ids.length === 0) {
      return [];
    }
    return entityManager.find(OutboxMessageEntity, {
      id: { $in: claim.ids },
      leaseToken: claim.leaseToken,
    });
  }

  private messageGroupId(message: OutboxMessageEntity): string {
    const messageData = message.payload.data as
      | { walletId?: string }
      | undefined;
    return String(
      messageData?.walletId ?? message.payload.aggregateId ?? message.id,
    );
  }

  private async finalizePublishedMessages(
    entityManager: EntityManager,
    messages: OutboxMessageEntity[],
    leaseToken: string,
  ): Promise<void> {
    await entityManager.transactional(async (transactionManager) => {
      for (const message of messages) {
        await transactionManager.getConnection().execute(
          `UPDATE outbox_messages
           SET published_at = NOW(), lease_until = NULL, lease_token = NULL
           WHERE id = ? AND lease_token = ? AND published_at IS NULL`,
          [message.id, leaseToken],
        );
      }
    });
  }

  private async finalizeFailedMessages(
    entityManager: EntityManager,
    messages: OutboxMessageEntity[],
    leaseToken: string,
  ): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    await entityManager.transactional(async (transactionManager) => {
      for (const message of messages) {
        const nextAttemptAt = this.nextAttemptAt(message.attemptCount);
        await transactionManager.getConnection().execute(
          `UPDATE outbox_messages
           SET attempt_count = attempt_count + 1,
               next_attempt_at = ?, lease_until = NULL, lease_token = NULL
           WHERE id = ? AND lease_token = ? AND published_at IS NULL`,
          [nextAttemptAt, message.id, leaseToken],
        );
      }
    });
  }

  private nextAttemptAt(attemptCount: number): Date {
    const baseDelayMs = 1000 * 2 ** Math.min(attemptCount + 1, 8);
    const jitterMs = Math.floor(Math.random() * 1000);
    return new Date(Date.now() + Math.min(300_000, baseDelayMs + jitterMs));
  }

  private async updateGauges(entityManager: EntityManager): Promise<void> {
    const query = `
      SELECT
        COUNT(*)::text AS pending,
        COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) * 1000, 0)::text AS "lagMs"
      FROM outbox_messages
      WHERE published_at IS NULL
    `;
    const rows = await entityManager
      .getConnection()
      .execute<Array<{ pending: string; lagMs: string }>>(query);
    this.metrics.set("outbox_pending", Number(rows[0]?.pending ?? 0));
    this.metrics.set("outbox_lag_ms", Number(rows[0]?.lagMs ?? 0));
  }
}
