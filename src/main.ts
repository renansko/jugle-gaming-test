import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadConfig } from "./infrastructure/config/app-config";
import { createApplicationLogger } from "./infrastructure/observability/application-logger";

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(createApplicationLogger(config.nodeEnv));
  app.enableShutdownHooks();
  await app.listen(config.port, "0.0.0.0");
}

void bootstrap();
