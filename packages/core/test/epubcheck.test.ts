import { describe, expect, it } from "vitest";
import { locateEpubcheckJar, validateEpub } from "../src/validate/epubcheck";

describe("locateEpubcheckJar", () => {
  it("prefers an explicit path", () => {
    expect(locateEpubcheckJar("/tmp/custom.jar")).toBe("/tmp/custom.jar");
  });

  it("falls back to EPUBCHECK_JAR env only when the file exists", () => {
    expect(locateEpubcheckJar(undefined, { EPUBCHECK_JAR: "/nope/missing.jar" })).toBeUndefined();
  });

  it("returns undefined when nothing is installed", () => {
    expect(locateEpubcheckJar(undefined, { EPUBCHECK_JAR: undefined })).toBeUndefined();
  });
});

describe("validateEpub", () => {
  it("reports skipped with a reason when the jar is missing", async () => {
    const result = await validateEpub(Buffer.from("not a real epub"), {
      env: { EPUBCHECK_JAR: undefined },
    });
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("EPUBCheck jar not found");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports skipped when Java is unavailable", async () => {
    const result = await validateEpub(Buffer.from("x"), {
      jarPath: "/definitely/not/a/real/jar.jar",
      env: { EPUBCHECK_JAR: "/definitely/not/a/real/jar.jar" },
    });
    expect(result.status).toBe("skipped");
    expect(result.reason).toBeDefined();
  });
});
