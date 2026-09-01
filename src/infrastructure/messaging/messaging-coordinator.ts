import { type BeforeApplicationShutdown, Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { OperationalMetrics } from "../observability/operational-metrics";
import { OutboxPublisher } from "./outbox-publisher";
import { PendingReferenceWorker } from "./pending-reference-worker";
import { SqsWagerConsumer } from "./sqs-wager-consumer";

/** Starts all messaging workers and drains in-flight work during graceful shutdown. */
@Injectable()
export class MessagingCoordinator implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(MessagingCoordinator.name);
  private stopping = false;
  private tasks: Promise<void>[] = [];

  public constructor(
    @Inject(SqsWagerConsumer) private readonly consumer: SqsWagerConsumer,
    @Inject(OutboxPublisher) private readonly publisher: OutboxPublisher,
    @Inject(PendingReferenceWorker) private readonly pendingReferences: PendingReferenceWorker,
    @Inject(OperationalMetrics) private readonly metrics: OperationalMetrics,
  ) {}

  public onApplicationBootstrap(): void {
    this.tasks = [this.runConsumer(), this.runOutbox(), this.runPendingReferences()];
  }

  public async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.consumer.stop();
    await Promise.allSettled(this.tasks);
    this.publisher.stop();
  }

  private async runConsumer(): Promise<void> {
    while (!this.stopping) {
      try { await this.consumer.pollOnce(); }
      catch (error) { this.workerError("consumer", error); await this.pause(1_000); }
    }
  }

  private async runOutbox(): Promise<void> {
    while (!this.stopping) {
      try { await this.publisher.publishBatch(); }
      catch (error) { this.workerError("outbox", error); }
      await this.pause(250);
    }
  }

  private async runPendingReferences(): Promise<void> {
    while (!this.stopping) {
      try { await this.pendingReferences.processBatch(); }
      catch (error) { this.workerError("pending_reference", error); }
      await this.pause(500);
    }
  }

  private workerError(worker: string, error: unknown): void {
    this.metrics.increment("worker_errors_total", { worker });
    this.logger.error(JSON.stringify({ event: "worker_error", worker, errorType: error instanceof Error ? error.name : "unknown" }));
  }

  private async pause(milliseconds: number): Promise<void> {
    if (this.stopping) return;
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}
