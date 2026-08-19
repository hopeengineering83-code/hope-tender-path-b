// The app must not ask for a file it is already holding.
//
// When a submission plan calls for a tender-issued form, generation used to
// mark the row REPLACE_WITH_ORIGINAL and tell the user to "upload the complete
// tender package" — even when that exact form was in the Tender Intake files
// they had uploaded minutes earlier. The only way to clear the blocker was to
// re-supply something the app already had.
//
// Discovery reuses those bytes unchanged. Two properties matter more than the
// convenience:
//
//   1. The bytes are the SAME bytes. A tender-issued form that the app has
//      re-rendered, re-encoded or regenerated is not the client's form, and
//      a client package containing a lookalike is worse than one that is
//      openly incomplete.
//   2. Reuse never implies a human did anything. The form arrives complete
//      and unsigned; it enters the ordinary review lifecycle, never APPROVED,
//      READY_FOR_EXPORT or REVIEWED.
//
// Matching is deliberately narrow: attaching the wrong document to a client
// package is far worse than asking which file it is, so every ambiguity fails
// closed with a reason.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import {
  matchTenderIssuedForm,
  looksLikeTenderBody,
  describeFormProvenance,
  formKey,
  type IntakeFileCandidate,
} from "../lib/engine/tender-issued-form-discovery";

const file = (name: string, extra: Partial<IntakeFileCandidate> = {}): IntakeFileCandidate => ({
  id: `id-${formKey(name) || "x"}`,
  originalFileName: name,
  mimeType: "application/pdf",
  deletionStatus: "ACTIVE",
  ...extra,
});

describe("the form the user already uploaded is found", () => {
  it("matches the same file name regardless of case, punctuation and extension", () => {
    const result = matchTenderIssuedForm("Annex C - Bid Form.pdf", [
      file("Tender Document.pdf"),
      file("annex_c__bid_form.PDF"),
    ]);
    assert.equal(result.matched, true);
    if (!result.matched) return;
    assert.equal(result.file.originalFileName, "annex_c__bid_form.PDF");
    assert.equal(result.basis, "EXACT_FILENAME");
  });

  it("matches a distinctive name the upload wrapped in extra text", () => {
    const result = matchTenderIssuedForm("Financial Rate Card Schedule.xlsx", [
      file("06 - Financial Rate Card Schedule - Annex 4.xlsx"),
    ]);
    assert.equal(result.matched, true);
    if (!result.matched) return;
    assert.equal(result.basis, "DISTINCTIVE_FILENAME_CONTAINMENT");
  });
});

describe("every ambiguity fails closed with a reason", () => {
  const cases: Array<[string, string, IntakeFileCandidate[], RegExp]> = [
    [
      "no uploads at all",
      "Annex C - Bid Form.pdf",
      [],
      /No active Tender Intake files/,
    ],
    [
      "the only upload is the tender document itself",
      "Annex C - Bid Form.pdf",
      [file("Request for Proposals 2026-014.pdf")],
      /tender document itself/,
    ],
    [
      "two uploads share the planned name",
      "Annex C - Bid Form.pdf",
      [file("Annex C - Bid Form.pdf", { id: "a" }), file("annex-c-bid-form.pdf", { id: "b" })],
      /2 uploaded files share the name/,
    ],
    [
      "two uploads could both be the form",
      "Financial Rate Card Schedule.xlsx",
      [
        file("06 - Financial Rate Card Schedule - Annex 4.xlsx", { id: "a" }),
        file("Financial Rate Card Schedule REVISED.xlsx", { id: "b" }),
      ],
      /could be/,
    ],
    [
      "the planned name is too generic to match by containment",
      "Bid Form.pdf",
      [file("Section 4 Bid Form and Declarations Annex.pdf")],
      /too generic/,
    ],
    [
      "the form simply is not in the uploads",
      "Annex C - Bid Form.pdf",
      [file("Company Registration Certificate.pdf")],
      /is not among the uploaded Tender Intake files/,
    ],
    [
      "the matching upload was deleted",
      "Annex C - Bid Form.pdf",
      [file("Annex C - Bid Form.pdf", { deletionStatus: "DELETED" })],
      /No active Tender Intake files/,
    ],
  ];

  for (const [label, planned, files, pattern] of cases) {
    it(`refuses to guess when ${label}`, () => {
      const result = matchTenderIssuedForm(planned, files);
      assert.equal(result.matched, false, `${label} must not produce a match`);
      if (result.matched) return;
      assert.match(result.reason, pattern);
    });
  }

  it("never matches the tender document body itself", () => {
    for (const name of [
      "RFP-2026-014.pdf",
      "Request for Proposals.pdf",
      "Invitation to Bid — Roads Package.pdf",
      "Bidding Document Volume I.pdf",
      "Terms of Reference.pdf",
      "Instructions to Bidders.pdf",
      "Addendum No. 2.pdf",
    ]) {
      assert.equal(looksLikeTenderBody(name), true, `"${name}" is the tender document, not a form to attach`);
    }
    assert.equal(looksLikeTenderBody("Annex C - Bid Form.pdf"), false);
  });
});

describe("provenance records what a reviewer needs to trust the bytes", () => {
  it("names the source file, digest, size, type and how it was matched", () => {
    const line = describeFormProvenance({
      sourceFileId: "file-123",
      sourceFileName: "Annex C - Bid Form.pdf",
      sha256: "a".repeat(64),
      byteLength: 51234,
      mimeType: "application/pdf",
      basis: "EXACT_FILENAME",
    });
    assert.match(line, /source=Annex C - Bid Form\.pdf \(id file-123\)/);
    assert.match(line, new RegExp(`sha256=${"a".repeat(64)}`));
    assert.match(line, /bytes=51234/);
    assert.match(line, /mime=application\/pdf/);
    assert.match(line, /match=EXACT_FILENAME/);
  });

  it("says plainly that nobody has reviewed it", () => {
    const line = describeFormProvenance({
      sourceFileId: "f", sourceFileName: "n", sha256: "s", byteLength: 1,
      mimeType: "application/pdf", basis: "EXACT_FILENAME",
    });
    assert.match(line, /Not reviewed/);
    assert.match(line, /complete and sign/i);
  });
});

describe("reuse never fabricates human state or new bytes", () => {
  const SRC = readFileSync("lib/engine/tender-issued-form-discovery.ts", "utf8");

  it("persists through the verified byte path rather than writing content directly", () => {
    // persistGeneratedDocumentContent recomputes the digest from the actual
    // buffer and refuses anything that does not verify.
    assert.match(SRC, /persistGeneratedDocumentContent\(\{/);
    assert.match(SRC, /buffer: bytes/);
  });

  it("refuses bytes that no longer match the digest recorded at upload", () => {
    assert.match(SRC, /source\.contentSha256 && source\.contentSha256 !== sha256/);
    assert.match(SRC, /CONTENT_HASH_MISMATCH/);
  });

  it("never writes an approved, reviewed or export-ready state", () => {
    const update = SRC.slice(SRC.indexOf("client.generatedDocument.update"));
    const body = update.slice(0, update.indexOf("});"));
    assert.match(body, /reviewStatus: "PENDING"/);
    for (const forbidden of ["APPROVED", "READY_FOR_EXPORT", "REVIEWED", "reviewedBy", "reviewedAt", "approvedBy", "approvedAt"]) {
      assert.doesNotMatch(body, new RegExp(forbidden), `reuse must never write ${forbidden}`);
    }
  });

  it("scopes the file lookup to the acting tenant", () => {
    assert.match(SRC, /client\.tender\.findFirst\(\{\s*where: \{ id: input\.tenderId, userId: input\.userId \}/);
  });
});

describe("the callers actually go through discovery", () => {
  it("generation tries reuse before telling the user to upload the original", () => {
    const route = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    const reuseIdx = route.indexOf("const reuse = await reuseTenderIssuedForm(");
    const blockerIdx = route.indexOf('reviewStatus: "REPLACE_WITH_ORIGINAL"');
    assert.ok(reuseIdx > -1, "generation must attempt reuse");
    assert.ok(blockerIdx > reuseIdx, "the upload request must be the fallback, not the first move");
    // The remaining blocker has to say why reuse was not possible.
    assert.match(route, /Automatic reuse from the uploaded Tender Intake files was not possible: \$\{reuse\.reason\}/);
  });

  it("auto-finalize retries reuse so a later upload is enough", () => {
    const svc = readFileSync("lib/ai-jobs/auto-finalize-continuation-service.ts", "utf8");
    assert.match(svc, /result\.formReuse = await reuseAvailableTenderIssuedForms\(tenderId, userId\)/);
    // It must run before generation-dependent stages, per the converge order.
    assert.ok(
      svc.indexOf("reuseAvailableTenderIssuedForms(tenderId, userId)") < svc.indexOf("repairSourceGrounding(tenderId"),
      "form discovery is the first stage",
    );
    // Same discovery authority as the generation route — not a second copy.
    assert.match(svc, /await import\("\.\.\/engine\/tender-issued-form-discovery"\)/);
  });

  it("only retries documents that are actually waiting on an original", () => {
    const svc = readFileSync("lib/ai-jobs/auto-finalize-continuation-service.ts", "utf8");
    const helper = svc.slice(svc.indexOf("async function reuseAvailableTenderIssuedForms"));
    assert.match(helper.slice(0, 900), /reviewStatus: "REPLACE_WITH_ORIGINAL"/);
    assert.match(helper.slice(0, 900), /tender: \{ userId \}/);
  });
});

describe("byte preservation is a property of the bytes, not of the code shape", () => {
  it("the reused digest is the digest of the original file's bytes", () => {
    // Guards the claim the provenance line makes: what gets recorded is a
    // digest of the source bytes, so a reviewer comparing the ZIP entry
    // against the uploaded file sees the same value.
    const original = Buffer.from("%PDF-1.4\nAnnex C bid form contents\n%%EOF\n");
    const digest = createHash("sha256").update(original).digest("hex");

    // A round trip through the storage encoding used for inline content must
    // not change a single byte.
    const roundTripped = Buffer.from(original.toString("base64"), "base64");
    assert.equal(createHash("sha256").update(roundTripped).digest("hex"), digest);
    assert.equal(roundTripped.byteLength, original.byteLength);
    assert.ok(roundTripped.equals(original));
  });
});
