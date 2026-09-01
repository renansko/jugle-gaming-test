import { Module } from "@nestjs/common";
import { WageringModule } from "../../interfaces/http/wagering/wagering.module";
import { OutboxPublisher } from "./outbox-publisher";
import { SqsWagerConsumer } from "./sqs-wager-consumer";
import { PendingReferenceWorker } from "./pending-reference-worker";
import { MessagingCoordinator } from "./messaging-coordinator";

@Module({
  imports: [WageringModule],
  providers: [
    SqsWagerConsumer,
    OutboxPublisher,
    PendingReferenceWorker,
    MessagingCoordinator,
  ],
  exports: [SqsWagerConsumer, OutboxPublisher, PendingReferenceWorker],
})
export class MessagingModule {}
