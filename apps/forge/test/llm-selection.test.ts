/**
 * G-08 — the worker's three-tier provider chain against a real key store.
 *
 * Live Postgres required (INKFORGE_PG_TEST=1): keys are stored encrypted in
 * `user_api_keys`, so this proves the whole custody path — encrypt, persist,
 * load, decrypt, select — rather than just the pure helper.
 */
import { randomUUID } from "node:crypto";
import { loadConfig } from "@inkforge/config";
import { getActiveUserKeys, revokeUserKey, storeUserKey } from "@inkforge/db";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { decryptApiKey, encryptApiKey, loadUserKeyCandidates } from "../src/worker/keys";
import { resolveLlm, resolveLlmForUser } from "../src/worker/llm";
import { createFreshDb, type FreshDb } from "./helpers/fresh-db";

const ENABLED = process.env.INKFORGE_PG_TEST === "1";
const d = describe.skipIf(!ENABLED);

const SECRET = "unit-test-encryption-secret";

describe("key custody (G-08)", () => {
  it("round-trips a key through AES-256-GCM and rejects tampering", () => {
    const stored = encryptApiKey("sk-author-key", SECRET);
    expect(stored.keyCipher).not.toContain("sk-author-key");
    expect(decryptApiKey(stored, SECRET)).toBe("sk-author-key");
    expect(() =>
      decryptApiKey({ ...stored, keyTag: Buffer.alloc(16).toString("base64") }, SECRET),
    ).toThrow();
    expect(() => encryptApiKey("x", "")).toThrow(/KEY_ENCRYPTION_SECRET/);
  });
});

d("worker provider chain (G-08)", () => {
  let handle: FreshDb;
  const user = `user-${randomUUID()}`;
  const config = loadConfig({
    KEY_ENCRYPTION_SECRET: SECRET,
    OPENAI_API_KEY: "sk-platform-openai",
    LOCAL_LLM_ENABLED: "false",
  });

  beforeAll(async () => {
    handle = await createFreshDb("forgellm");
  }, 60_000);

  afterAll(async () => {
    await handle.destroy();
  }, 30_000);

  it("uses the author's stored key before the platform key", async () => {
    const encrypted = encryptApiKey("sk-author-gemini", SECRET);
    const row = await storeUserKey(handle.db, user, {
      label: "my gemini key",
      provider: "gemini",
      ...encrypted,
    });
    const resolved = await resolveLlmForUser({ db: handle.db, config, userId: user });
    expect(resolved).toMatchObject({
      source: "user",
      provider: "gemini",
      keyId: row.id,
      model: "gemini-2.5-pro",
    });
    // Revoked keys must not be used.
    await revokeUserKey(handle.db, user, row.id);
    const afterRevoke = await resolveLlmForUser({ db: handle.db, config, userId: user });
    expect(afterRevoke).toMatchObject({ source: "platform", provider: "openai" });
  });

  it("skips an undecryptable key row instead of failing the job", async () => {
    const other = `user-${randomUUID()}`;
    await storeUserKey(handle.db, other, {
      label: "corrupt",
      provider: "openai",
      keyCipher: Buffer.from("not-a-real-ciphertext").toString("base64"),
      keyIv: Buffer.alloc(12).toString("base64"),
      keyTag: Buffer.alloc(16).toString("base64"),
    });
    const candidates = await loadUserKeyCandidates(handle.db, other, SECRET);
    expect(candidates).toHaveLength(0);
    const rows = await getActiveUserKeys(handle.db, other);
    expect(rows).toHaveLength(1); // row survives; only its use was skipped
    const resolved = await resolveLlmForUser({ db: handle.db, config, userId: other });
    expect(resolved).toMatchObject({ source: "platform", provider: "openai" });
  });

  it("climbs to the flag-gated local fallback only when enabled", async () => {
    const nobody = `user-${randomUUID()}`;
    const noKeys = loadConfig({ KEY_ENCRYPTION_SECRET: SECRET, LOCAL_LLM_ENABLED: "false" });
    expect(await resolveLlmForUser({ db: handle.db, config: noKeys, userId: nobody })).toBeUndefined();
    expect(resolveLlm(noKeys)).toBeUndefined();

    const fallback = loadConfig({ KEY_ENCRYPTION_SECRET: SECRET, LOCAL_LLM_ENABLED: "true" });
    const local = await resolveLlmForUser({ db: handle.db, config: fallback, userId: nobody });
    expect(local).toMatchObject({ source: "local", provider: "local" });
    expect(resolveLlm(fallback)).toMatchObject({ source: "local", provider: "local" });
    const completion = await local!.client.complete("draft a scene");
    expect(completion.provider).toBe("local");
  });

  it("honours the DEFAULT_AI_PROVIDER pin across the platform tier", () => {
    const pinned = loadConfig({
      KEY_ENCRYPTION_SECRET: SECRET,
      OPENAI_API_KEY: "sk-platform-openai",
      DEEPSEEK_API_KEY: "sk-platform-deepseek",
      DEFAULT_AI_PROVIDER: "deepseek",
    });
    expect(resolveLlm(pinned)).toMatchObject({ source: "platform", provider: "deepseek" });
  });
});