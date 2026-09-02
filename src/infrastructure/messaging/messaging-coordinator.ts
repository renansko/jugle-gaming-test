import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { OperationalMetrics } from "../observability/operational-metrics";
import { AppConfig } from "../config/app-config";
import { OutboxPublisher } from "./outbox-publisher";
import { PendingReferenceWorker } from "./pending-reference-worker";
import { SqsWagerConsumer } from "./sqs-wager-consumer";

/** Starts all messaging workers and drains in-flight work during graceful shutdown. */
@Injectable()
export class MessagingCoordinator
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(MessagingCoordinator.name);
  private stopping = false;
  private workerTasks: Promise<void>[] = [];

  public constructor(
    @Inject(SqsWagerConsumer)
    private readonly consumer: SqsWagerConsumer,
    @Inject(OutboxPublisher)
    private readonly publisher: OutboxPublisher,
    @Inject(PendingReferenceWorker)
    private readonly pendingReferences: PendingReferenceWorker,
    @Inject(OperationalMetrics)
    private readonly metrics: OperationalMetrics,
    @Inject(AppConfig)
    private readonly config: AppConfig,
  ) {}

  public onApplicationBootstrap(): void {
    if (!this.config.autostartWorkers) {
      return;
    }

    this.workerTasks = [
      this.runConsumerLoop(),
      this.runOutboxLoop(),
      this.runPendingReferencesLoop(),
    ];
  }

  public async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.consumer.stop();

    await Promise.allSettled(this.workerTasks);
    this.publisher.stop();
  }

  public isRunning(): boolean {
    return this.workerTasks.length > 0;
  }

  private async runConsumerLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.consumer.pollOnce();
      } catch (error) {
        this.recordWorkerError("consumer", error);
        await this.pause(1_000);
      }
    }
  }

  private async runOutboxLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.publisher.publishBatch();
      } catch (error) {
        this.recordWorkerError("outbox", error);
      }
      await this.pause(250);
    }
  }

  private async runPendingReferencesLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.pendingReferences.processBatch();
      } catch (error) {
        this.recordWorkerError("pending_reference", error);
      }
      await this.pause(500);
    }
  }

  private recordWorkerError(workerName: string, error: unknown): void {
    this.metrics.increment("worker_errors_total", { worker: workerName });
    this.logger.error(
      JSON.stringify({
        event: "worker_error",
        worker: workerName,
        errorType: error instanceof Error ? error.name : "unknown",
      }),
    );
  }

  private async pause(milliseconds: number): Promise<void> {
    if (this.stopping) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}
