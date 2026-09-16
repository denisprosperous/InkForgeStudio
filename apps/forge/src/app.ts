/**
 * @inkforge/forge — HTTP surface for the worker tier.
 *
 * The forge is the bridge between the Next.js web tier and the long-running
 * jobs (outline, chapter generation, humanize, cover, export). This module
 * builds the hardened Express app: security headers, CORS for the web origin,
 * JSON body limits, per-minute rate limiting, structured logs, liveness and
 * readiness probes. Feature routes (job submission, streaming drafts) land
 * with their owning modules — see docs/audit/phase-2-gap-register-and-build-plan.md.
 */
import { pinoHttp } from "pino-http";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import pino from "pino";
import rateLimit from "express-rate-limit";
import { createDb, type DbHandle } from "@inkforge/db";

export interface ForgeAppOptions {
  /** pino level; pass "silent" in tests. */
  readonly logLevel?: string;
  /** Postgres URL used by the readiness probe; absent → readyz reports unconfigured. */
  readonly databaseUrl?: string | undefined;
  readonly rateLimitPerMinute?: number;
  readonly jsonBodyLimit?: string;
}

const START = Date.now();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Build the forge Express app. Cheap to construct; probes stay lazy. */
export function buildApp(options: ForgeAppOptions = {}): Express {
  const logLevel = options.logLevel ?? "info";
  const logger = pino({ level: logLevel });
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: options.jsonBodyLimit ?? "1mb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: options.rateLimitPerMinute ?? 60,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      validate: false, // local/single-VM deployment; revisit behind a real proxy
    }),
  );
  app.use(
    pinoHttp({
      logger,
      redact: { paths: ["req.headers.authorization", "req.headers.cookie"], remove: true },
    }),
  );

  let probeHandle: DbHandle | undefined;

  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      uptimeSeconds: Math.round((Date.now() - START) / 1_000),
      version: "1.0.0",
    });
  });

  app.get("/readyz", async (_req: Request, res: Response) => {
    if (!options.databaseUrl) {
      res.status(503).json({ status: "unavailable", reason: "database_url_not_configured" });
      return;
    }
    try {
      probeHandle ??= createDb(options.databaseUrl, { max: 1, connectTimeoutSeconds: 3 });
      const rows = await withTimeout(probeHandle.client`select 1`, 1_500);
      if (rows.length > 0) {
        res.status(200).json({ status: "ready" });
      } else {
        res.status(503).json({ status: "degraded", reason: "database returned no rows" });
      }
    } catch (error) {
      res.status(503).json({
        status: "degraded",
        reason: error instanceof Error ? error.message : "database unreachable",
      });
    }
  });

  // Feature routes attach here as their modules land (jobs, drafts, covers, exports).
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    req.log?.error({ error }, "unhandled error");
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
