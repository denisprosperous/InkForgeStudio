import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

describe("forge HTTP surface", () => {
  const app = buildApp({ logLevel: "silent" });

  it("reports liveness without touching the database", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.version).toBe("1.0.0");
  });

  it("returns 503 from readyz when no database is configured", async () => {
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe("database_url_not_configured");
  });

  it("returns JSON 404s for unknown routes", async () => {
    const res = await request(app).get("/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("keeps the database probe failing soft, never crashing the app", async () => {
    const app = buildApp({
      logLevel: "silent",
      databaseUrl: "postgres://nobody:nope@127.0.0.1:1/none",
    });
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
  });
});
