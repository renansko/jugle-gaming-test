import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../src/app.module";
import { MessagingCoordinator } from "../../src/infrastructure/messaging/messaging-coordinator";
import {
  OutboxPublisher,
  type PublishBatchResult,
} from "../../src/infrastructure/messaging/outbox-publisher";
import { PendingReferenceWorker } from "../../src/infrastructure/messaging/pending-reference-worker";
import { SqsWagerConsumer } from "../../src/infrastructure/messaging/sqs-wager-consumer";

/** Real-infrastructure harness for directed messaging tests. */
export class MessagingHarness {
  private constructor(
    private readonly application: INestApplicationContext,
    private readonly coordinator: MessagingCoordinator,
    private readonly consumer: SqsWagerConsumer,
    private readonly publisher: OutboxPublisher,
    private readonly pendingReferences: PendingReferenceWorker,
  ) {}

  public static async create(): Promise<MessagingHarness> {
    const application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });

    return new MessagingHarness(
      application,
      application.get(MessagingCoordinator),
      application.get(SqsWagerConsumer),
      application.get(OutboxPublisher),
      application.get(PendingReferenceWorker),
    );
  }

  public isWorkerLoopRunning(): boolean {
    return this.coordinator.isRunning();
  }

  public async consumeOnce(): Promise<void> {
    await this.consumer.pollOnce();
  }

  public async publishUntilIdle(maxBatches = 100): Promise<void> {
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const result = await this.publisher.publishBatch();

      if (result.published === 0 && result.retried === 0) {
        return;
      }
    }

    throw new Error(`Outbox did not become idle after ${maxBatches} batches`);
  }

  public async publishConcurrently(
    publishers = 2,
    limit = 10,
  ): Promise<PublishBatchResult[]> {
    return Promise.all(
      Array.from({ length: publishers }, () =>
        this.publisher.publishBatch(limit),
      ),
    );
  }

  public async resolvePendingOnce(): Promise<void> {
    await this.pendingReferences.processBatch();
  }

  public async close(): Promise<void> {
    await this.application.close();
  }
}
