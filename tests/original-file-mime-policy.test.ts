import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

function extension(value: string): string {
  return value.split(".").pop()?.toLowerCase() ?? "";
}

function canonicalMimeType(name: string, browserMimeType: string): string {
  const ext = extension(name);
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "doc") return "application/msword";
  if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === "xls") return "application/vnd.ms-excel";
  return browserMimeType || "application/octet-stream";
}

describe("official original MIME fallback policy", () => {
  it("uses extension to canonicalize generic browser MIME values", () => {
    assert.equal(canonicalMimeType("Rate Card.xlsx", "application/octet-stream"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(canonicalMimeType("Legacy Rate Card.xls", ""), "application/vnd.ms-excel");
    assert.equal(canonicalMimeType("Official Form.docx", "application/octet-stream"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.equal(canonicalMimeType("Signed Form.pdf", "application/octet-stream"), "application/pdf");
  });
});
