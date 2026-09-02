import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  PROVIDER_IDENTITY_PORT,
  type ProviderAuthorization,
  type ProviderIdentityPort,
} from "../../../application/auth/provider-identity.port";

export const PUBLIC_ROUTE = "publicRoute";
export const PublicRoute = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE, true);

type HttpRequest = {
  headers?: Record<string, string | string[] | undefined>;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
};

@Injectable()
export class ProviderIdentityGuard implements CanActivate {
  public constructor(
    @Inject(PROVIDER_IDENTITY_PORT)
    private readonly providerIdentity: ProviderIdentityPort,
    @Inject(Reflector)
    private readonly reflector: Reflector,
  ) {}

  public canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<HttpRequest>();
    return this.providerIdentity.authorize(this.authorizationFrom(request));
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }

  private authorizationFrom(request: HttpRequest): ProviderAuthorization {
    const authorization = request.headers?.authorization;
    const credential = Array.isArray(authorization)
      ? authorization[0]
      : authorization;
    const claimedProviderId = request.params?.providerId ?? request.body?.providerId;

    return {
      ...(credential ? { credential } : {}),
      ...(typeof claimedProviderId === "string" ? { claimedProviderId } : {}),
    };
  }
}
