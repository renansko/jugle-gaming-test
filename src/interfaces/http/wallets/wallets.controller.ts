import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { DomainError } from "../../../domain/shared/domain-error";
import { WalletService } from "../../../application/wallets/wallet.service";
import { ReconciliationService } from "../../../application/wallets/reconciliation.service";

const createWalletSchema = z.object({ playerId: z.string().min(1).max(128), currency: z.string().regex(/^[A-Z]{3}$/), initialBalance: z.string().optional() }).strict();

@Controller("wallets")
export class WalletsController {
  public constructor(@Inject(WalletService) private readonly wallets: WalletService, @Inject(ReconciliationService) private readonly reconciliation: ReconciliationService) {}

  @Post(":walletId/reconciliation")
  public async reconcile(@Param("walletId") walletId: string): Promise<unknown> {
    try { return await this.reconciliation.reconcile(walletId); }
    catch (error) {
      if (error instanceof DomainError && error.code === "WALLET_NOT_FOUND") throw new NotFoundException({ code: error.code, message: error.message });
      throw error;
    }
  }

  @Post()
  public async create(@Body() body: unknown): Promise<unknown> {
    const input = createWalletSchema.parse(body);
    try { return this.serializeWallet(await this.wallets.create(input)); }
    catch (error) {
      if (error instanceof DomainError && error.code === "WALLET_ALREADY_EXISTS") {
        throw new ConflictException({ code: "WALLET_ALREADY_EXISTS", message: "Wallet already exists" });
      }
      throw error;
    }
  }

  @Get(":walletId")
  public async get(@Param("walletId") walletId: string): Promise<unknown> {
    const wallet = await this.wallets.get(walletId);
    if (!wallet) throw new NotFoundException({ code: "WALLET_NOT_FOUND", message: "Wallet not found" });
    return this.serializeWallet(wallet);
  }

  @Get(":walletId/ledger")
  @HttpCode(HttpStatus.OK)
  public async ledger(@Param("walletId") walletId: string, @Query("cursor") cursor?: string, @Query("limit") limit = "50"): Promise<unknown> {
    const parsedLimit = Number.parseInt(limit, 10);
    if (!Number.isInteger(parsedLimit)) throw new BadRequestException({ code: "INVALID_CURSOR", message: "Limit must be an integer" });
    let page: Awaited<ReturnType<WalletService["ledger"]>>;
    try { page = await this.wallets.ledger(walletId, cursor, parsedLimit); }
    catch (error) {
      if (error instanceof DomainError && error.code === "INVALID_CURSOR") throw new BadRequestException({ code: error.code, message: error.message });
      throw error;
    }
    return { items: page.items.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })), nextCursor: page.nextCursor };
  }

  private serializeWallet(wallet: { id: string; playerId: string; currency: string; balance: string; version: number; createdAt: Date; updatedAt: Date }): object {
    return { id: wallet.id, playerId: wallet.playerId, balance: { amount: wallet.balance, currency: wallet.currency }, version: wallet.version, createdAt: wallet.createdAt.toISOString(), updatedAt: wallet.updatedAt.toISOString() };
  }
}
