// Regression tests for the defensive metadata sanitiser.
//
// The sanitiser is the final defence layer that prevents corrupted
// stored values from reaching AI prompts, theme detection, and
// generated cover letters. Even if a user never clicks the cleanup
// banner, the engine/generate routes call this before reading any
// downstream code, so the corruption can't propagate.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  sanitizeStoredMetadataForEngine,
  computeStoredMetadataPatch,
  listInvalidStoredFields,
} from "../lib/engine/sanitize-stored-metadata";

describe("sanitize-stored-metadata — sanitizeStoredMetadataForEngine", () => {
  it("nullifies the four production-screenshot corruptions", () => {
    const clean = sanitizeStoredMetadataForEngine({
      reference: "only",
      clientName: "references (where available) Photos or drawings of completed projects C. Technical Approach",
      country: "A ddis Ababa",
      clientContactName: "s Contact Person",
    });
    assert.equal(clean.reference, null);
    assert.equal(clean.clientName, null);
    assert.equal(clean.country, null);
    assert.equal(clean.clientContactName, null);
  });

  it("preserves valid values untouched", () => {
    const clean = sanitizeStoredMetadataForEngine({
      reference: "RFP-2026-024",
      clientName: "Pharo Ventures",
      country: "Ethiopia",
      clientContactName: "Esayas Dessalegn",
    });
    assert.equal(clean.reference, "RFP-2026-024");
    assert.equal(clean.clientName, "Pharo Ventures");
    assert.equal(clean.country, "Ethiopia");
    assert.equal(clean.clientContactName, "Esayas Dessalegn");
  });

  it("returns null for null/empty/whitespace values", () => {
    const clean = sanitizeStoredMetadataForEngine({
      reference: null,
      clientName: "",
      country: "   ",
      clientContactName: undefined,
    });
    assert.equal(clean.reference, null);
    assert.equal(clean.clientName, null);
    assert.equal(clean.country, null);
    assert.equal(clean.clientContactName, null);
  });

  it("mixed valid + invalid: only the invalid ones become null", () => {
    const clean = sanitizeStoredMetadataForEngine({
      reference: "RFP-2026-024",          // valid
      clientName: "TOC garbage example",  // depends on validator
      country: "A ddis Ababa",            // invalid
      clientContactName: "Jane Doe",      // valid
    });
    assert.equal(clean.reference, "RFP-2026-024");
    assert.equal(clean.country, null);
    assert.equal(clean.clientContactName, "Jane Doe");
  });
});

describe("sanitize-stored-metadata — computeStoredMetadataPatch (DB update payload)", () => {
  it("returns ONLY the invalid fields with null values", () => {
    const patch = computeStoredMetadataPatch({
      reference: "only",
      clientName: "Pharo Ventures",  // valid — should not be in patch
      country: "A ddis Ababa",
      clientContactName: null,        // already null — not invalid, not in patch
    });
    assert.deepEqual(patch, { reference: null, country: null });
  });

  it("returns empty patch when nothing is invalid (caller skips DB write)", () => {
    const patch = computeStoredMetadataPatch({
      reference: "RFP-2026-024",
      clientName: "Pharo Ventures",
      country: "Ethiopia",
      clientContactName: "Jane Doe",
    });
    assert.deepEqual(patch, {});
  });

  it("returns empty patch when all fields are already null/empty", () => {
    const patch = computeStoredMetadataPatch({
      reference: null,
      clientName: "",
      country: undefined,
      clientContactName: "   ",
    });
    assert.deepEqual(patch, {});
  });
});

describe("sanitize-stored-metadata — listInvalidStoredFields (audit log)", () => {
  it("returns the names of every invalid field", () => {
    const fields = listInvalidStoredFields({
      reference: "only",
      clientName: "references (where available) Photos",
      country: "A ddis Ababa",
      clientContactName: "s Contact Person",
    });
    assert.deepEqual(fields.sort(), ["clientContactName", "clientName", "country", "reference"]);
  });

  it("returns [] when nothing is invalid", () => {
    const fields = listInvalidStoredFields({
      reference: "RFP-2026-024",
      clientName: "Pharo Ventures",
      country: "Ethiopia",
      clientContactName: "Jane Doe",
    });
    assert.deepEqual(fields, []);
  });

  it("treats null/empty/whitespace as not-invalid (those values are already clean)", () => {
    const fields = listInvalidStoredFields({
      reference: null,
      clientName: "",
      country: undefined,
      clientContactName: "   ",
    });
    assert.deepEqual(fields, []);
  });
});
