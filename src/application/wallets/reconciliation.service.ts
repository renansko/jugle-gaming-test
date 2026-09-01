import { Inject, Injectable, Logger } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import Decimal from "decimal.js";
import { DomainError } from "../../domain/shared/domain-error";
import { Money } from "../../domain/shared/money";
import { WalletEntity } from "../../infrastructure/persistence/entities/wallet.entity";
import { OperationalMetrics } from "../../infrastructure/observability/operational-metrics";

export type ReconciliationResult = {
  storedBalance: string;
  calculatedBalance: string;
  difference: string;
  consistent: boolean;
  checkedEntries: number;
  currency: string;
};

/** @wiki docs/brain/services/ReconciliationService.md */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  public constructor(
    @Inject(MikroORM) private readonly orm: MikroORM,
    @Inject(OperationalMetrics) private readonly metrics: OperationalMetrics,
  ) {}

  public async reconcile(
    walletId: string,
    correlationId = walletId,
  ): Promise<ReconciliationResult> {
    const em = this.orm.em.fork();
    const wallet = await em.findOne(WalletEntity, { id: walletId });
    if (!wallet) throw new DomainError("WALLET_NOT_FOUND", "Wallet not found");
    const rows = await em
      .getConnection()
      .execute<Array<{ calculatedBalance: string; checkedEntries: string }>>(
        `select coalesce(sum(case when direction = 'CREDIT' then amount else -amount end), 0)::text as "calculatedBalance", count(*)::text as "checkedEntries"
       from wallet_ledger_entries where wallet_id = ?`,
        [walletId],
      );
    const row = rows[0] ?? { calculatedBalance: "0", checkedEntries: "0" };
    const stored = Money.create(wallet.balance, wallet.currency);
    const calculated = Money.create(row.calculatedBalance, wallet.currency);
    const difference = new Decimal(stored.amount)
      .minus(calculated.amount)
      .toFixed(2);
    const consistent = stored.equals(calculated);
    if (!consistent) {
      this.metrics.increment("reconciliation_divergences_total");
      this.logger.warn(
        JSON.stringify({
          event: "reconciliation_divergence",
          correlationId,
          walletId,
        }),
      );
    }
    return {
      storedBalance: stored.amount,
      calculatedBalance: calculated.amount,
      difference,
      consistent,
      checkedEntries: Number(row.checkedEntries),
      currency: wallet.currency,
    };
  }
}
