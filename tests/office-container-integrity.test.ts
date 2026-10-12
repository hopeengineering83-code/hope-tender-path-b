import assert from "node:assert/strict";
import test from "node:test";
import { inspectOfficeContainerBytes } from "../lib/office-container-integrity";

test("accepts valid ZIP-backed Office bytes", () => {
  const result = inspectOfficeContainerBytes(
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
    "profile.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.deepEqual(result, { kind: "valid" });
});

test("safely identifies JSON bytes mislabeled with an Office extension", () => {
  const result = inspectOfficeContainerBytes(
    Buffer.from(JSON.stringify({ company: "Hope", category: "profile" })),
    "profile.docx",
    "application/json",
  );
  assert.equal(result.kind, "json");
  if (result.kind === "json") {
    assert.match(result.text, /Hope/);
    assert.match(result.text, /profile/);
  }
});

test("fails closed for corrupt Office container bytes", () => {
  const result = inspectOfficeContainerBytes(
    Buffer.from("not a zip container"),
    "corrupt.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(result.kind, "invalid");
  if (result.kind === "invalid") assert.match(result.reason, /do not match the \.docx Office container format/i);
});

test("does not interfere with non-Office formats", () => {
  assert.deepEqual(
    inspectOfficeContainerBytes(Buffer.from("plain text"), "notes.txt", "text/plain"),
    { kind: "not_applicable" },
  );
});
