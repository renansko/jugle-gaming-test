import { Module } from "@nestjs/common";
import { WalletService } from "../../../application/wallets/wallet.service";
import { ReconciliationService } from "../../../application/wallets/reconciliation.service";
import { WalletsController } from "./wallets.controller";

@Module({
  controllers: [WalletsController],
  providers: [WalletService, ReconciliationService],
})
export class WalletsModule {}
