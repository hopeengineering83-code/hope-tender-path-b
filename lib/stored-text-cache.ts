/**
 * Extracted text for status reads, without moving it out of Postgres on every
 * poll.
 *
 * 2026-10-08: a tender page polls its status every 30 s (8 s while work runs),
 * and each poll re-checks the provenance of the selected experts and projects
 * against their source documents' text and re-scores each tender file's text.
 * With an ordinary Company Vault (a CV compilation and a project portfolio of
 * ~0.4 MB of text each) one poll moved ~1 MB of text out of the database —
 * ~120 MB an hour for one idle tab, on a plan whose whole monthly transfer is
 * a few GB. The text almost never changes between two polls.
 *
 * So a status read selects the row without its text, asks Postgres for the
 * text's MD5 (computed in the database, a few bytes per row), and downloads
 * the text only when this server instance does not already hold that exact
 * text. The cache is keyed by the hash of the text itself, computed here from
 * the bytes received, so a changed text can never be served from the cache:
 * its database hash no longer matches. A database or test double without raw
 * queries simply downloads the text, exactly as before.
 */

import { createHash } from "node:crypto";

export type StoredTextTable = "TenderFile" | "CompanyDocument";

const TABLE_SQL: Record<StoredTextTable, string> = {
  TenderFile: `"TenderFile"`,
  CompanyDocument: `"CompanyDocument"`,
};
const MODEL: Record<StoredTextTable, "tenderFile" | "companyDocument"> = {
  TenderFile: "tenderFile",
  CompanyDocument: "companyDocument",
};

/** Characters held across all entries before the oldest are dropped. */
const MAX_CACHED_CHARS = 24_000_000;
const cache = new Map<string, { hash: string; text: string }>();
let cachedChars = 0;

function remember(key: string, hash: string, text: string): void {
  const previous = cache.get(key);
  if (previous) {
    cachedChars -= previous.text.length;
    cache.delete(key);
  }
  if (text.length > MAX_CACHED_CHARS / 4) return;
  cache.set(key, { hash, text });
  cachedChars += text.length;
  for (const [oldest, entry] of cache) {
    if (cachedChars <= MAX_CACHED_CHARS) break;
    cache.delete(oldest);
    cachedChars -= entry.text.length;
  }
}

function md5(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex");
}

/** Test seam: what the last call downloaded, and a way to start cold. */
export const storedTextCacheStats = { downloadedRows: 0, servedFromCache: 0 };
export function clearStoredTextCache(): void {
  cache.clear();
  cachedChars = 0;
}

/**
 * The extracted text of each row id, or null when the row has none. Reads the
 * text from the database only for rows this instance does not already hold at
 * the database's current version.
 */
export async function loadStoredTexts(db: any, table: StoredTextTable, ids: readonly string[]): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const out = new Map<string, string | null>();
  if (unique.length === 0) return out;

  const download = async (wanted: string[]) => {
    if (wanted.length === 0) return;
    // A test double without this model has no text to give.
    if (typeof db?.[MODEL[table]]?.findMany !== "function") return;
    const rows: Array<{ id: string; extractedText: string | null }> = await db[MODEL[table]].findMany({
      where: { id: { in: wanted } },
      select: { id: true, extractedText: true },
    });
    storedTextCacheStats.downloadedRows += rows.length;
    for (const row of rows) {
      out.set(row.id, row.extractedText ?? null);
      if (typeof row.extractedText === "string") remember(`${table}:${row.id}`, md5(row.extractedText), row.extractedText);
    }
  };

  if (typeof db?.$queryRawUnsafe !== "function") {
    await download(unique);
    return out;
  }
  let hashes: Array<{ id: string; h: string | null }>;
  try {
    hashes = await db.$queryRawUnsafe(`SELECT id, md5("extractedText") AS h FROM ${TABLE_SQL[table]} WHERE id = ANY($1::text[])`, unique);
  } catch {
    await download(unique);
    return out;
  }
  const missing: string[] = [];
  for (const row of hashes) {
    if (row.h === null) {
      out.set(row.id, null);
      continue;
    }
    const hit = cache.get(`${table}:${row.id}`);
    if (hit && hit.hash === row.h) {
      out.set(row.id, hit.text);
      storedTextCacheStats.servedFromCache += 1;
    } else {
      missing.push(row.id);
    }
  }
  await download(missing);
  return out;
}

/**
 * Fill `extractedText` on rows that were read without it. A row that already
 * carries its text (a test double returning whole objects) is left alone.
 */
export async function fillStoredText<T extends { id: string; extractedText?: string | null }>(db: any, table: StoredTextTable, rows: readonly (T | null | undefined)[]): Promise<void> {
  const pending = rows.filter((row): row is T => Boolean(row) && (row as T).extractedText === undefined);
  if (pending.length === 0) return;
  const texts = await loadStoredTexts(db, table, pending.map((row) => row.id));
  for (const row of pending) row.extractedText = texts.get(row.id) ?? null;
}
