export type ProviderAuthorization = {
  credential?: string;
  claimedProviderId?: string;
};

export interface ProviderIdentityPort {
  authorize(authorization: ProviderAuthorization): boolean | Promise<boolean>;
}

export const PROVIDER_IDENTITY_PORT = Symbol("PROVIDER_IDENTITY_PORT");
