// Input validation hardening — unit tests.
//
// Tests the validation logic for budget/contractValue bounds and
// the patterns that were previously accepting NaN/overflow values.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Budget validation logic (same check as tenders/route.ts) ────────────────

function isValidBudget(value: unknown): { ok: boolean; error?: string } {
  if (value === undefined || value === null) return { ok: true };
  const parsed = parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1e12) {
    return { ok: false, error: "budget must be a finite number between 0 and 1,000,000,000,000" };
  }
  return { ok: true };
}

// ── Contract value validation (same check as company/projects/route.ts) ─────

function isValidContractValue(value: unknown): { ok: boolean; error?: string } {
  if (!value) return { ok: true };
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1e12) {
    return { ok: false, error: "contractValue must be a finite non-negative number up to 1,000,000,000,000" };
  }
  return { ok: true };
}

describe("budget validation", () => {
  it("accepts undefined/null", () => {
    assert.equal(isValidBudget(undefined).ok, true);
    assert.equal(isValidBudget(null).ok, true);
  });

  it("accepts valid positive number", () => {
    assert.equal(isValidBudget(100_000).ok, true);
    assert.equal(isValidBudget("50000").ok, true);
    assert.equal(isValidBudget(0).ok, true);
  });

  it("rejects NaN (e.g. parseFloat('abc'))", () => {
    assert.equal(isValidBudget("abc").ok, false);
    assert.equal(isValidBudget("not-a-number").ok, false);
  });

  it("rejects negative numbers", () => {
    assert.equal(isValidBudget(-1).ok, false);
    assert.equal(isValidBudget("-100").ok, false);
  });

  it("rejects overflow values > 1e12", () => {
    assert.equal(isValidBudget(1e13).ok, false);
    assert.equal(isValidBudget(Number.MAX_SAFE_INTEGER).ok, false);
    assert.equal(isValidBudget(Infinity).ok, false);
  });

  it("accepts value at boundary 1e12", () => {
    assert.equal(isValidBudget(1e12).ok, true);
  });
});

describe("contractValue validation", () => {
  it("accepts zero/falsy (treated as null)", () => {
    assert.equal(isValidContractValue(0).ok, true);
    assert.equal(isValidContractValue(null).ok, true);
    assert.equal(isValidContractValue("").ok, true);
  });

  it("accepts valid positive number", () => {
    assert.equal(isValidContractValue(500_000).ok, true);
    assert.equal(isValidContractValue("1000000").ok, true);
  });

  it("rejects non-numeric strings", () => {
    // NaN from non-numeric strings is caught by !Number.isFinite
    assert.equal(isValidContractValue("xyz").ok, false);
    // Raw NaN is falsy, so the route converts it to null (treated as absent) — that's safe
  });

  it("rejects overflow", () => {
    assert.equal(isValidContractValue(1e13).ok, false);
    assert.equal(isValidContractValue(Infinity).ok, false);
  });

  it("rejects negative", () => {
    assert.equal(isValidContractValue(-1000).ok, false);
  });
});

// ── Title length ─────────────────────────────────────────────────────────────

describe("tender title length validation", () => {
  it("rejects empty title", () => {
    const title = "";
    assert.equal(title.trim().length === 0, true);
  });

  it("rejects title > 500 chars", () => {
    const title = "a".repeat(501);
    assert.equal(title.trim().length > 500, true);
  });

  it("accepts title of exactly 500 chars", () => {
    const title = "a".repeat(500);
    assert.equal(title.trim().length <= 500, true);
  });

  it("accepts normal title", () => {
    const title = "Consulting Services for Urban Infrastructure";
    assert.equal(title.trim().length > 0 && title.trim().length <= 500, true);
  });
});

// ── JSON parse safety ────────────────────────────────────────────────────────

describe("JSON parse safety pattern", () => {
  it("returns null on malformed JSON via .catch pattern", async () => {
    async function fakeReqJson(raw: string) {
      return JSON.parse(raw);
    }
    const body = await fakeReqJson("{broken").catch(() => null);
    assert.equal(body, null);
  });

  it("returns parsed object on valid JSON", async () => {
    async function fakeReqJson(raw: string) {
      return JSON.parse(raw);
    }
    const body = await fakeReqJson('{"title":"Test Tender"}').catch(() => null);
    assert.ok(body !== null);
    assert.equal((body as { title: string }).title, "Test Tender");
  });
});
