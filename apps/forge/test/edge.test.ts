/**
 * G-30i — edge playbook over HTTP. Live Postgres required
 * (INKFORGE_PG_TEST=1). One authenticated endpoint exposes the eight
 * deterministic edge calculators behind an action discriminator.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { books, createDb, type DbHandle } from "@inkforge/db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const DB_URL =
  process.env.FORGE_TEST_DATABASE_URL ?? "postgres://inkforge:inkforge@localhost:5432/inkforge";
const SECRET = "omega-test-secret";
const d = describe.skipIf(!ENABLED);

function headers(user: string) {
  return { "x-forge-secret": SECRET, "x-forge-user": user };
}

d("edge playbook API (G-30i)", () => {
  let handle: DbHandle;
  const user = `user-${randomUUID()}`;
  const other = `user-${randomUUID()}`;
  let bookId = "";

  beforeAll(async () => {
    handle = createDb(DB_URL, { max: 5 });
    const forgeApp = buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
    const created = await request(forgeApp)
      .post("/books")
      .set(headers(user))
      .send({
        title: "Edge Probe",
        author: "Dana Pryce",
        description: "A smith wakes the old fire.",
        genre: "Fantasy",
      });
    expect(created.status).toBe(201);
    bookId = created.body.book.id;
    await request(forgeApp)
      .post(`/books/${bookId}/chapters`)
      .set(headers(user))
      .send({ title: "The Lamp", markdown: "Mara lit the lamp.\n\nShe waited." });
  }, 60_000);

  afterAll(async () => {
    await handle.db.delete(books).where(inArray(books.userId, [user, other]));
    await handle.close();
  }, 30_000);

  function app() {
    return buildApp({ logLevel: "silent", databaseUrl: DB_URL, sharedSecret: SECRET });
  }

  it("assigns a cover variant and prices a bundle from book meta", async () => {
    const cover = await request(app())
      .post(`/books/${bookId}/edge/playbook`)
      .set(headers(user))
      .send({ action: "cover-variant", variants: [{ variant: "A", label: "Close-up" }, { variant: "B", label: "Wide" }] });
    expect(cover.status).toBe(200);
    expect(["A", "B"]).toContain(cover.body.result.variant);

    const bundle = await request(app())
      .post(`/books/${bookId}/edge/playbook`)
      .set(headers(user))
      .send({
        action: "bundle-price",
        members: [
          { title: "One", priceCents: 499 },
          { title: "Two", priceCents: 699 },
        ],
        discountPercent: 15,
      });
    expect(bundle.status).toBe(200);
    expect(bundle.body.result.priceCents).toBe(Math.round(1198 * 0.85));
  });

  it("builds localization and marketplace artifacts with book context", async () => {
    const localization = await request(app())
      .post(`/books/${bookId}/edge/playbook`)
      .set(headers(user))
      .send({ action: "localization-package", target: { language: "de", territory: "DE", currency: "EUR" } });
    expect(localization.status).toBe(200);
    expect(localization.body.result.segments.length).toBeGreaterThan(0);
    expect(localization.body.result.target.language).toBe("de");

    const listing = await request(app())
      .post(`/books/${bookId}/edge/playbook`)
      .set(headers(user))
      .send({ action: "marketplace-listing", target: "kobo", product: { priceCents: 499, currency: "USD" } });
    expect(listing.status).toBe(200);
    expect(listing.body.result.target).toBe("kobo");
  });

  it("rejects unknown actions and malformed payloads with 400", async () => {
    const unknown = await request(app())
      .post(`/books/${bookId}/edge/playbook`)
      .set(headers(user))
      .send({ action: "make-me-rich" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe("unknown_action");
    const malformed = await request(app())
      .post(`/books/${bookId}/edge/playbook`)
      .set(headers(user))
      .send({ action: "localization-package", target: { language: "deu" } });
    expect(malformed.status).toBe(400);
  });

  it("hides other tenants' books", async () => {
    const foreign = await request(app())
      .post(`/books/${bookId}/edge/playbook`)
      .set(headers(other))
      .send({ action: "cover-variant", variants: [{ variant: "A", label: "x" }] });
    expect(foreign.status).toBe(404);
  });
});
