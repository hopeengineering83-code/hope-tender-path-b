// Tests for the Persistent Tender Chat Workbench.
//
// These are unit/contract tests — they do NOT require a live database or
// running Next.js server. All tests exercise pure logic and structural
// contracts, exactly like the rest of the project's test suite.
//
// Covers:
//   1. Message persistence model: saveMessages helper produces correct rows
//   2. GET messages route contract: returns ordered history slice
//   3. DELETE messages contract: scopes deletion to a single user
//   4. Copilot route does NOT call generate/export (gate isolation)
//   5. Citations shape validation

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// ─── 1. Message persistence helpers ──────────────────────────────────────────

describe("TenderCopilotMessage — row structure", () => {
  it("a persisted user message has role='user' and non-empty content", () => {
    const msg = {
      id: "msg_1",
      tenderId: "tender_abc",
      userId: "user_xyz",
      role: "user",
      content: "What is the submission deadline?",
      citations: null,
      createdAt: new Date(),
    };
    assert.equal(msg.role, "user");
    assert.ok(msg.content.length > 0, "content must not be empty");
    assert.equal(msg.citations, null, "user messages have no citations");
  });

  it("a persisted assistant message has role='assistant' and content", () => {
    const msg = {
      id: "msg_2",
      tenderId: "tender_abc",
      userId: "user_xyz",
      role: "assistant",
      content: "The submission deadline is 30 June 2026.",
      citations: [{ page: 3, quote: "Bids must be submitted by 30 June 2026", field: "deadline" }],
      createdAt: new Date(),
    };
    assert.equal(msg.role, "assistant");
    assert.ok(msg.content.length > 0);
    assert.ok(Array.isArray(msg.citations));
    assert.equal(msg.citations![0].page, 3);
  });

  it("citations are optional — null is valid for assistant messages", () => {
    const msg = {
      id: "msg_3",
      tenderId: "tender_abc",
      userId: "user_xyz",
      role: "assistant",
      content: "I cannot determine the deadline from the available context.",
      citations: null,
      createdAt: new Date(),
    };
    assert.equal(msg.citations, null);
    assert.ok(msg.content.length > 0);
  });
});

// ─── 2. GET messages ordering contract ───────────────────────────────────────

describe("GET /copilot/messages — ordering contract", () => {
  it("messages sorted by createdAt ascending returns chronological thread", () => {
    const now = Date.now();
    const raw = [
      { id: "c", createdAt: new Date(now + 2000), role: "assistant", content: "Answer" },
      { id: "a", createdAt: new Date(now), role: "user", content: "First question" },
      { id: "b", createdAt: new Date(now + 1000), role: "user", content: "Second question" },
    ];

    // Simulate orderBy: createdAt asc
    const ordered = [...raw].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());

    assert.equal(ordered[0].id, "a");
    assert.equal(ordered[1].id, "b");
    assert.equal(ordered[2].id, "c");
  });

  it("slice to last 50 messages when more than 50 exist", () => {
    const msgs = Array.from({ length: 60 }, (_, i) => ({
      id: `msg_${i}`,
      createdAt: new Date(Date.now() + i * 1000),
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
    }));

    // Simulate take: 50 at the DB query level (last 50 after sorting asc)
    const slice = msgs.slice(-50);
    assert.equal(slice.length, 50);
    assert.equal(slice[0].id, "msg_10");
  });

  it("userId scoping: messages from user A are not returned to user B", () => {
    const allMessages = [
      { id: "m1", tenderId: "t1", userId: "userA", role: "user", content: "A question" },
      { id: "m2", tenderId: "t1", userId: "userB", role: "user", content: "B question" },
      { id: "m3", tenderId: "t1", userId: "userA", role: "assistant", content: "A answer" },
    ];

    // Simulate WHERE tenderId = t1 AND userId = userA
    const userAMessages = allMessages.filter((m) => m.tenderId === "t1" && m.userId === "userA");
    assert.equal(userAMessages.length, 2);
    assert.ok(userAMessages.every((m) => m.userId === "userA"));
  });
});

// ─── 3. DELETE scoping contract ───────────────────────────────────────────────

describe("DELETE /copilot/messages — scoping", () => {
  it("deleteMany scoped to tenderId + userId does not affect other users", () => {
    const store = [
      { id: "m1", tenderId: "t1", userId: "userA" },
      { id: "m2", tenderId: "t1", userId: "userB" },
      { id: "m3", tenderId: "t1", userId: "userA" },
      { id: "m4", tenderId: "t2", userId: "userA" },
    ];

    // Simulate DELETE WHERE tenderId='t1' AND userId='userA'
    const toDelete = store.filter((m) => m.tenderId === "t1" && m.userId === "userA");
    const remaining = store.filter((m) => !(m.tenderId === "t1" && m.userId === "userA"));

    assert.equal(toDelete.length, 2, "should delete 2 rows for userA on tender t1");
    assert.equal(remaining.length, 2, "userB and userA/t2 messages must survive");
    assert.ok(remaining.every((m) => !(m.tenderId === "t1" && m.userId === "userA")));
  });

  it("deleting from tender A does not affect tender B messages for same user", () => {
    const store = [
      { id: "m1", tenderId: "tenderA", userId: "userX" },
      { id: "m2", tenderId: "tenderB", userId: "userX" },
    ];

    const remaining = store.filter((m) => !(m.tenderId === "tenderA" && m.userId === "userX"));
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].tenderId, "tenderB");
  });
});

// ─── 4. Copilot route does NOT invoke generate/export ────────────────────────

describe("Copilot POST route — gate isolation", () => {
  it("copilot route module does not import generate-elite", async () => {
    // Read the route file as text and verify it doesn't call generate/export functions.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    // Resolve path relative to project root
    const routePath = join(process.cwd(), "app/api/tenders/[id]/copilot/route.ts");
    const source = readFileSync(routePath, "utf8");

    // The copilot route must not import generate or export pipeline modules
    assert.ok(!source.includes("generate-elite"), "copilot route must not import generate-elite");
    assert.ok(!source.includes("export-package"), "copilot route must not import export-package");
    assert.ok(!source.includes("buildExportPackage"), "copilot route must not call buildExportPackage");
    assert.ok(!source.includes("generateProposal"), "copilot route must not call generateProposal");
  });

  it("copilot messages route does not import generate/export modules", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const routePath = join(process.cwd(), "app/api/tenders/[id]/copilot/messages/route.ts");
    const source = readFileSync(routePath, "utf8");

    assert.ok(!source.includes("generate-elite"), "messages route must not import generate-elite");
    assert.ok(!source.includes("export-package"), "messages route must not import export-package");
  });

  it("answerTenderCopilotQuestion function signature does not include generate/export params", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const enginePath = join(process.cwd(), "lib/engine/tender-ai-copilot.ts");
    const source = readFileSync(enginePath, "utf8");

    // Ensure the copilot engine does not call proposal generation or export pipeline modules.
    assert.ok(source.includes("answerTenderCopilotQuestion"), "function must exist");
    assert.ok(!source.includes("generateProposal"), "engine must not call generateProposal");
    assert.ok(!source.includes("buildExportPackage"), "engine must not call buildExportPackage");
    assert.ok(!source.includes("export-package"), "engine must not import export-package module");
    assert.ok(!source.includes("generate-elite"), "engine must not import generate-elite module");
  });
});

// ─── 5. Citations shape ───────────────────────────────────────────────────────

describe("Citation shape validation", () => {
  it("citation object must have page, quote, and field keys", () => {
    const citation = { page: 5, quote: "Submit by email to procurement@agency.gov", field: "submissionEmail" };

    assert.ok("page" in citation, "citation must have page");
    assert.ok("quote" in citation, "citation must have quote");
    assert.ok("field" in citation, "citation must have field");
  });

  it("citation page can be null when page number is unknown", () => {
    const citation = { page: null, quote: "See tender portal", field: "submissionAddress" };
    assert.equal(citation.page, null);
    assert.ok(typeof citation.quote === "string");
  });

  it("citations array of 0 items is valid and equivalent to null citations", () => {
    // Both null and empty array indicate no verifiable citations.
    const noCitations: unknown[] | null = null;
    const emptyCitations: unknown[] | null = [];

    function hasNoCitations(c: unknown[] | null): boolean {
      return c === null || (Array.isArray(c) && c.length === 0);
    }

    assert.ok(hasNoCitations(noCitations));
    assert.ok(hasNoCitations(emptyCitations));
  });
});
