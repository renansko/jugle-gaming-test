import { Module } from "@nestjs/common";
import { HealthModule } from "./interfaces/http/health/health.module";
import { InfrastructureModule } from "./infrastructure/infrastructure.module";
import { WalletsModule } from "./interfaces/http/wallets/wallets.module";
import { WageringModule } from "./interfaces/http/wagering/wagering.module";
import { MessagingModule } from "./infrastructure/messaging/messaging.module";

@Module({
  imports: [
    InfrastructureModule,
    HealthModule,
    WalletsModule,
    WageringModule,
    MessagingModule,
  ],
})
export class AppModule {}
