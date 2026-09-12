import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const banner = readFileSync("components/requirement-truth-banner.tsx", "utf8");
const sync = readFileSync("lib/ui/tender-workflow-sync.ts", "utf8");

describe("tender workflow synchronization safety", () => {
  it("uses App Router refresh instead of a destructive browser reload", () => {
    assert.match(banner, /useRouter/);
    assert.match(banner, /router\.refresh\(\)/);
    assert.doesNotMatch(banner, /window\.location\.reload/);
  });

  it("defers automatic refresh while active or blurred form values are unsaved", () => {
    assert.match(banner, /isUserEditingDocument\(\)/);
    assert.match(sync, /control\.value !== control\.defaultValue/);
    assert.match(sync, /control\.checked !== control\.defaultChecked/);
    assert.match(sync, /option\.selected !== option\.defaultSelected/);
    assert.match(sync, /Boolean\(control\.files\?\.length\)/);
  });

  it("keeps the canonical fingerprint timestamp-free", () => {
    const start = sync.indexOf("export function canonicalWorkflowFingerprint");
    const end = sync.indexOf("export function workflowHasInProgressStage");
    assert.ok(start >= 0 && end > start, "canonical fingerprint function boundaries must exist");
    const fingerprintImplementation = sync.slice(start, end);
    assert.doesNotMatch(fingerprintImplementation, /generatedAt/);
    assert.doesNotMatch(fingerprintImplementation, /changedAt/);
  });
});
