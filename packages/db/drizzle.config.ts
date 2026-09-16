/**
 * drizzle-kit config. Paths resolve from this file so the root npm scripts
 * (`npm run db:generate|migrate|studio`) work from anywhere in the repo.
 */
import path from "node:path";
import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  dialect: "postgresql",
  schema: path.join(here, "src/schema.ts"),
  out: path.join(here, "drizzle"),
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://user:pass@localhost:5432/inkforge",
  },
  verbose: true,
  strict: true,
});
