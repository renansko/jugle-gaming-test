import { ConsoleLogger, Logger, type LoggerService } from "@nestjs/common";

export function createApplicationLogger(nodeEnv: string): LoggerService {
  if (nodeEnv !== "production") {
    return new Logger();
  }

  return new ConsoleLogger({
    json: true,
    colors: false,
    compact: true,
  });
}
