#!/usr/bin/env node
/**
 * Quarterly worklog archival script.
 *
 * Moves entries older than 90 days from the active worklog.md /
 * operator_handoff.md into dated archive files under docs/archive/.
 *
 * Addresses audit gap: GAP-ARCH-04
 *
 * Usage:
 *   node scripts/archive-worklog.mjs                  # dry run (default)
 *   node scripts/archive-worklog.mjs --apply          # actually move entries
 *   node scripts/archive-worklog.mjs --file worklog.md
 *   node scripts/archive-worklog.mjs --file operator_handoff.md
 *
 * The script:
 *   1. Reads the active file.
 *   2. Splits on `---` separators (Session Log entries).
 *   3. For each entry, parses the leading date (YYYY-MM-DD UTC or similar).
 *   4. Entries older than 90 days are moved to docs/archive/<basename>-YYYY-QN.md.
 *   5. The active file is rewritten with only entries from the last 90 days.
 *   6. Archive files are append-only; running the script twice is safe.
 *
 * Safety:
 *   - DRY RUN by default. Use --apply to make changes.
 *   - Never deletes content; only moves it.
 *   - Verifies archive file is writable before modifying the active file.
 *   - Exits non-zero on any parse error or filesystem issue.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");
const ARCHIVE_DIR = join(REPO_ROOT, "docs", "archive");

const DRY_RUN = !process.argv.includes("--apply");
const FILE_ARG = process.argv.find((a) => a.startsWith("--file="));
const FILE_FLAG_IDX = process.argv.indexOf("--file");
const TARGET_FILE = FILE_ARG
  ? FILE_ARG.slice("--file=".length)
  : (FILE_FLAG_IDX >= 0 ? process.argv[FILE_FLAG_IDX + 1] : undefined);

// Default to worklog.md
const FILE_TO_ARCHIVE = TARGET_FILE || "worklog.md";
const FILE_PATH = join(REPO_ROOT, FILE_TO_ARCHIVE);

// 90 days in milliseconds
const ARCHIVAL_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function parseEntryDate(entry) {
  // Look for YYYY-MM-DD anywhere in the first 200 chars of the entry
  const head = entry.slice(0, 200);
  const match = head.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (isNaN(date.getTime())) return null;
  return date;
}

function getQuarter(date) {
  const month = date.getUTCMonth() + 1; // 1-12
  const quarter = Math.ceil(month / 3);
  return `${date.getUTCFullYear()}-Q${quarter}`;
}

function splitEntries(content) {
  // Split on lines that are exactly "---"
  // Keep the header (everything before the first "---") separate.
  const lines = content.split("\n");
  let header = [];
  const entries = [];
  let current = [];
  let seenFirstSeparator = false;

  for (const line of lines) {
    if (line.trim() === "---") {
      if (!seenFirstSeparator) {
        seenFirstSeparator = true;
        if (current.length > 0) {
          header = current;
          current = [];
        }
      } else {
        if (current.length > 0) {
          entries.push(current.join("\n"));
          current = [];
        }
      }
      current.push("---");
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    if (!seenFirstSeparator) {
      header = current;
    } else {
      entries.push(current.join("\n"));
    }
  }
  return { header: header.join("\n"), entries };
}

function main() {
  if (!existsSync(FILE_PATH)) {
    console.error(`File not found: ${FILE_PATH}`);
    process.exit(1);
  }

  console.log(`Reading: ${FILE_PATH}`);
  const content = readFileSync(FILE_PATH, "utf8");
  const originalSize = content.length;
  console.log(`  Size: ${(originalSize / 1024).toFixed(1)} KB`);

  const { header, entries } = splitEntries(content);
  console.log(`  Header: ${header.length} chars`);
  console.log(`  Entries: ${entries.length}`);

  const now = Date.now();
  const cutoff = new Date(now - ARCHIVAL_AGE_MS);
  console.log(`  Cutoff date: ${cutoff.toISOString().slice(0, 10)} (90 days ago)`);

  const toKeep = [];
  const toArchive = new Map(); // quarter -> [entries]

  for (const entry of entries) {
    const date = parseEntryDate(entry);
    if (!date) {
      // No date — keep in active file (safer)
      toKeep.push(entry);
      continue;
    }
    if (date.getTime() < cutoff.getTime()) {
      const quarter = getQuarter(date);
      if (!toArchive.has(quarter)) toArchive.set(quarter, []);
      toArchive.get(quarter).push(entry);
    } else {
      toKeep.push(entry);
    }
  }

  const archiveCount = Array.from(toArchive.values()).reduce((n, e) => n + e.length, 0);
  console.log(`  Entries to keep (recent): ${toKeep.length}`);
  console.log(`  Entries to archive: ${archiveCount}`);

  if (toArchive.size === 0) {
    console.log("Nothing to archive. Exiting.");
    return;
  }

  console.log(`\nArchival plan:`);
  for (const [quarter, ents] of toArchive) {
    console.log(`  Quarter ${quarter}: ${ents.length} entries -> docs/archive/${basename(FILE_TO_ARCHIVE, ".md")}-${quarter}.md`);
  }

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No files modified. Re-run with --apply to archive.");
    return;
  }

  // Apply: write archive files, then rewrite the active file
  mkdirSync(ARCHIVE_DIR, { recursive: true });

  const baseName = basename(FILE_TO_ARCHIVE, ".md");
  for (const [quarter, ents] of toArchive) {
    const archivePath = join(ARCHIVE_DIR, `${baseName}-${quarter}.md`);
    let existingContent = "";
    if (existsSync(archivePath)) {
      existingContent = readFileSync(archivePath, "utf8") + "\n\n";
    }
    const archiveContent =
      `# Archive: ${baseName} — ${quarter}\n\n` +
      `Auto-archived by \`scripts/archive-worklog.mjs\` on ${new Date().toISOString()}\n` +
      `Origin: active \`${FILE_TO_ARCHIVE}\` file\n\n` +
      existingContent +
      ents.join("\n\n");
    writeFileSync(archivePath, archiveContent, "utf8");
    console.log(`  Wrote: ${archivePath}`);
  }

  // Rewrite the active file with only recent entries
  const newContent =
    header.trimEnd() +
    "\n\n" +
    toKeep.join("\n\n") +
    "\n";
  writeFileSync(FILE_PATH, newContent, "utf8");
  console.log(`  Rewrote: ${FILE_PATH} (${(newContent.length / 1024).toFixed(1)} KB, was ${(originalSize / 1024).toFixed(1)} KB)`);
  console.log(`  Reduction: ${((1 - newContent.length / originalSize) * 100).toFixed(1)}%`);

  console.log("\nDone. Verify the active file and the archive files before committing.");
}

try {
  main();
} catch (err) {
  console.error("Archive failed:", err);
  process.exit(1);
}
