import { createHash } from "node:crypto";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { canonicalWagerPayloadHash } from "../../application/wagering/canonical-payload";
import {
  type ProcessWagerInput,
  type ProcessWagerOutput,
  WageringService,
} from "../../application/wagering/wagering.service";
import { DomainError } from "../../domain/shared/domain-error";
import { AppConfig } from "../config/app-config";
import { OperationalMetrics } from "../observability/operational-metrics";

const envelopeSchema = z
  .object({
    messageId: z.string().min(1),
    type: z.literal("WagerTransactionRequested"),
    occurredAt: z.string().datetime(),
    data: z
      .object({
        idempotencyKey: z.string().min(1),
        providerId: z.string(),
        externalTransactionId: z.string(),
        walletId: z.string().uuid(),
        playerId: z.string(),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .optional(),
        amount: z.string().optional(),
        money: z
          .object({
            amount: z.string(),
            currency: z.string().regex(/^[A-Z]{3}$/),
          })
          .strict()
          .optional(),
        kind: z.enum(["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"]),
        roundId: z.string(),
        gameId: z.string().optional(),
        referenceExternalTransactionId: z.string().optional(),
      })
      .strict()
      .superRefine((value, context) => {
        const hasMoney = Boolean(value.money);
        const hasAmountCurrency = Boolean(value.amount && value.currency);
        if (!hasMoney && !hasAmountCurrency) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Either amount and currency or money object is required",
            path: ["amount"],
          });
        }
      }),
  })
  .strict();

export type SqsWagerEnvelope = z.infer<typeof envelopeSchema>;

interface InFlightMessage {
  messageId: string;
  receiptHandle?: string;
  startedAt: number;
  status: "processing" | "completed" | "released";
}

/** @wiki docs/brain/services/MessagingWorkers.md */
@Injectable()
export class SqsWagerConsumer {
  private readonly logger = new Logger(SqsWagerConsumer.name);
  private readonly client: SQSClient;
  private readonly inFlightMessages = new Set<InFlightMessage>();
  private activePoll?: AbortController;
  private stopping = false;

  public onAfterCommitBeforeAck?: (context: {
    messageId: string;
    receiptHandle?: string;
    output: ProcessWagerOutput;
  }) => Promise<void> | void;

  public constructor(
    @Inject(AppConfig)
    private readonly config: AppConfig,
    @Inject(WageringService)
    private readonly wagering: WageringService,
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

  public async pollOnce(waitTimeSeconds = 20): Promise<void> {
    if (this.stopping) {
      return;
    }

    this.activePoll = new AbortController();

    try {
      const response = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.config.wagerQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: waitTimeSeconds,
          VisibilityTimeout: 60,
          MessageSystemAttributeNames: [
            "ApproximateReceiveCount",
            "SentTimestamp",
          ],
        }),
        { abortSignal: this.activePoll.signal },
      );

      const messages = response.Messages ?? [];
      await Promise.all(
        messages.map((message) =>
          this.consume(
            message.Body ?? "",
            message.ReceiptHandle,
            message.Attributes,
          ),
        ),
      );
    } catch (error) {
      if (!this.stopping) {
        throw error;
      }
    } finally {
      this.activePoll = undefined;
    }
  }

  public async shutdown(gracePeriodMs?: number): Promise<void> {
    this.stopping = true;
    this.activePoll?.abort();

    const timeout = gracePeriodMs ?? this.config.shutdownGracePeriodMs;
    const drained = await this.awaitInFlightDrain(timeout);

    if (drained) {
      this.handleDrainSuccess(timeout);
    } else {
      await this.handleDrainTimeout();
    }

    this.client.destroy();
  }

  public stop(): void {
    void this.shutdown(0);
  }

  private async awaitInFlightDrain(timeoutMs: number): Promise<boolean> {
    const started = Date.now();
    while (this.inFlightMessages.size > 0 && Date.now() - started < timeoutMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    return this.inFlightMessages.size === 0;
  }

  private handleDrainSuccess(timeoutMs: number): void {
    this.metrics.increment("consumer_drain_total");
    this.logger.log(
      JSON.stringify({
        event: "consumer_drain_completed",
        timeoutMs,
      }),
    );
  }

  private async handleDrainTimeout(): Promise<void> {
    const activeMessages = Array.from(this.inFlightMessages).filter(
      (msg) => msg.status === "processing",
    );

    await Promise.all(
      activeMessages.map((msg) => this.releaseMessageVisibility(msg)),
    );

    this.metrics.increment("shutdown_failures_total");
    this.logger.error(
      JSON.stringify({
        event: "consumer_shutdown_timeout",
        releasedMessages: activeMessages.length,
      }),
    );
  }

  private async releaseMessageVisibility(
    inFlight: InFlightMessage,
  ): Promise<void> {
    inFlight.status = "released";
    if (!inFlight.receiptHandle) {
      return;
    }

    try {
      await this.client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: this.config.wagerQueueUrl,
          ReceiptHandle: inFlight.receiptHandle,
          VisibilityTimeout: 0,
        }),
      );
      this.metrics.increment("consumer_visibility_released_total");
      this.logger.warn(
        JSON.stringify({
          event: "consumer_visibility_released",
          messageId: inFlight.messageId,
        }),
      );
    } catch {
      // Ignored during shutdown if client destroyed
    }
  }

  private async consume(
    body: string,
    receiptHandle?: string,
    attributes?: Record<string, string>,
  ): Promise<void> {
    let envelope: SqsWagerEnvelope;

    try {
      envelope = envelopeSchema.parse(JSON.parse(body));
    } catch {
      if (receiptHandle) {
        await this.toDlq(body, receiptHandle, "invalid_payload");
      }
      return;
    }

    const inFlight: InFlightMessage = {
      messageId: envelope.messageId,
      receiptHandle,
      startedAt: Date.now(),
      status: "processing",
    };
    this.inFlightMessages.add(inFlight);

    try {
      await this.processWagerMessage(envelope, receiptHandle, attributes);
    } finally {
      inFlight.status = "completed";
      this.inFlightMessages.delete(inFlight);
    }
  }

  private async processWagerMessage(
    envelope: SqsWagerEnvelope,
    receiptHandle?: string,
    attributes?: Record<string, string>,
  ): Promise<void> {
    const wagerInput = this.toWagerInput(envelope);
    const payloadHash = canonicalWagerPayloadHash(wagerInput);
    const sentAt = Number(attributes?.SentTimestamp ?? Date.now());
    this.metrics.observe(
      "sqs_message_age_ms",
      Math.max(0, Date.now() - sentAt),
    );

    const visibilityTimer = this.startVisibilityTimer(receiptHandle);
    let output: ProcessWagerOutput;

    try {
      output = await this.wagering.execute(wagerInput, {
        correlationId: envelope.messageId,
        causationId: envelope.messageId,
        inbox: {
          consumerName: "SqsWagerConsumer",
          messageId: envelope.messageId,
          payloadHash,
        },
      });

      this.recordRedeliveryAndReplay(envelope.messageId, attributes, output);
    } catch (error) {
      await this.handleProcessingError(
        error,
        JSON.stringify(envelope),
        receiptHandle,
        attributes,
      );
      return;
    } finally {
      if (visibilityTimer) {
        clearInterval(visibilityTimer);
      }
    }

    if (this.onAfterCommitBeforeAck) {
      await this.onAfterCommitBeforeAck({
        messageId: envelope.messageId,
        receiptHandle,
        output,
      });
    }

    if (receiptHandle) {
      await this.deleteProcessedMessage(receiptHandle);
    }
  }

  private startVisibilityTimer(
    receiptHandle?: string,
  ): ReturnType<typeof setInterval> | undefined {
    if (!receiptHandle) {
      return undefined;
    }

    return setInterval(() => {
      void this.client
        .send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: this.config.wagerQueueUrl,
            ReceiptHandle: receiptHandle,
            VisibilityTimeout: 60,
          }),
        )
        .catch(() => undefined);
    }, 30_000);
  }

  private recordRedeliveryAndReplay(
    messageId: string,
    attributes: Record<string, string> | undefined,
    output: ProcessWagerOutput,
  ): void {
    const receiveCount = Number(attributes?.ApproximateReceiveCount ?? 1);
    const isRedelivery = receiveCount > 1 || output.idempotentReplay;

    if (isRedelivery) {
      this.metrics.increment("sqs_redeliveries_total");
      this.logger.warn(
        JSON.stringify({
          event: "sqs_message_redelivered",
          messageId,
          receiveCount,
          idempotentReplay: output.idempotentReplay,
        }),
      );
    }

    if (output.idempotentReplay) {
      this.metrics.increment("inbox_duplicates_total");
    }
  }

  private toWagerInput(envelope: SqsWagerEnvelope): ProcessWagerInput {
    const money = envelope.data.money;
    return {
      idempotencyKey: envelope.data.idempotencyKey,
      providerId: envelope.data.providerId,
      externalTransactionId: envelope.data.externalTransactionId,
      walletId: envelope.data.walletId,
      playerId: envelope.data.playerId,
      currency: money?.currency ?? (envelope.data.currency as string),
      amount: money?.amount ?? (envelope.data.amount as string),
      kind: envelope.data.kind,
      roundId: envelope.data.roundId,
      gameId: envelope.data.gameId,
      referenceExternalTransactionId:
        envelope.data.referenceExternalTransactionId,
    };
  }

  private async handleProcessingError(
    error: unknown,
    body: string,
    receiptHandle?: string,
    attributes?: Record<string, string>,
  ): Promise<void> {
    if (this.isPermanentDomainError(error)) {
      if (receiptHandle) {
        await this.toDlq(body, receiptHandle, "permanent_failure");
      }
      return;
    }

    await this.handleTransientError(body, receiptHandle, attributes);
  }

  private isPermanentDomainError(error: unknown): boolean {
    return (
      error instanceof DomainError &&
      !["DEPENDENCY_UNAVAILABLE"].includes(error.code)
    );
  }

  private async handleTransientError(
    body: string,
    receiptHandle?: string,
    attributes?: Record<string, string>,
  ): Promise<void> {
    const receiveCount = Number(attributes?.ApproximateReceiveCount ?? 1);

    if (receiveCount >= this.config.sqsMaxReceiveCount) {
      if (receiptHandle) {
        await this.toDlq(body, receiptHandle, "max_retries_exceeded");
      }
      this.metrics.increment("sqs_retries_total", { status: "exhausted" });
      return;
    }

    if (receiptHandle) {
      const backoffSeconds = this.calculateBackoffSeconds(receiveCount);
      await this.client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: this.config.wagerQueueUrl,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: backoffSeconds,
        }),
      );
    }

    this.metrics.increment("sqs_retries_total", { status: "transient" });
  }

  private calculateBackoffSeconds(receiveCount: number): number {
    return Math.min(300, Math.max(1, 2 ** (receiveCount - 1)));
  }

  private async deleteProcessedMessage(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.config.wagerQueueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private async toDlq(
    body: string,
    receiptHandle: string,
    reason: string,
  ): Promise<void> {
    const hash = createHash("sha256").update(`${reason}:${body}`).digest("hex");

    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.config.wagerDlqUrl,
        MessageBody: body,
        MessageGroupId: `dlq-${hash.slice(0, 16)}`,
        MessageDeduplicationId: hash,
      }),
    );

    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.config.wagerQueueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );

    this.metrics.increment("sqs_dlq_total", { reason });
  }
}

