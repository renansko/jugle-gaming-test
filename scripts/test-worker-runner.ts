import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });
  app.enableShutdownHooks();

  console.log("WORKER_READY");

  // Keep alive until shutdown signal
  await new Promise<void>((resolve) => {
    process.once("SIGTERM", () => {
      void app.close().then(() => {
        resolve();
      });
    });
  });
}

void bootstrap();
