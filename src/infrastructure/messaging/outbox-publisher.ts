import {
  SendMessageBatchCommand,
  type SendMessageBatchCommandOutput,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { Inject, Injectable } from "@nestjs/common";
import { AppConfig } from "../config/app-config";
import { type EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { OutboxMessageEntity } from "../persistence/entities/outbox-message.entity";
import { OperationalMetrics } from "../observability/operational-metrics";

export interface PublishBatchResult {
  published: number;
  retried: number;
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
  ) {
    this.client = new SQSClient({
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
      SET lease_until = ?
      FROM claimed
      WHERE outbox_alias.id = claimed.id
      RETURNING outbox_alias.id
    `;

    const claimedRows = await entityManager
      .getConnection()
      .execute<{ id: string }[]>(claimQuery, [limit, leaseUntil]);
    const claimedIds = claimedRows.map((row) => row.id);

    const messages = await entityManager.find(OutboxMessageEntity, {
      id: { $in: claimedIds },
    });

    if (messages.length === 0) {
      await this.updateGauges(entityManager);
      return { published: 0, retried: 0 };
    }

    const batchEntries = messages.map((message) => {
      const messageData = message.payload.data as
        | { walletId?: string }
        | undefined;
      const messageGroupId = String(
        messageData?.walletId ?? message.payload.aggregateId ?? message.id,
      );

      return {
        Id: message.id,
        MessageBody: JSON.stringify(message.payload),
        MessageGroupId: messageGroupId,
        MessageDeduplicationId: message.id,
      };
    });

    let sendResponse: SendMessageBatchCommandOutput;

    try {
      sendResponse = await this.client.send(
        new SendMessageBatchCommand({
          QueueUrl: this.config.eventQueueUrl,
          Entries: batchEntries,
        }),
      );
    } catch {
      for (const message of messages) {
        this.reschedule(message);
      }
      await entityManager.flush();
      await this.updateGauges(entityManager);
      this.metrics.increment("outbox_retries_total", {
        status: "transport_error",
      });
      return { published: 0, retried: messages.length };
    }

    const successfulIds = new Set(
      (sendResponse.Successful ?? []).map((entry) => entry.Id),
    );

    for (const message of messages) {
      if (successfulIds.has(message.id)) {
        message.publishedAt = new Date();
        message.leaseUntil = undefined;
      } else {
        this.reschedule(message);
      }
    }

    await entityManager.flush();
    await this.updateGauges(entityManager);

    const publishedCount = successfulIds.size;
    const retriedCount = messages.length - publishedCount;

    if (publishedCount > 0) {
      this.metrics.increment("outbox_published_total", { status: "published" });
    }

    if (retriedCount > 0) {
      this.metrics.increment("outbox_retries_total", { status: "retry" });
    }

    return {
      published: publishedCount,
      retried: retriedCount,
    };
  }

  public stop(): void {
    this.client.destroy();
  }

  private reschedule(message: OutboxMessageEntity): void {
    message.attemptCount += 1;
    message.leaseUntil = undefined;

    const baseDelayMs = 1000 * 2 ** message.attemptCount;
    const jitterMs = Math.floor(Math.random() * 1000);
    const delayMs = Math.min(300_000, baseDelayMs + jitterMs);

    message.nextAttemptAt = new Date(Date.now() + delayMs);
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

    const pendingCount = Number(rows[0]?.pending ?? 0);
    const lagMilliseconds = Number(rows[0]?.lagMs ?? 0);

    this.metrics.set("outbox_pending", pendingCount);
    this.metrics.set("outbox_lag_ms", lagMilliseconds);
  }
}
