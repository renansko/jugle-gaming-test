import { describe, expect, mock, test } from "bun:test";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ProviderIdentityPort } from "../../src/application/auth/provider-identity.port";
import {
  PUBLIC_ROUTE,
  ProviderIdentityGuard,
} from "../../src/interfaces/http/auth/provider-identity.guard";

function contextFor(request: unknown): ExecutionContext {
  return {
    getHandler: () => contextFor,
    getClass: () => ProviderIdentityGuard,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("ProviderIdentityGuard", () => {
  test("delegates protected HTTP requests to the provider identity port", async () => {
    const authorize = mock(() => true);
    const guard = new ProviderIdentityGuard(
      { authorize } as ProviderIdentityPort,
      new Reflector(),
    );

    const allowed = await guard.canActivate(
      contextFor({
        headers: { authorization: "Bearer credential" },
        params: { providerId: "provider-a" },
        body: {},
      }),
    );

    expect(allowed).toBe(true);
    expect(authorize).toHaveBeenCalledWith({
      credential: "Bearer credential",
      claimedProviderId: "provider-a",
    });
  });

  test("keeps explicitly public routes independent from identity providers", async () => {
    const authorize = mock(() => false);
    const reflector = {
      getAllAndOverride: mock(() => true),
    } as unknown as Reflector;
    const guard = new ProviderIdentityGuard(
      { authorize } as ProviderIdentityPort,
      reflector,
    );

    expect(await guard.canActivate(contextFor({}))).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(PUBLIC_ROUTE, [
      contextFor,
      ProviderIdentityGuard,
    ]);
    expect(authorize).not.toHaveBeenCalled();
  });
});
