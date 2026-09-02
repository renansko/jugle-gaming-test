import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PROVIDER_IDENTITY_PORT } from "../../../application/auth/provider-identity.port";
import { AllowAllProviderIdentity } from "../../../infrastructure/auth/allow-all-provider-identity";
import { ProviderIdentityGuard } from "./provider-identity.guard";

@Module({
  providers: [
    {
      provide: PROVIDER_IDENTITY_PORT,
      useClass: AllowAllProviderIdentity,
    },
    {
      provide: APP_GUARD,
      useClass: ProviderIdentityGuard,
    },
  ],
})
export class ProviderIdentityModule {}
