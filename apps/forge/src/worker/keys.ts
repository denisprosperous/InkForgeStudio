/**
 * @inkforge/forge — user API key custody (G-08).
 *
 * Author-supplied provider keys are stored encrypted (AES-256-GCM, key derived
 * from KEY_ENCRYPTION_SECRET) and only ever decrypted inside the worker when a
 * job actually needs them. Nothing here logs key material; the candidate list
 * carries the plaintext only as far as the provider factory.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getActiveUserKeys, type Database } from "@inkforge/db";
import type { ProviderId } from "@inkforge/ai";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

/** Known provider ids; anything else in the store is ignored, not trusted. */
export const KEY_PROVIDERS: readonly ProviderId[] = ["openai", "gemini", "deepseek"];

export interface EncryptedKey {
  readonly keyCipher: string;
  readonly keyIv: string;
  readonly keyTag: string;
}

function encryptionKey(secret: string): Buffer {
  if (secret.trim().length === 0) {
    throw new Error("forge: KEY_ENCRYPTION_SECRET is required to use stored author keys");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptApiKey(plaintext: string, secret: string): EncryptedKey {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    keyCipher: encrypted.toString("base64"),
    keyIv: iv.toString("base64"),
    keyTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptApiKey(input: EncryptedKey, secret: string): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(secret),
    Buffer.from(input.keyIv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(input.keyTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.keyCipher, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export interface StoredUserKeyCandidate {
  readonly keyId: string;
  readonly provider: ProviderId;
  readonly apiKey: string;
}

/**
 * Active keys for the principal, newest first, decrypted. A single corrupt or
 * undecryptable row is skipped rather than failing the whole job — one bad key
 * must not take the queue down.
 */
export async function loadUserKeyCandidates(
  db: Database,
  userId: string,
  keySecret: string | undefined,
  logger?: { warn(obj: Record<string, unknown>, msg?: string): void },
): Promise<StoredUserKeyCandidate[]> {
  if (keySecret === undefined || keySecret.trim() === "") return [];
  const rows = await getActiveUserKeys(db, userId);
  const candidates: StoredUserKeyCandidate[] = [];
  for (const row of rows) {
    if (!(KEY_PROVIDERS as readonly string[]).includes(row.provider)) continue;
    try {
      candidates.push({
        keyId: row.id,
        provider: row.provider as ProviderId,
        apiKey: decryptApiKey(
          { keyCipher: row.keyCipher, keyIv: row.keyIv, keyTag: row.keyTag },
          keySecret,
        ),
      });
    } catch (error) {
      logger?.warn(
        { keyId: row.id, error: error instanceof Error ? error.message : String(error) },
        "worker: skipping undecryptable author key",
      );
    }
  }
  return candidates;
}
