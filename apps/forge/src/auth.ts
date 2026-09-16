/**
 * @inkforge/forge — bridge auth (Master Directive §6.4).
 *
 * The web tier authenticates its own users (Stack Auth in production, the
 * preview session in dev) and then proxies to forge with:
 *   x-forge-secret: FORGE_SHARED_SECRET   (bridge authentication)
 *   x-forge-user:   <owner user id>       (tenancy principal)
 *
 * Forge NEVER sees end-user credentials; it trusts the bridge only when the
 * shared secret matches (timing-safe). Fail closed: an unconfigured secret
 * rejects every request with 503 auth_not_configured — in every environment,
 * because "works without auth in dev" is how prod incidents are born.
 */
import { timingSafeEqual, createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const SECRET_HEADER = "x-forge-secret";
export const USER_HEADER = "x-forge-user";

export interface BridgeAuthOptions {
  /** Shared secret from config; absent → every request is rejected. */
  readonly sharedSecret?: string | undefined;
}

function fingerprint(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time comparison; safe for equal-length hashes of arbitrary input. */
export function secretsMatch(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return timingSafeEqual(fingerprint(a), fingerprint(b));
}

/** Extract (and require) the bridge user principal from a request. */
export function bridgeUser(req: Request): string {
  const raw = req.header(USER_HEADER);
  return typeof raw === "string" ? raw.trim() : "";
}

/** Express middleware enforcing the bridge contract on every feature route. */
export function requireBridgeAuth(options: BridgeAuthOptions = {}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (options.sharedSecret === undefined || options.sharedSecret.trim() === "") {
      res.status(503).json({ error: "auth_not_configured" });
      return;
    }
    const provided = req.header(SECRET_HEADER);
    if (provided === undefined || !secretsMatch(provided, options.sharedSecret)) {
      res.status(401).json({ error: "invalid_secret" });
      return;
    }
    const user = bridgeUser(req);
    if (user.length === 0 || user.length > 200) {
      res.status(401).json({ error: "invalid_user_principal" });
      return;
    }
    next();
  };
}
