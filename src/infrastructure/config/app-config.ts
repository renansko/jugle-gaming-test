import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  SQS_ENDPOINT: z.string().url(),
  AWS_REGION: z.string().min(1).default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  SQS_WAGER_QUEUE_URL: z.string().url(),
  SQS_WAGER_DLQ_URL: z.string().url(),
  SQS_EVENT_QUEUE_URL: z.string().url(),
  SHUTDOWN_GRACE_PERIOD_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60000)
    .default(5000),
  SQS_MAX_RECEIVE_COUNT: z.coerce.number().int().min(1).default(5),
  TEST_WORKERS_AUTOSTART: z.enum(["true", "false"]).optional(),
}).superRefine((environment, context) => {
  if (
    environment.TEST_WORKERS_AUTOSTART !== undefined &&
    environment.NODE_ENV !== "test"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["TEST_WORKERS_AUTOSTART"],
      message: "TEST_WORKERS_AUTOSTART is only allowed when NODE_ENV is test",
    });
  }
});

export class AppConfig {
  public constructor(
    public readonly nodeEnv: "development" | "test" | "production",
    public readonly port: number,
    public readonly databaseUrl: string,
    public readonly sqsEndpoint: string,
    public readonly awsRegion: string,
    public readonly awsAccessKeyId: string,
    public readonly awsSecretAccessKey: string,
    public readonly wagerQueueUrl: string,
    public readonly wagerDlqUrl: string,
    public readonly eventQueueUrl: string,
    public readonly autostartWorkers: boolean,
    public readonly shutdownGracePeriodMs: number = 5000,
    public readonly sqsMaxReceiveCount: number = 5,
  ) {}
}

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const keys = result.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`Invalid environment configuration for: ${keys}`);
  }
  const value = result.data;
  return new AppConfig(
    value.NODE_ENV,
    value.PORT,
    value.DATABASE_URL,
    value.SQS_ENDPOINT,
    value.AWS_REGION,
    value.AWS_ACCESS_KEY_ID,
    value.AWS_SECRET_ACCESS_KEY,
    value.SQS_WAGER_QUEUE_URL,
    value.SQS_WAGER_DLQ_URL,
    value.SQS_EVENT_QUEUE_URL,
    value.NODE_ENV !== "test" || value.TEST_WORKERS_AUTOSTART === "true",
    value.SHUTDOWN_GRACE_PERIOD_MS,
    value.SQS_MAX_RECEIVE_COUNT,
  );
}

