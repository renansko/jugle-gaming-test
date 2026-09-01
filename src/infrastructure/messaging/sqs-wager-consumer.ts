import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Injectable, Inject } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import { type ProcessWagerInput, WageringService } from "../../application/wagering/wagering.service";
import { canonicalPayloadHash, type CanonicalValue } from "../../application/wagering/canonical-payload";
import { DomainError } from "../../domain/shared/domain-error";
import { AppConfig } from "../config/app-config";
import { OperationalMetrics } from "../observability/operational-metrics";

const envelopeSchema = z.object({ messageId: z.string().min(1), type: z.literal("WagerTransactionRequested"), occurredAt: z.string().datetime(), data: z.object({ idempotencyKey: z.string().min(1), providerId: z.string(), externalTransactionId: z.string(), walletId: z.string().uuid(), playerId: z.string(), currency: z.string().regex(/^[A-Z]{3}$/), amount: z.string(), kind: z.enum(["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"]), roundId: z.string(), referenceExternalTransactionId: z.string().optional() }).strict() }).strict();

/** @wiki docs/brain/services/MessagingWorkers.md */
@Injectable()
export class SqsWagerConsumer {
  private readonly client: SQSClient;
  private activePoll?: AbortController;
  private stopping = false;

  public constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(WageringService) private readonly wagering: WageringService,
    @Inject(OperationalMetrics) private readonly metrics: OperationalMetrics,
  ) { this.client = new SQSClient({ region: config.awsRegion, endpoint: config.sqsEndpoint, credentials: { accessKeyId: config.awsAccessKeyId, secretAccessKey: config.awsSecretAccessKey } }); }

  public async pollOnce(): Promise<void> {
    if (this.stopping) return;
    this.activePoll = new AbortController();
    try {
      const response = await this.client.send(new ReceiveMessageCommand({ QueueUrl: this.config.wagerQueueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20, VisibilityTimeout: 60, MessageSystemAttributeNames: ["ApproximateReceiveCount", "SentTimestamp"] }), { abortSignal: this.activePoll.signal });
      await Promise.all((response.Messages ?? []).map((message) => this.consume(message.Body ?? "", message.ReceiptHandle, message.Attributes)));
    } catch (error) {
      if (!this.stopping) throw error;
    } finally {
      this.activePoll = undefined;
    }
  }

  public stop(): void {
    this.stopping = true;
    this.activePoll?.abort();
    this.client.destroy();
  }

  private async consume(body: string, receiptHandle?: string, attributes?: Record<string, string>): Promise<void> {
    let envelope: z.infer<typeof envelopeSchema>;
    try { envelope = envelopeSchema.parse(JSON.parse(body)); }
    catch { if (receiptHandle) await this.toDlq(body, receiptHandle, "invalid_payload"); return; }
    const hash = canonicalPayloadHash(envelope as unknown as CanonicalValue);
    const sentAt = Number(attributes?.SentTimestamp ?? Date.now());
    this.metrics.observe("sqs_message_age_ms", Math.max(0, Date.now() - sentAt));
    const visibilityTimer = receiptHandle ? setInterval(() => {
      void this.client.send(new ChangeMessageVisibilityCommand({ QueueUrl: this.config.wagerQueueUrl, ReceiptHandle: receiptHandle, VisibilityTimeout: 60 })).catch(() => undefined);
    }, 30_000) : undefined;
    try {
      const output = await this.wagering.execute(envelope.data as ProcessWagerInput, {
        correlationId: envelope.messageId,
        causationId: envelope.messageId,
        inbox: { consumerName: "SqsWagerConsumer", messageId: envelope.messageId, payloadHash: hash },
      });
      if (output.idempotentReplay) this.metrics.increment("inbox_duplicates_total");
    } catch (error) {
      if (error instanceof DomainError && !["DEPENDENCY_UNAVAILABLE"].includes(error.code)) {
        if (receiptHandle) await this.toDlq(body, receiptHandle, "permanent_failure");
      } else {
        this.metrics.increment("sqs_retries_total", { status: "transient" });
      }
      return;
    } finally {
      if (visibilityTimer) clearInterval(visibilityTimer);
    }
    if (receiptHandle) await this.client.send(new DeleteMessageCommand({ QueueUrl: this.config.wagerQueueUrl, ReceiptHandle: receiptHandle }));
  }

  private async toDlq(body: string, receiptHandle: string, reason: string): Promise<void> {
    await this.client.send(new SendMessageCommand({ QueueUrl: this.config.wagerDlqUrl, MessageBody: body, MessageGroupId: "dlq", MessageDeduplicationId: createHash("sha256").update(`${reason}:${body}`).digest("hex") }));
    await this.client.send(new DeleteMessageCommand({ QueueUrl: this.config.wagerQueueUrl, ReceiptHandle: receiptHandle }));
    this.metrics.increment("sqs_dlq_total", { reason });
  }
}
