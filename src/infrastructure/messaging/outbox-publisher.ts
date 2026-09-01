import { SendMessageBatchCommand, type SendMessageBatchCommandOutput, SQSClient } from "@aws-sdk/client-sqs";
import { Injectable, Inject } from "@nestjs/common";
import { AppConfig } from "../config/app-config";
import { type EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { OutboxMessageEntity } from "../persistence/entities/outbox-message.entity";
import { OperationalMetrics } from "../observability/operational-metrics";

/** @wiki docs/brain/services/MessagingWorkers.md */
@Injectable()
export class OutboxPublisher {
  private readonly client: SQSClient;
  public constructor(@Inject(AppConfig) private readonly config: AppConfig, @Inject(MikroORM) private readonly orm: MikroORM, @Inject(OperationalMetrics) private readonly metrics: OperationalMetrics) { this.client = new SQSClient({ region: config.awsRegion, endpoint: config.sqsEndpoint, credentials: { accessKeyId: config.awsAccessKeyId, secretAccessKey: config.awsSecretAccessKey } }); }
  public async publishBatch(limit = 10): Promise<{ published: number; retried: number }> {
    const em = this.orm.em.fork();
    const leaseUntil = new Date(Date.now() + 60_000);
    const rows = await em.getConnection().execute<{ id: string }[]>("with claimed as (select id from outbox_messages where published_at is null and next_attempt_at <= now() and (lease_until is null or lease_until < now()) order by created_at for update skip locked limit ?) update outbox_messages o set lease_until = ? from claimed where o.id = claimed.id returning o.id", [limit, leaseUntil]);
    const messages = await em.find(OutboxMessageEntity, { id: { $in: rows.map((row) => row.id) } });
    if (!messages.length) { await this.updateGauges(em); return { published: 0, retried: 0 }; }
    let sent: SendMessageBatchCommandOutput;
    try {
      sent = await this.client.send(new SendMessageBatchCommand({ QueueUrl: this.config.eventQueueUrl, Entries: messages.map((message) => ({ Id: message.id, MessageBody: JSON.stringify(message.payload), MessageGroupId: String((message.payload.data as { walletId?: string } | undefined)?.walletId ?? message.payload.aggregateId ?? message.id), MessageDeduplicationId: message.id })) }));
    } catch {
      for (const message of messages) this.reschedule(message);
      await em.flush();
      await this.updateGauges(em);
      this.metrics.increment("outbox_retries_total", { status: "transport_error" });
      return { published: 0, retried: messages.length };
    }
    const successful = new Set((sent.Successful ?? []).map((entry) => entry.Id));
    for (const message of messages) { if (successful.has(message.id)) { message.publishedAt = new Date(); message.leaseUntil = undefined; } else this.reschedule(message); }
    await em.flush();
    await this.updateGauges(em);
    if (successful.size) this.metrics.increment("outbox_published_total", { status: "published" });
    if (messages.length - successful.size) this.metrics.increment("outbox_retries_total", { status: "retry" });
    return { published: successful.size, retried: messages.length - successful.size };
  }

  public stop(): void { this.client.destroy(); }

  private reschedule(message: OutboxMessageEntity): void {
    message.attemptCount += 1;
    message.leaseUntil = undefined;
    message.nextAttemptAt = new Date(Date.now() + Math.min(300_000, 1000 * 2 ** message.attemptCount + Math.floor(Math.random() * 1000)));
  }

  private async updateGauges(em: EntityManager): Promise<void> {
    const rows = await em.getConnection().execute<Array<{ pending: string; lagMs: string }>>(
      `select count(*)::text as pending,
       coalesce(extract(epoch from (now() - min(created_at))) * 1000, 0)::text as "lagMs"
       from outbox_messages where published_at is null`,
    );
    this.metrics.set("outbox_pending", Number(rows[0]?.pending ?? 0));
    this.metrics.set("outbox_lag_ms", Number(rows[0]?.lagMs ?? 0));
  }
}
