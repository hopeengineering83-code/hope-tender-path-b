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
    assert.match(sync, /canonicalWorkflowFingerprint/);
    assert.doesNotMatch(sync, /generatedAt/);
    assert.doesNotMatch(sync, /changedAt:.*canonicalWorkflowFingerprint/s);
  });
});
