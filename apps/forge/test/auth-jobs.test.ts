/**
 * G-04a — bridge auth + job API contract tests.
 *
 * Runs against the docker-compose Postgres (INKFORGE_PG_TEST=1); CI and the
 * clean-checkout battery set it. Tenancy isolation comes from unique user
 * principals per test — no shared mutable rows, no truncation races.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createDb, jobs, type DbHandle } from "@inkforge/db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const DB_URL =
  process.env.FORGE_TEST_DATABASE_URL ?? "postgres://inkforge:inkforge@localhost:5432/inkforge";
const SECRET = "neg3-test-secret";

const d = describe.skipIf(!ENABLED);

function headers(user: string, secret: string = SECRET) {
  return secret === ""
    ? { "x-forge-user": user }
    : { "x-forge-secret": secret, "x-forge-user": user };
}

d("bridge auth", () => {
  it("rejects everything with 503 when no secret is configured (fail closed)", async () => {
    const app = buildApp({ logLevel: "silent", databaseUrl: DB_URL });
    const res = await request(app)
      .post("/jobs")
      .set(headers("someone"))
      .send({ type: "outline.generate" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("auth_not_configured");
  });

  it("rejects a wrong secret with 401 invalid_secret", async () => {
    const app = buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
    const res = await request(app).get("/jobs").set(headers("someone", "wrong-secret"));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_secret");
  });

  it("rejects a missing user principal with 401", async () => {
    const app = buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
    const res = await request(app).get("/jobs").set({ "x-forge-secret": SECRET });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_user_principal");
  });
});

d("job API", () => {
  let handle: DbHandle;
  const user = `user-${randomUUID()}`;
  const other = `user-${randomUUID()}`;

  beforeAll(() => {
    handle = createDb(DB_URL, { max: 5 });
  });

  afterAll(async () => {
    await handle.db.delete(jobs).where(eq(jobs.userId, user));
    await handle.db.delete(jobs).where(eq(jobs.userId, other));
    await handle.close();
  });

  function app() {
    return buildApp({
      logLevel: "silent",
      databaseUrl: DB_URL,
      sharedSecret: SECRET,
      maxConcurrentJobsPerUser: 2,
    });
  }
  it("POST /jobs enqueues and returns 202 with a queued job", async () => {
    const res = await request(app())
      .post("/jobs")
      .set(headers(user))
      .send({ type: "outline.generate", payload: { premise: "a forge that wakes" } });
    expect(res.status).toBe(202);
    expect(res.body.job.status).toBe("queued");
    expect(res.body.job.type).toBe("outline.generate");
    expect(res.body.job.userId).toBe(user);
  });

  it("POST /jobs validates the body and rejects unknown types", async () => {
    const res = await request(app())
      .post("/jobs")
      .set(headers(user))
      .send({ type: "world.domination" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_job_request");
  });

  it("POST /jobs 404s when bookId is not owned by the principal", async () => {
    const res = await request(app())
      .post("/jobs")
      .set(headers(user))
      .send({ type: "chapter.generate", bookId: randomUUID() });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("book_not_found");
  });

  it("GET /jobs lists only the principal's queue", async () => {
    await request(app()).post("/jobs").set(headers(user)).send({ type: "chapter.humanize" });
    await request(app()).post("/jobs").set(headers(other)).send({ type: "chapter.humanize" });
    const mine = await request(app()).get("/jobs").set(headers(user));
    expect(mine.status).toBe(200);
    expect(mine.body.jobs.length).toBeGreaterThanOrEqual(2);
    for (const job of mine.body.jobs) expect(job.userId).toBe(user);

    const theirs = await request(app()).get("/jobs").set(headers(other));
    for (const job of theirs.body.jobs) expect(job.userId).toBe(other);
  });

  it("GET /jobs filters by status", async () => {
    const res = await request(app()).get("/jobs?status=queued").set(headers(user));
    expect(res.status).toBe(200);
    for (const job of res.body.jobs) expect(job.status).toBe("queued");
  });

  it("GET /jobs/:id is tenant-scoped", async () => {
    const created = await request(app())
      .post("/jobs")
      .set(headers(user))
      .send({ type: "cover.generate" });
    const jobId = created.body.job.id as string;

    const mine = await request(app()).get(`/jobs/${jobId}`).set(headers(user));
    expect(mine.status).toBe(200);
    expect(mine.body.job.id).toBe(jobId);

    const theirs = await request(app()).get(`/jobs/${jobId}`).set(headers(other));
    expect(theirs.status).toBe(404);
    expect(theirs.body.error).toBe("job_not_found");
  });

  it("enforces the per-user running cap with 429", async () => {
    for (let i = 0; i < 2; i += 1) {
      const res = await request(app())
        .post("/jobs")
        .set(headers(user))
        .send({ type: "chapter.generate", payload: { n: i } });
      expect(res.status).toBe(202);
    }
    // Simulate the worker having claimed both: still scoped to this user.
    await handle.db.update(jobs).set({ status: "running" }).where(eq(jobs.userId, user));
    const over = await request(app())
      .post("/jobs")
      .set(headers(user))
      .send({ type: "chapter.generate" });
    expect(over.status).toBe(429);
    expect(over.body.error).toBe("job_limit_reached");
  });

  it("cancels a queued job and refuses to cancel terminal jobs", async () => {
    const created = await request(app())
      .post("/jobs")
      .set(headers(other))
      .send({ type: "chapter.humanize" });
    const jobId = created.body.job.id as string;

    const ok = await request(app()).post(`/jobs/${jobId}/cancel`).set(headers(other));
    expect(ok.status).toBe(200);
    expect(ok.body.job.status).toBe("cancelled");

    const again = await request(app()).post(`/jobs/${jobId}/cancel`).set(headers(other));
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("job_already_terminal");
  });
});
