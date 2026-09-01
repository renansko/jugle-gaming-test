import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import { loadConfig } from "./src/infrastructure/config/app-config";

const config = loadConfig(process.env);

export default defineConfig({
  clientUrl: config.databaseUrl,
  entities: ["./dist/**/*.entity.js"],
  entitiesTs: ["./src/**/*.entity.ts"],
  extensions: [Migrator],
  migrations: { path: "./dist/infrastructure/persistence/migrations", pathTs: "./src/infrastructure/persistence/migrations" },
});
