/**
 * @inkforge/config — the single source of truth for runtime configuration.
 *
 * Every workspace resolves its settings through this package so that env parsing,
 * defaults and validation rules live in exactly one place (Master Directive §3.1).
 * The module is side-effect free: importing it never touches `process.env`;
 * call `loadDotenv()` (or rely on the app bootstraps) to hydrate first.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

/** Parse a string env var into a boolean without lying about defaults. */
const booleanish = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((raw) => {
      if (raw === undefined || raw.trim() === "") return fallback;
      return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
    });

const intFrom = (fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((raw) => {
      const parsed = raw === undefined || raw.trim() === "" ? NaN : Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(max, Math.max(min, parsed));
    });

const optionalSecret = z
  .string()
  .optional()
  .transform((raw) => {
    const trimmed = raw?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  });

export const envSchema = z.object({
  // ── Auth (Stack Auth) ────────────────────────────────────────────
  NEXT_PUBLIC_STACK_PROJECT_ID: optionalSecret,
  NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: optionalSecret,
  STACK_SECRET_SERVER_KEY: optionalSecret,

  // ── AI providers (server-only) ───────────────────────────────────
  OPENAI_API_KEY: optionalSecret,
  OPENAI_DEFAULT_MODEL: z.string().default("gpt-4o"),
  GEMINI_API_KEY: optionalSecret,
  GEMINI_DEFAULT_MODEL: z.string().default("gemini-2.5-pro"),
  DEEPSEEK_API_KEY: optionalSecret,
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
  DEEPSEEK_DEFAULT_MODEL: z.string().default("deepseek-chat"),

  // ── Database ─────────────────────────────────────────────────────
  DATABASE_URL: z.string().default("postgres://user:pass@localhost:5432/inkforge"),

  // ── Worker / Web bridge ──────────────────────────────────────────
  FORGE_BASE_URL: z.string().default("http://localhost:4000"),
  FORGE_SHARED_SECRET: optionalSecret,
  FORGE_PORT: intFrom(4000, 1, 65535),
  /** Worker poll interval; the floor keeps a busy loop off a 1-vCPU box. */
  WORKER_POLL_MS: intFrom(1_000, 100, 60_000),
  /** Optional pin; falls back to provider config order when unset/unknown. */
  DEFAULT_AI_PROVIDER: z.string().default(""),

  // ── Encryption for stored user keys ──────────────────────────────
  KEY_ENCRYPTION_SECRET: optionalSecret,

  // ── Feature flags ────────────────────────────────────────────────
  ALLOW_FILE_UPLOADS: booleanish(true),
  ALLOW_COVER_GENERATION: booleanish(true),
  ALLOW_LAVISH_FORMATTING: booleanish(true),
  LOCAL_LLM_ENABLED: booleanish(false),
  PUBLIC_FALLBACK_ENABLED: booleanish(false),

  // ── Runtime ──────────────────────────────────────────────────────
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  RATE_LIMIT_PER_MINUTE: intFrom(60, 1, 10_000),
  MAX_CONCURRENT_JOBS_PER_USER: intFrom(5, 1, 100),
  MAX_UPLOAD_MB: intFrom(20, 1, 512),
  EXPORT_URL_TTL_SECONDS: intFrom(900, 30, 86_400),

  // ── Worker (G-04d) — safe defaults; leave unset in local dev ─────
  WORKER_ENABLED: booleanish(true),
  WORKER_POLL_INTERVAL_MS: intFrom(1_000, 100, 600_000),
  WORKER_BATCH_SIZE: intFrom(4, 1, 64),
  WORKER_LEASE_MS: intFrom(300_000, 30_000, 3_600_000),
  WORKER_RETENTION_INTERVAL_MS: intFrom(3_600_000, 60_000, 86_400_000),
  WORKER_RETRY_BACKOFF_MS: intFrom(60_000, 1_000, 3_600_000),
});

export type Env = z.infer<typeof envSchema>;

export interface AiProviderConfig {
  readonly id: "openai" | "gemini" | "deepseek";
  readonly model: string;
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
}

export interface AppConfig {
  readonly env: Env;
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly port: number;
  readonly databaseUrl: string;
  readonly logLevel: Env["LOG_LEVEL"];
  readonly stack: {
    readonly configured: boolean;
    readonly projectId?: string | undefined;
    readonly publishableClientKey?: string | undefined;
    readonly secretServerKey?: string | undefined;
  };
  readonly forge: {
    readonly baseUrl: string;
    readonly sharedSecret?: string | undefined;
  };
  readonly encryption: {
    readonly keySecret?: string | undefined;
  };
  readonly ai: {
    readonly providers: readonly AiProviderConfig[];
    readonly localLlmEnabled: boolean;
    readonly publicFallbackEnabled: boolean;
  };
  readonly flags: {
    readonly allowFileUploads: boolean;
    readonly allowCoverGeneration: boolean;
    readonly allowLavishFormatting: boolean;
  };
  readonly limits: {
    readonly rateLimitPerMinute: number;
    readonly maxConcurrentJobsPerUser: number;
    readonly maxUploadMb: number;
    readonly exportUrlTtlSeconds: number;
  };
  /** Job worker loop (G-04d). Defaults are production-safe. */
  readonly worker: {
    readonly enabled: boolean;
    readonly pollIntervalMs: number;
    readonly batchSize: number;
    readonly leaseMs: number;
    readonly retentionIntervalMs: number;
    readonly retryBackoffMs: number;
  };
}

export class ConfigError extends Error {
  public constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

/**
 * Parse raw env records into a frozen AppConfig. Throws ConfigError (with a
 * readable issue list) when a value violates the schema.
 */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    });
    throw new ConfigError(issues);
  }
  const env = parsed.data;
  const stackConfigured = Boolean(
    env.NEXT_PUBLIC_STACK_PROJECT_ID &&
      env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY &&
      env.STACK_SECRET_SERVER_KEY,
  );

  const providers: AiProviderConfig[] = [
    {
      id: "openai",
      model: env.OPENAI_DEFAULT_MODEL,
      ...(env.OPENAI_API_KEY !== undefined ? { apiKey: env.OPENAI_API_KEY } : {}),
    },
    {
      id: "gemini",
      model: env.GEMINI_DEFAULT_MODEL,
      ...(env.GEMINI_API_KEY !== undefined ? { apiKey: env.GEMINI_API_KEY } : {}),
    },
    {
      id: "deepseek",
      model: env.DEEPSEEK_DEFAULT_MODEL,
      baseUrl: env.DEEPSEEK_BASE_URL,
      ...(env.DEEPSEEK_API_KEY !== undefined ? { apiKey: env.DEEPSEEK_API_KEY } : {}),
    },
  ];

  return Object.freeze({
    env,
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
    port: env.FORGE_PORT,
    databaseUrl: env.DATABASE_URL,
    logLevel: env.LOG_LEVEL,
    stack: Object.freeze({
      configured: stackConfigured,
      projectId: env.NEXT_PUBLIC_STACK_PROJECT_ID,
      publishableClientKey: env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
      secretServerKey: env.STACK_SECRET_SERVER_KEY,
    }),
    forge: Object.freeze({
      baseUrl: env.FORGE_BASE_URL,
      sharedSecret: env.FORGE_SHARED_SECRET,
    }),
    encryption: Object.freeze({ keySecret: env.KEY_ENCRYPTION_SECRET }),
    ai: Object.freeze({
      providers: Object.freeze(providers),
      localLlmEnabled: env.LOCAL_LLM_ENABLED,
      publicFallbackEnabled: env.PUBLIC_FALLBACK_ENABLED,
    }),
    flags: Object.freeze({
      allowFileUploads: env.ALLOW_FILE_UPLOADS,
      allowCoverGeneration: env.ALLOW_COVER_GENERATION,
      allowLavishFormatting: env.ALLOW_LAVISH_FORMATTING,
    }),
    limits: Object.freeze({
      rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
      maxConcurrentJobsPerUser: env.MAX_CONCURRENT_JOBS_PER_USER,
      maxUploadMb: env.MAX_UPLOAD_MB,
      exportUrlTtlSeconds: env.EXPORT_URL_TTL_SECONDS,
    }),
    worker: Object.freeze({
      enabled: env.WORKER_ENABLED,
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      batchSize: env.WORKER_BATCH_SIZE,
      leaseMs: env.WORKER_LEASE_MS,
      retentionIntervalMs: env.WORKER_RETENTION_INTERVAL_MS,
      retryBackoffMs: env.WORKER_RETRY_BACKOFF_MS,
    }),
  });
}

/**
 * Preview mode: the platform boots with an ephemeral local session when Stack
 * Auth is not configured, so authors can try the studio before wiring keys.
 */
export function isPreviewAuth(config: Pick<AppConfig, "stack" | "isProduction">): boolean {
  if (config.stack.configured) return false;
  return !config.isProduction;
}

/**
 * Nearest directory at or above `start` that holds an env file.
 *
 * Workspace scripts run with `cwd` set to the package directory (for example
 * `npm run dev -w @inkforge/forge` runs with cwd `apps/forge`), while the
 * monorepo's `.env` lives at the repo root. Loading only `${cwd}/.env` silently
 * fell back to config placeholders — including `DATABASE_URL`'s
 * `postgres://user:pass@…` — which then failed at the first query. Searching
 * upward keeps every entrypoint (forge API/worker, cli, seed) on the same env.
 */
function findEnvDir(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".env")) || existsSync(join(dir, ".env.local"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

/** Load .env / .env.local once (node runtimes only; Next loads env itself). */
export async function loadDotenv(cwd = process.cwd()): Promise<void> {
  const dotenv = await import("dotenv");
  const dir = findEnvDir(cwd);
  dotenv.config({ path: join(dir, ".env") });
  dotenv.config({ path: join(dir, ".env.local"), override: false });
}
