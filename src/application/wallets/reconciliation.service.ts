import { Inject, Injectable, Logger } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import Decimal from "decimal.js";
import { DomainError } from "../../domain/shared/domain-error";
import { Money } from "../../domain/shared/money";
import { WalletEntity } from "../../infrastructure/persistence/entities/wallet.entity";
import { OperationalMetrics } from "../../infrastructure/observability/operational-metrics";

export interface ReconciliationResult {
  storedBalance: string;
  calculatedBalance: string;
  difference: string;
  consistent: boolean;
  checkedEntries: number;
  currency: string;
}

/** @wiki docs/brain/services/ReconciliationService.md */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  public constructor(
    @Inject(MikroORM)
    private readonly orm: MikroORM,
    @Inject(OperationalMetrics)
    private readonly metrics: OperationalMetrics,
  ) {}

  public async reconcile(
    walletId: string,
    correlationId = walletId,
  ): Promise<ReconciliationResult> {
    const entityManager = this.orm.em.fork();
    const wallet = await entityManager.findOne(WalletEntity, { id: walletId });

    if (!wallet) {
      throw new DomainError("WALLET_NOT_FOUND", "Wallet not found");
    }

    const query = `
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0)::text AS "calculatedBalance",
        COUNT(*)::text AS "checkedEntries"
      FROM wallet_ledger_entries
      WHERE wallet_id = ?
    `;

    const rows = await entityManager
      .getConnection()
      .execute<Array<{ calculatedBalance: string; checkedEntries: string }>>(
        query,
        [walletId],
      );

    const resultRow = rows[0] ?? {
      calculatedBalance: "0",
      checkedEntries: "0",
    };

    const storedBalance = Money.create(wallet.balance, wallet.currency);
    const calculatedBalance = Money.create(
      resultRow.calculatedBalance,
      wallet.currency,
    );

    const difference = new Decimal(storedBalance.amount)
      .minus(calculatedBalance.amount)
      .toFixed(2);

    const isConsistent = storedBalance.equals(calculatedBalance);

    if (!isConsistent) {
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
      storedBalance: storedBalance.amount,
      calculatedBalance: calculatedBalance.amount,
      difference,
      consistent: isConsistent,
      checkedEntries: Number(resultRow.checkedEntries),
      currency: wallet.currency,
    };
  }
}
