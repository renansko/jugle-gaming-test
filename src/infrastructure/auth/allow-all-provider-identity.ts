import type {
  ProviderAuthorization,
  ProviderIdentityPort,
} from "../../application/auth/provider-identity.port";

export class AllowAllProviderIdentity implements ProviderIdentityPort {
  public authorize(_authorization: ProviderAuthorization): boolean {
    return true;
  }
}
