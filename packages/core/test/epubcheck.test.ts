import { describe, expect, it } from "vitest";
import path from "node:path";
import { locateEpubcheckJar, validateEpub } from "../src/validate/epubcheck";

describe("locateEpubcheckJar", () => {
  it("prefers an explicit path", () => {
    expect(locateEpubcheckJar("/tmp/custom.jar")).toBe("/tmp/custom.jar");
  });

  it("falls back to EPUBCHECK_JAR env only when the file exists", () => {
    // Empty defaultLocations → the well-known scan cannot mask the miss, so
    // the assertion holds on cold AND warm hosts (battery V6 flipped warm).
    expect(locateEpubcheckJar(undefined, { EPUBCHECK_JAR: "/nope/missing.jar" }, [])).toBeUndefined();
  });

  it("returns undefined when nothing is installed", () => {
    expect(locateEpubcheckJar(undefined, { EPUBCHECK_JAR: undefined }, [])).toBeUndefined();
  });
});

describe("validateEpub", () => {
  it("reports skipped with a reason when the jar is missing", async () => {
    const result = await validateEpub(Buffer.from("not a real epub"), {
      env: { EPUBCHECK_JAR: undefined },
      // Cold-host simulation: no well-known locations, no env jar.
      defaultJarLocations: [],
    });
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("EPUBCheck jar not found");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports skipped when Java is unavailable", async () => {
    const result = await validateEpub(Buffer.from("x"), {
      // Prefer the real jar (present once fetch-assets ran — battery V1b);
      // on a cold host the existsSync guard skips first and the test still
      // passes. The java-less PATH exercises the ENOENT branch either way.
      jarPath: path.resolve("docker/epubcheck-5.2.1/epubcheck.jar"),
      env: { PATH: "/definitely/no/java-here" },
    });
    expect(result.status).toBe("skipped");
    expect(result.reason).toBeDefined();
  });
});
