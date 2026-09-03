import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ZodError, z } from "zod";
import { DomainError } from "../../../domain/shared/domain-error";
import {
  type ProcessWagerInput,
  WageringService,
} from "../../../application/wagering/wagering.service";

export const transactionSchema = z
  .object({
    providerId: z.string().min(1).max(128),
    externalTransactionId: z.string().min(1).max(255),
    walletId: z.string().uuid(),
    playerId: z.string().min(1).max(128),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    amount: z.string().optional(),
    money: z
      .object({
        amount: z.string(),
        currency: z.string().regex(/^[A-Z]{3}$/),
      })
      .strict()
      .optional(),
    kind: z.enum(["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"]),
    roundId: z.string().min(1).max(255),
    gameId: z.string().min(1).max(255).optional(),
    referenceExternalTransactionId: z.string().min(1).max(255).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasMoney = Boolean(value.money);
    const hasAmountCurrency = Boolean(value.amount && value.currency);

    if (!hasMoney && !hasAmountCurrency) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either amount and currency or money object is required",
        path: ["amount"],
      });
    }

    if (
      ["REFUND", "ROLLBACK"].includes(value.kind) &&
      !value.referenceExternalTransactionId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A reference transaction is required for reversals",
        path: ["referenceExternalTransactionId"],
      });
    }
  })
  .transform((value) => {
    const amount = value.money ? value.money.amount : (value.amount as string);
    const currency = value.money
      ? value.money.currency
      : (value.currency as string);

    return {
      providerId: value.providerId,
      externalTransactionId: value.externalTransactionId,
      walletId: value.walletId,
      playerId: value.playerId,
      currency,
      amount,
      kind: value.kind,
      roundId: value.roundId,
      gameId: value.gameId,
      referenceExternalTransactionId: value.referenceExternalTransactionId,
    };
  });


@Controller()
export class WageringController {
  public constructor(
    @Inject(WageringService)
    private readonly wagering: WageringService,
  ) {}

  @Post("wagering/transactions")
  @HttpCode(HttpStatus.OK)
  public async process(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: { status(code: number): unknown },
  ): Promise<unknown> {
    if (!idempotencyKey) {
      throw new UnprocessableEntityException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key is required",
      });
    }

    try {
      const parsedBody = transactionSchema.parse(body);
      const output = await this.wagering.execute({
        ...parsedBody,
        idempotencyKey,
      });

      if (output.status === "PENDING_REFERENCE") {
        response.status(HttpStatus.ACCEPTED);
        return output;
      }

      if (output.status === "REJECTED") {
        throw new UnprocessableEntityException(output);
      }

      return output;
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  @Get("wagering/transactions/:transactionId")
  public async get(
    @Param("transactionId") transactionId: string,
  ): Promise<unknown> {
    const transaction = await this.wagering.get(transactionId);

    if (!transaction) {
      throw new NotFoundException({
        code: "WAGER_TRANSACTION_NOT_FOUND",
        message: "Transaction not found",
      });
    }

    return transaction;
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  public async getByProvider(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ): Promise<unknown> {
    const transaction = await this.wagering.getByProvider(
      providerId,
      externalTransactionId,
    );

    if (!transaction) {
      throw new NotFoundException({
        code: "WAGER_TRANSACTION_NOT_FOUND",
        message: "Transaction not found",
      });
    }

    return transaction;
  }

  private toHttpError(error: unknown): unknown {
    if (error instanceof ZodError) {
      return new UnprocessableEntityException({
        code: "INVALID_PAYLOAD",
        message: "Transaction payload is invalid",
      });
    }

    if (!(error instanceof DomainError)) {
      return error;
    }

    const exceptionConstructors: Record<
      string,
      new (body: { code: string; message: string }) => Error
    > = {
      IDEMPOTENCY_CONFLICT: ConflictException,
      WALLET_NOT_FOUND: NotFoundException,
      DEPENDENCY_UNAVAILABLE: ServiceUnavailableException,
    };

    const ExceptionClass =
      exceptionConstructors[error.code] ?? UnprocessableEntityException;
    return new ExceptionClass({
      code: error.code,
      message: error.message,
    });
  }
}
