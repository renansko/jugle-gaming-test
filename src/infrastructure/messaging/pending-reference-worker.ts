import { Injectable, Inject, Logger } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import { WageringService } from "../../application/wagering/wagering.service";
import { OperationalMetrics } from "../observability/operational-metrics";

type ClaimedPendingReference = {
  id: string;
  created_at: Date;
  reference_attempt_count: number;
};

/** @wiki docs/brain/services/MessagingWorkers.md */
@Injectable()
export class PendingReferenceWorker {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  public constructor(
    @Inject(MikroORM) private readonly orm: MikroORM,
    @Inject(WageringService) private readonly wagering: WageringService,
    @Inject(OperationalMetrics) private readonly metrics: OperationalMetrics,
  ) {}

  public async processBatch(
    limit = 20,
    ttlMs = 86_400_000,
    maxAttempts = 10,
  ): Promise<{ resolved: number; retried: number; expired: number }> {
    const em = this.orm.em.fork();
    const leaseUntil = new Date(Date.now() + 60_000);
    const rows = await em
      .getConnection()
      .execute<ClaimedPendingReference[]>(
        `with claimed as (
         select id from wager_transactions
         where status = 'PENDING_REFERENCE' and next_reference_attempt_at <= now()
           and (reference_lease_until is null or reference_lease_until < now())
         order by next_reference_attempt_at, created_at for update skip locked limit ?
       ) update wager_transactions w set reference_lease_until = ?, reference_attempt_count = w.reference_attempt_count + 1,
         next_reference_attempt_at = now() + least(300000, 1000 * power(2, least(w.reference_attempt_count + 1, 8))) * interval '1 millisecond'
       from claimed where w.id = claimed.id
       returning w.id, w.created_at, w.reference_attempt_count`,
        [limit, leaseUntil],
      );
    let resolved = 0;
    let retried = 0;
    let expired = 0;
    for (const row of rows) {
      const correlationId = row.id;
      if (Date.now() - new Date(row.created_at).getTime() >= ttlMs || row.reference_attempt_count >= maxAttempts) {
        if (
          await this.wagering.expirePendingReference(row.id, { correlationId })
        ) {
          expired += 1;
          this.metrics.increment("pending_reference_expired_total");
          this.logger.warn(
            JSON.stringify({
              event: "pending_reference_expired",
              correlationId,
              transactionId: row.id,
            }),
          );
        }
        continue;
      }
      const result = await this.wagering.resolvePendingReference(row.id, {
        correlationId,
      });
      if (result === "resolved") {
        resolved += 1;
        this.metrics.increment("pending_reference_resolved_total");
        this.logger.log(
          JSON.stringify({
            event: "pending_reference_resolved",
            correlationId,
            transactionId: row.id,
          }),
        );
      } else if (result === "still_pending") {
        retried += 1;
        this.metrics.increment("pending_reference_retries_total");
      }
    }
    return { resolved, retried, expired };
  }
}
