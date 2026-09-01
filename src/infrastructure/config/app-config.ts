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
  );
}
