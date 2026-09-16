/**
 * @inkforge/core/validate — EPUB integrity checks via EPUBCheck.
 *
 * EPUBCheck is the same validator Amazon's KDP pipeline effectively enforces,
 * so an export that passes here survives KDP review. Java + the epubcheck jar
 * are optional runtime dependencies: when either is missing the check reports
 * `skipped` with a reason instead of failing the pipeline, so self-hosters
 * without Java can still ship books (they just lose the conformance signal).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface EpubCheckMessage {
  readonly level: "fatal" | "error" | "warning" | "info" | "usage";
  readonly code: string;
  readonly message: string;
  readonly location?: string;
}

export interface EpubCheckResult {
  readonly status: "passed" | "failed" | "skipped";
  readonly errors: number;
  readonly warnings: number;
  readonly messages: readonly EpubCheckMessage[];
  /** Present when status is "skipped". */
  readonly reason?: string;
  readonly jarPath?: string;
  readonly durationMs: number;
}

const DEFAULT_JAR_LOCATIONS: readonly string[] = [
  "docker/epubcheck-5.2.1/epubcheck.jar",
  "docker/epubcheck/epubcheck.jar",
  "/usr/share/java/epubcheck.jar",
  "/usr/local/share/epubcheck/epubcheck.jar",
];

/**
 * Resolve the epubcheck jar: an explicit path is trusted verbatim (the caller
 * asserted it); env and well-known locations require the file to exist.
 */
export function locateEpubcheckJar(
  explicitPath?: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (explicitPath !== undefined && explicitPath.trim() !== "") return explicitPath;
  const candidates = [env.EPUBCHECK_JAR, ...DEFAULT_JAR_LOCATIONS].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function runJava(
  jarPath: string,
  epubPath: string,
  reportPath: string,
  timeoutMs: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("java", ["-jar", jarPath, epubPath, "--json", reportPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`EPUBCheck timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === null) {
        reject(new Error(stderr.trim() || "EPUBCheck exited without a code"));
        return;
      }
      resolve(code);
    });
  });
}

interface RawEpubcheckReport {
  messages?: Array<{
    ID?: string;
    severity?: string;
    message?: string;
    locations?: Array<{ path?: string; line?: number }>;
  }>;
  customMessage?: { message?: string; severity?: string };
}

function normalizeReport(raw: RawEpubcheckReport): {
  errors: number;
  warnings: number;
  messages: EpubCheckMessage[];
} {
  const entries = raw.messages ?? [];
  let errors = 0;
  let warnings = 0;
  const messages: EpubCheckMessage[] = [];
  for (const entry of entries) {
    const severity = (entry.severity ?? "usage").toLowerCase() as EpubCheckMessage["level"];
    if (severity === "error" || severity === "fatal") errors += 1;
    if (severity === "warning" || severity === "usage") warnings += 1;
    const location = entry.locations?.[0];
    const locationLabel = location
      ? [location.path, location.line].filter(Boolean).join(":")
      : undefined;
    messages.push({
      level: severity,
      code: entry.ID ?? "UNKNOWN",
      message: entry.message ?? "",
      ...(locationLabel !== undefined ? { location: locationLabel } : {}),
    });
  }
  return { errors, warnings, messages };
}

/**
 * Validate an EPUB (bytes or path to an .epub on disk). Returns a skipped
 * result — never throws — when Java or the jar is unavailable.
 */
export async function validateEpub(
  input: Buffer | string,
  options: {
    readonly jarPath?: string;
    readonly timeoutMs?: number;
    readonly env?: Record<string, string | undefined>;
  } = {},
): Promise<EpubCheckResult> {
  const started = Date.now();
  const jarPath = locateEpubcheckJar(options.jarPath, options.env);
  const skipped = (reason: string): EpubCheckResult => ({
    status: "skipped",
    errors: 0,
    warnings: 0,
    messages: [],
    reason,
    durationMs: Date.now() - started,
  });

  if (!jarPath) {
    return skipped("EPUBCheck jar not found — run scripts/fetch-assets.sh or set EPUBCHECK_JAR");
  }

  const workDir = mkdtempSync(path.join(tmpdir(), "inkforge-epubcheck-"));
  const epubPath = path.join(workDir, "book.epub");
  const reportPath = path.join(workDir, "report.json");
  try {
    if (typeof input === "string") {
      if (!existsSync(input)) return skipped(`EPUB file not found: ${input}`);
      writeFileSync(epubPath, readFileSync(input));
    } else {
      writeFileSync(epubPath, input);
    }

    const code = await runJava(jarPath, epubPath, reportPath, options.timeoutMs ?? 120_000);
    const report: RawEpubcheckReport = existsSync(reportPath)
      ? (JSON.parse(readFileSync(reportPath, "utf8")) as RawEpubcheckReport)
      : {};
    const { errors, warnings, messages } = normalizeReport(report);
    // EPUBCheck exits 0 when valid, 1 when it finds errors.
    return {
      status: code === 0 && errors === 0 ? "passed" : "failed",
      errors,
      warnings,
      messages,
      jarPath,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|spawn java/i.test(message)) {
      return skipped(
        "Java runtime not available — install a JRE to enable EPUB conformance checks",
      );
    }
    return skipped(`EPUBCheck could not run: ${message}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
