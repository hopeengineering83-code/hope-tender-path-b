import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test the document-level placeholder and quality checks used by
// DocumentValidatorPanel (components/document-validator-panel.tsx).
// These are pure pattern tests — no DB required.

const PLACEHOLDER_RE = [
  /\[insert [^\]]+\]/i,
  /\{[^}]+\}/,
  /\bTODO\b/,
  /\bXXX\b/,
  /\[TBD\]/i,
  /\[NAME\]/i,
  /\[DATE\]/i,
  /\bplaceholder\b/i,
  /Bid-Team\s+to\s+confirm/i,
  /Bid-Team\s+Action/i,
  /Not\s+extracted\s*[—–-]\s*confirm\s+manually/i,
  /MISSING_SOURCE/,
  /\[CLIENT(?:\s+TO\s+BE\s+CONFIRMED)?\]/i,
];

const AI_TRACE_RE = [
  /as an ai/i,
  /language model/i,
  /\bi cannot\b/i,
  /\bas a large language\b/i,
  /I don'?t have access/i,
  /I'?m sorry,? I/i,
];

function hasPlaceholder(text: string): boolean {
  return PLACEHOLDER_RE.some((re) => re.test(text));
}

function hasAiTrace(text: string): boolean {
  return AI_TRACE_RE.some((re) => re.test(text));
}

describe("Document validator — placeholder detection", () => {
  it("detects [insert X] pattern", () => {
    assert.ok(hasPlaceholder("Please [insert company name] here."));
  });

  it("detects {placeholder} curly-brace pattern", () => {
    assert.ok(hasPlaceholder("Value is {TBD_VALUE}."));
  });

  it("detects TODO marker", () => {
    assert.ok(hasPlaceholder("TODO: add financial data"));
  });

  it("detects XXX marker", () => {
    assert.ok(hasPlaceholder("Amount: XXX ETB"));
  });

  it("detects [TBD] bracket", () => {
    assert.ok(hasPlaceholder("Budget: [TBD]"));
  });

  it("detects 'placeholder' word", () => {
    assert.ok(hasPlaceholder("This is a placeholder section."));
  });

  it("detects 'Bid-Team to confirm'", () => {
    assert.ok(hasPlaceholder("Client name: Bid-Team to confirm"));
  });

  it("detects 'Bid-Team Action'", () => {
    assert.ok(hasPlaceholder("Bid-Team Action: insert final price"));
  });

  it("detects MISSING_SOURCE marker", () => {
    assert.ok(hasPlaceholder("Contact email: MISSING_SOURCE — not found in tender document"));
  });

  it("detects 'Not extracted — confirm manually'", () => {
    assert.ok(hasPlaceholder("Phone: Not extracted — confirm manually"));
  });

  it("detects 'Not extracted – confirm manually' (en-dash)", () => {
    assert.ok(hasPlaceholder("Phone: Not extracted – confirm manually"));
  });

  it("detects [CLIENT TO BE CONFIRMED]", () => {
    assert.ok(hasPlaceholder("Dear [CLIENT TO BE CONFIRMED],"));
  });

  it("does NOT flag clean proposal text", () => {
    assert.equal(hasPlaceholder("Hope Engineering PLC is pleased to submit this technical proposal for the Addis Ababa Water Supply Project."), false);
  });

  it("does NOT flag a legitimate date string", () => {
    assert.equal(hasPlaceholder("Submission deadline: 15 June 2026"), false);
  });
});

describe("Document validator — AI-trace detection", () => {
  it("detects 'as an AI'", () => {
    assert.ok(hasAiTrace("As an AI, I cannot provide financial advice."));
  });

  it("detects 'language model'", () => {
    assert.ok(hasAiTrace("I am a language model."));
  });

  it("detects 'I cannot'", () => {
    assert.ok(hasAiTrace("I cannot make guarantees about results."));
  });

  it("detects 'as a large language'", () => {
    assert.ok(hasAiTrace("As a large language model, I ..."));
  });

  it("detects 'I don't have access'", () => {
    assert.ok(hasAiTrace("I don't have access to the tender portal."));
  });

  it("does NOT flag 'I am unable' without AI context", () => {
    assert.equal(hasAiTrace("Hope Engineering is unable to provide a fixed-price guarantee at this stage."), false);
  });

  it("does NOT flag 'we cannot' (third party)", () => {
    assert.equal(hasAiTrace("We cannot guarantee delivery before 30 June."), false);
  });
});

describe("Document validator — forbidden content in final docs", () => {
  it("MISSING_SOURCE is forbidden in exported docs", () => {
    const content = "The client contact email is MISSING_SOURCE — not found in the tender document.";
    assert.ok(hasPlaceholder(content), "MISSING_SOURCE must be detected as a placeholder blocker");
  });

  it("'Bid-Team to confirm' is forbidden in exported docs", () => {
    const content = "Address: Bid-Team to confirm before submission.";
    assert.ok(hasPlaceholder(content), "'Bid-Team to confirm' must be detected");
  });

  it("'Not extracted — confirm manually' is forbidden in exported docs", () => {
    const content = "Deadline: Not extracted — confirm manually";
    assert.ok(hasPlaceholder(content), "'Not extracted — confirm manually' must be detected");
  });
});
