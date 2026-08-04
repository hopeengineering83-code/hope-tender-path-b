// The UI must not tell users to run actions that no longer exist.
//
// components/score-breakdown-panel.tsx carried three of these:
//
//   "No dimension scores — run AI Rematch"
//   "No expert or project matches yet. Run Engine or AI Rematch to generate…"
//   "No 12-perspective dimension scores found. Run AI Rematch to populate…"
//
// "AI Rematch" has no route and no button anywhere in the app — searching
// app/api for a rematch route returns nothing. "Run Engine" was removed from
// the normal path as workflow bureaucracy. So the panel instructed users to
// perform two things they cannot do, in the one place they would look when
// scores were missing.
//
// This is worse than an ordinary stale string. It converts "the pipeline has
// not reached this stage yet" into "you have failed to do something", which is
// exactly the bureaucracy the release is removing — and it sends the reader
// hunting for a control that was deliberately deleted.
//
// The check is written against the removed VERBS rather than a fixed list of
// panels, so the same instruction reappearing anywhere else is caught too.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["components", "app/dashboard"];

/**
 * Imperative instructions naming an action the app no longer offers.
 *
 * Scoped to the IMPERATIVE forms on purpose. "Run Engine" and "AI Analyze"
 * survive as STAGE NAMES in descriptive copy ("Run Engine verifies them
 * automatically — no action is needed here"), which is accurate and is pinned
 * by tests such as company-vault-automatic-no-user-action.test.ts. Renaming the
 * stages is a separate change; telling the user to invoke them is the defect.
 */
const REMOVED_ACTION_INSTRUCTIONS = [
  /\bRun\s+AI\s+Rematch\b/i,
  /\bRun\s+AI\s+Analyze\b/i,
  /\bRun\s+Engine\s+(?:first|or)\b/i,
  /\bRun\s+OCR\b/i,
  /\bClick\s+(?:Run\s+Engine|Generate|Repair|Finalize|Validate)\b/i,
  /\bpress\s+(?:Run\s+Engine|Generate|Repair)\b/i,
  /\buse\s+the\s+repair\s+tool\b/i,
];

function uiFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".tsx")) out.push(full);
    }
  };
  ROOTS.forEach(walk);
  return out;
}

/** Strip comments so prose describing the old wording is not a hit. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const FILES = uiFiles();

describe("no user-facing text instructs an action that was removed", () => {
  it("holds across every dashboard component and page", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = code(readFileSync(file, "utf8"));
      for (const pattern of REMOVED_ACTION_INSTRUCTIONS) {
        if (pattern.test(src)) offenders.push(`${file} :: ${pattern}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "these tell the user to run something the app no longer offers; describe what the " +
        "pipeline is doing instead",
    );
  });
});

describe("the premise still holds", () => {
  it("AI Rematch really has no route", () => {
    // If a rematch endpoint is ever added back, the instructions above stop
    // being false and this guard needs revisiting rather than silently passing.
    const apiDirs: string[] = [];
    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          apiDirs.push(full);
          walk(full);
        }
      }
    };
    walk("app/api");
    assert.deepEqual(
      apiDirs.filter((d) => /rematch/i.test(d)),
      [],
      "a rematch route exists again — revisit whether the UI may reference it",
    );
  });

  it("the detector matches the exact strings that were removed", () => {
    // Without this, a regex that matched nothing would let the sweep pass
    // forever while the instructions crept back.
    const removed = [
      "No dimension scores — run AI Rematch",
      "No expert or project matches yet. Run Engine or AI Rematch to generate dimension scores.",
      "No 12-perspective dimension scores found. Run AI Rematch to populate detailed dimension scoring.",
      "Run Engine first, then retry.",
      "AI providers are configured but no successful response has been recorded on this instance yet — runtime availability is not verified. Run AI Analyze or Generate Docs to confirm.",
      "No tender requirements are extracted yet. Run AI Analyze or add requirements manually before building the submission package.",
      "5 mandatory requirement(s) lack source page/quote. Run AI Analyze again or use the repair tool.",
      "Analysis source not yet determined. Run AI Analyze only after extraction is reliable enough for analysis.",
      // The `i` flag makes \bRun\b match across the hyphen in "Re-run", which
      // is how these three were caught after a line-based grep for
      // "Run AI Analyze" reported the file clean. Keep them: they are the
      // reason the check is a regex sweep and not a grep.
      "Re-run AI Analyze on weak extraction",
      "Bid strategy requires reliable extraction and analysis. Run OCR or re-run AI Analyze first.",
      "Analysis by regex fallback — AI providers failed. Re-run AI Analyze.",
      // There is no OCR engine at all: lib/extraction/tender-text-extractor.ts
      // only *marks* pages ocr_required/ocr_unavailable, and no route performs
      // it. Recommending OCR was advice the app could never carry out.
      "Fix Extraction First. Run OCR, re-extract, or upload a clearer PDF before running AI Analyze.",
      "Results may be missing tender pages. Re-extract or run OCR for a more reliable analysis.",
    ];
    for (const text of removed) {
      assert.ok(
        REMOVED_ACTION_INSTRUCTIONS.some((p) => p.test(text)),
        `detector must flag: ${text}`,
      );
    }
  });

  it("does not flag the stage names used descriptively", () => {
    // The counterweight to the rule above. If the detector widened to bare
    // "Run Engine" it would fire on accurate copy across the Vault pages and
    // the only way to pass would be to weaken it back — so pin the distinction.
    const accurate = [
      "Run Engine verifies them automatically — no review step is required.",
      "Run Engine owns scoring and selection automatically.",
      "Run Engine automatically source-verifies eligible expert records before matching and generation.",
      "AI Analyze will fall back to regex (UNAPPROVED) until a provider's cooldown expires.",
    ];
    for (const text of accurate) {
      assert.ok(
        !REMOVED_ACTION_INSTRUCTIONS.some((p) => p.test(text)),
        `detector must NOT flag descriptive copy: ${text}`,
      );
    }
  });
});
