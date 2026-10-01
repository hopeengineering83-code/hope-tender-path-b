import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(
  path.join(process.cwd(), "lib/engine/tender-release-snapshot.ts"),
  "utf8",
);

test("release snapshot uses the same canonical tender source set as Analyze and Engine", () => {
  assert.match(source, /import \{ selectCanonicalTenderFiles \} from "\.\.\/tender\/canonical-source-files"/);
  assert.match(source, /const activeFiles = selectCanonicalTenderFiles\(tender\.files\)/);
  assert.doesNotMatch(source, /tender\.files\.filter\(\(f\) => f\.deletionStatus === "ACTIVE"\)/);
  assert.match(source, /files: activeFiles/);
  assert.match(source, /activeTenderFileIds = new Set\(activeFiles\.map/);
  assert.match(source, /mapRequirementsToEvidence\([\s\S]*activeFiles\.map/);
});
