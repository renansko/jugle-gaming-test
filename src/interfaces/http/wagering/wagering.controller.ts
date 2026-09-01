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

const transactionSchema = z
  .object({
    providerId: z.string().min(1).max(128),
    externalTransactionId: z.string().min(1).max(255),
    walletId: z.string().uuid(),
    playerId: z.string().min(1).max(128),
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount: z.string(),
    kind: z.enum(["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"]),
    roundId: z.string().min(1).max(255),
    referenceExternalTransactionId: z.string().min(1).max(255).optional(),
  })
  .strict()
  .superRefine((value, context) => {
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
