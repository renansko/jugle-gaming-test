import { Inject, Injectable, Logger } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import { WageringService } from "../../application/wagering/wagering.service";
import { OperationalMetrics } from "../observability/operational-metrics";

interface ClaimedPendingReference {
  id: string;
  created_at: Date;
  reference_attempt_count: number;
}

export interface ProcessPendingBatchResult {
  resolved: number;
  retried: number;
  expired: number;
}

/** @wiki docs/brain/services/MessagingWorkers.md */
@Injectable()
export class PendingReferenceWorker {
  private readonly logger = new Logger(PendingReferenceWorker.name);

  public constructor(
    @Inject(MikroORM)
    private readonly orm: MikroORM,
    @Inject(WageringService)
    private readonly wagering: WageringService,
    @Inject(OperationalMetrics)
    private readonly metrics: OperationalMetrics,
  ) {}

  public async processBatch(
    limit = 20,
    ttlMs = 86_400_000,
    maxAttempts = 10,
  ): Promise<ProcessPendingBatchResult> {
    const entityManager = this.orm.em.fork();
    const leaseUntil = new Date(Date.now() + 60_000);

    const claimQuery = `
      WITH claimed AS (
        SELECT id
        FROM wager_transactions
        WHERE status = 'PENDING_REFERENCE'
          AND next_reference_attempt_at <= NOW()
          AND (reference_lease_until IS NULL OR reference_lease_until < NOW())
        ORDER BY next_reference_attempt_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ?
      )
      UPDATE wager_transactions wager_alias
      SET reference_lease_until = ?,
          reference_attempt_count = wager_alias.reference_attempt_count + 1,
          next_reference_attempt_at = NOW() + LEAST(300000, 1000 * POWER(2, LEAST(wager_alias.reference_attempt_count + 1, 8))) * INTERVAL '1 millisecond'
      FROM claimed
      WHERE wager_alias.id = claimed.id
      RETURNING wager_alias.id, wager_alias.created_at, wager_alias.reference_attempt_count
    `;

    const claimedRows = await entityManager
      .getConnection()
      .execute<ClaimedPendingReference[]>(claimQuery, [limit, leaseUntil]);

    let resolvedCount = 0;
    let retriedCount = 0;
    let expiredCount = 0;

    for (const row of claimedRows) {
      const correlationId = row.id;
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      const hasExceededTtl = ageMs >= ttlMs;
      const hasExceededAttempts = row.reference_attempt_count >= maxAttempts;

      if (hasExceededTtl || hasExceededAttempts) {
        const didExpire = await this.wagering.expirePendingReference(row.id, {
          correlationId,
        });

        if (didExpire) {
          expiredCount += 1;
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

      const resolutionResult = await this.wagering.resolvePendingReference(
        row.id,
        {
          correlationId,
        },
      );

      if (resolutionResult === "resolved") {
        resolvedCount += 1;
        this.metrics.increment("pending_reference_resolved_total");
        this.logger.log(
          JSON.stringify({
            event: "pending_reference_resolved",
            correlationId,
            transactionId: row.id,
          }),
        );
      } else if (resolutionResult === "still_pending") {
        retriedCount += 1;
        this.metrics.increment("pending_reference_retries_total");
      }
    }

    return {
      resolved: resolvedCount,
      retried: retriedCount,
      expired: expiredCount,
    };
  }
}
