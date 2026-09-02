import { createHash } from "node:crypto";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { canonicalWagerPayloadHash } from "../../application/wagering/canonical-payload";
import {
  type ProcessWagerInput,
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

/** @wiki docs/brain/services/MessagingWorkers.md */
@Injectable()
export class SqsWagerConsumer {
  private readonly client: SQSClient;
  private activePoll?: AbortController;
  private stopping = false;

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

  public stop(): void {
    this.stopping = true;
    this.activePoll?.abort();
    this.client.destroy();
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

    const wagerInput: ProcessWagerInput = this.toWagerInput(envelope);
    const payloadHash = canonicalWagerPayloadHash(wagerInput);
    const sentAt = Number(attributes?.SentTimestamp ?? Date.now());
    this.metrics.observe(
      "sqs_message_age_ms",
      Math.max(0, Date.now() - sentAt),
    );

    const visibilityTimer = receiptHandle
      ? setInterval(() => {
          void this.client
            .send(
              new ChangeMessageVisibilityCommand({
                QueueUrl: this.config.wagerQueueUrl,
                ReceiptHandle: receiptHandle,
                VisibilityTimeout: 60,
              }),
            )
            .catch(() => undefined);
        }, 30_000)
      : undefined;

    try {
      const output = await this.wagering.execute(wagerInput, {
        correlationId: envelope.messageId,
        causationId: envelope.messageId,
        inbox: {
          consumerName: "SqsWagerConsumer",
          messageId: envelope.messageId,
          payloadHash,
        },
      });

      if (output.idempotentReplay) {
        this.metrics.increment("inbox_duplicates_total");
      }
    } catch (error) {
      await this.handleProcessingError(error, body, receiptHandle);
      return;
    } finally {
      if (visibilityTimer) {
        clearInterval(visibilityTimer);
      }
    }

    if (receiptHandle) {
      await this.deleteProcessedMessage(receiptHandle);
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
  ): Promise<void> {
    const isPermanentDomainError =
      error instanceof DomainError &&
      !["DEPENDENCY_UNAVAILABLE"].includes(error.code);

    if (isPermanentDomainError) {
      if (receiptHandle) {
        await this.toDlq(body, receiptHandle, "permanent_failure");
      }
      return;
    }

    this.metrics.increment("sqs_retries_total", { status: "transient" });
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
