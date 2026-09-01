import { Injectable, Inject } from "@nestjs/common";
import { SQSClient, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { Client } from "pg";
import { AppConfig } from "../config/app-config";

export type DependencyStatus = { database: "up" | "down"; sqs: "up" | "down" };

@Injectable()
export class DependenciesHealthService {
  public constructor(@Inject(AppConfig) private readonly config: AppConfig) {}

  public async check(): Promise<DependencyStatus> {
    const [database, sqs] = await Promise.all([
      this.checkDatabase(),
      this.checkSqs(),
    ]);
    return { database, sqs };
  }

  private async checkDatabase(): Promise<"up" | "down"> {
    const client = new Client({
      connectionString: this.config.databaseUrl,
      connectionTimeoutMillis: 2_000,
    });
    try {
      await client.connect();
      await client.query("select 1");
      await client.query("select 1 from mikro_orm_migrations limit 1");
      return "up";
    } catch {
      return "down";
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async checkSqs(): Promise<"up" | "down"> {
    const client = new SQSClient({
      region: this.config.awsRegion,
      endpoint: this.config.sqsEndpoint,
      credentials: {
        accessKeyId: this.config.awsAccessKeyId,
        secretAccessKey: this.config.awsSecretAccessKey,
      },
    });
    try {
      await Promise.all(
        [
          this.config.wagerQueueUrl,
          this.config.wagerDlqUrl,
          this.config.eventQueueUrl,
        ].map((queueUrl) =>
          client.send(
            new GetQueueAttributesCommand({
              QueueUrl: queueUrl,
              AttributeNames: ["QueueArn"],
            }),
          ),
        ),
      );
      return "up";
    } catch {
      return "down";
    } finally {
      client.destroy();
    }
  }
}
