import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  severityBorderClass,
  severityBgClass,
  severityTextClass,
  severityBadgeClasses,
  scoreToSeverity,
  statusToSeverity,
  confidenceToSeverity,
  type UISeverity,
} from "../lib/ui-tokens";

describe("ui-tokens: severityBorderClass", () => {
  it("returns emerald border for good", () => { assert.ok(severityBorderClass("good").includes("emerald")); });
  it("returns amber border for warning", () => { assert.ok(severityBorderClass("warning").includes("amber")); });
  it("returns red border for poor", () => { assert.ok(severityBorderClass("poor").includes("red")); });
  it("returns slate border for muted", () => { assert.ok(severityBorderClass("muted").includes("slate")); });
});

describe("ui-tokens: severityBgClass", () => {
  it("returns emerald bg for good", () => { assert.ok(severityBgClass("good").includes("emerald")); });
  it("returns amber bg for warning", () => { assert.ok(severityBgClass("warning").includes("amber")); });
  it("returns red bg for poor", () => { assert.ok(severityBgClass("poor").includes("red")); });
  it("returns slate bg for muted", () => { assert.ok(severityBgClass("muted").includes("slate")); });
});

describe("ui-tokens: severityTextClass", () => {
  it("returns emerald text for good", () => { assert.ok(severityTextClass("good").includes("emerald")); });
  it("returns amber text for warning", () => { assert.ok(severityTextClass("warning").includes("amber")); });
  it("returns red text for poor", () => { assert.ok(severityTextClass("poor").includes("red")); });
  it("returns slate text for muted", () => { assert.ok(severityTextClass("muted").includes("slate")); });
});

describe("ui-tokens: severityBadgeClasses", () => {
  it("combines border, bg, and text classes", () => {
    const cls = severityBadgeClasses("good");
    assert.ok(cls.includes("border"));
    assert.ok(cls.includes("bg-"));
    assert.ok(cls.includes("text-"));
  });
  it("base severities produce distinct badge strings", () => {
    const severities: UISeverity[] = ["good", "warning", "poor", "muted"];
    const classes = severities.map(severityBadgeClasses);
    assert.equal(new Set(classes).size, 4);
  });
});

describe("ui-tokens: scoreToSeverity", () => {
  it("maps score >= 75 to good", () => { assert.equal(scoreToSeverity(75), "good"); assert.equal(scoreToSeverity(100), "good"); });
  it("maps score 45–74 to warning", () => { assert.equal(scoreToSeverity(45), "warning"); assert.equal(scoreToSeverity(74), "warning"); });
  it("maps score < 45 to poor", () => { assert.equal(scoreToSeverity(0), "poor"); assert.equal(scoreToSeverity(44), "poor"); });
  it("respects custom thresholds", () => {
    assert.equal(scoreToSeverity(80, { good: 80, warn: 60 }), "good");
    assert.equal(scoreToSeverity(70, { good: 80, warn: 60 }), "warning");
    assert.equal(scoreToSeverity(50, { good: 80, warn: 60 }), "poor");
  });
});

describe("ui-tokens: statusToSeverity", () => {
  it("maps good states to good", () => {
    assert.equal(statusToSeverity("GOOD"), "good");
    assert.equal(statusToSeverity("PASS"), "good");
    assert.equal(statusToSeverity("AI"), "good");
    assert.equal(statusToSeverity("FULL_EXTRACTION_AI_ANALYZED"), "good");
  });
  it("maps warning states to warning", () => {
    assert.equal(statusToSeverity("WARNING"), "warning");
    assert.equal(statusToSeverity("MEDIUM"), "warning");
  });
  it("keeps approved fallback partial rather than fully ready", () => {
    assert.equal(statusToSeverity("HUMAN_APPROVED_REGEX_FALLBACK"), "partial");
  });
  it("maps blocking states to poor", () => {
    assert.equal(statusToSeverity("POOR"), "poor");
    assert.equal(statusToSeverity("FAIL"), "poor");
    assert.equal(statusToSeverity("HIGH"), "poor");
    assert.equal(statusToSeverity("CORRUPTED"), "poor");
    assert.equal(statusToSeverity("OCR_REQUIRED"), "poor");
    assert.equal(statusToSeverity("REGEX_FALLBACK_AI_ERROR"), "poor");
  });
  it("maps unknown string to muted", () => { assert.equal(statusToSeverity("UNKNOWN_XYZ"), "muted"); });
  it("is case-insensitive", () => { assert.equal(statusToSeverity("good"), "good"); assert.equal(statusToSeverity("fail"), "poor"); });
});

describe("ui-tokens: confidenceToSeverity", () => {
  it("maps null or undefined to muted", () => {
    assert.equal(confidenceToSeverity(null), "muted");
    assert.equal(confidenceToSeverity(undefined), "muted");
  });
  it("maps >= 0.7 to good", () => { assert.equal(confidenceToSeverity(0.7), "good"); assert.equal(confidenceToSeverity(1.0), "good"); });
  it("maps 0.4–0.69 to warning", () => { assert.equal(confidenceToSeverity(0.4), "warning"); assert.equal(confidenceToSeverity(0.69), "warning"); });
  it("maps < 0.4 to poor", () => { assert.equal(confidenceToSeverity(0), "poor"); assert.equal(confidenceToSeverity(0.39), "poor"); });
});
