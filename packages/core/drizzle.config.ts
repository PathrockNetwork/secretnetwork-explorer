import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  // Only used by `drizzle-kit push`. We apply migrations via src/migrate.ts.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://sealed:sealed@localhost:5432/sealed_monitor",
  },
  verbose: true,
  strict: true,
});
