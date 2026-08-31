/**
 * A CV in the vault must produce experts.
 *
 * Found by setting a company vault up the way an owner does — upload the
 * documents, let VAULT_INGEST run — and then driving a tender. The tender
 * blocked on NO_SELECTED_REVIEWED_EXPERTS and never generated, while the
 * ingestion itself reported success:
 *
 *   VAULT_INGEST SUCCEEDED  docsProcessed: 6  aiFailures: 0
 *   deterministicCandidates: { experts: 0, projects: 2 }
 *   expertsCreated: 0        projectsCreated: 2
 *
 * Zero experts from a document categorised EXPERT holding three formatted
 * CVs, while projects from the same ingestion worked. The evidence was in the
 * vault and the pipeline could not see it.
 *
 * Two near-misses in extractExpertNames, both on how CVs are actually written:
 *
 * 1. The honorific alternation was case-sensitive and listed only title case.
 *    "ENG. ABEBE TESFAYE" — the standard form — matched nothing, while
 *    "Eng. Abebe Tesfaye" matched. normalizeName in the same file already
 *    stripped honorifics case-insensitively, so the module knew they arrive
 *    in any case; only the extractor did not.
 *
 * 2. The name-then-role pattern required the role immediately after the name.
 *    A CV writes "Abebe Tesfaye — Team Leader", "Daniel Woldu | Senior
 *    Architect", "Sara Bekele, Civil Engineer" — always across a separator.
 *
 * The name capture stays case-sensitive: only the honorific matches in either
 * case, so widening it cannot loosen the pattern into ordinary prose. The
 * last case pins that.
 *
 * Extracted candidates remain REGEX_DRAFT, so they are still not quotable in
 * a generated document until source-verification or review promotes them —
 * canUseVaultRecord is unchanged and this test does not touch it.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { collectDeterministicCandidates } from "../lib/company-knowledge-safety-import";

/** The vault CV document, in the form the seed and real CVs both use. */
const CV_TEXT = [
  "KEY EXPERT SUMMARIES",
  "",
  "ENG. ABEBE TESFAYE — Team Leader / Project Manager",
  "MSc Civil Engineering, Addis Ababa University, 2004.",
  "22 years professional experience in water supply and municipal infrastructure.",
  "Registered Professional Engineer, Grade I, Licence PE/ET/2231.",
  "",
  "ENG. MERON GEBREHIWOT — Senior Water Supply Engineer",
  "MSc Water Resources Engineering, Arba Minch University, 2010.",
  "15 years experience in distribution network design and hydraulic modelling.",
  "",
  "ARCH. DANIEL WOLDU — Senior Architect",
  "BArch Architecture, EiABC, 2008. 17 years experience in building design.",
  "",
  "ENG. SARA HAILU — Environmental and Social Safeguards Specialist",
  "MSc Environmental Engineering, 2012. 13 years ESIA experience,",
  "including World Bank and African Development Bank funded assignments.",
].join("\n");

function expertsFrom(text: string, category = "EXPERT", fileName = "Key-Experts-CVs.txt") {
  return collectDeterministicCandidates([
    { id: "doc-1", originalFileName: fileName, category, extractedText: text } as never,
  ]).experts;
}

describe("deterministic expert extraction from a vault CV", () => {
  it("finds every expert in the document that produced none", () => {
    const experts = expertsFrom(CV_TEXT);
    const names = experts.map((e) => e.fullName);
    assert.ok(
      names.includes("ABEBE TESFAYE"),
      `the all-caps honorific form must be recognised; got ${JSON.stringify(names)}`,
    );
    assert.ok(names.includes("MERON GEBREHIWOT"));
    assert.ok(names.includes("DANIEL WOLDU"));
  });

  it("does not leave the honorific inside the stored name", () => {
    // "ARCH. DANIEL WOLDU" would be filed, matched and printed as a person's
    // name. Every title the extractor recognises must also be stripped.
    for (const name of expertsFrom(CV_TEXT).map((e) => e.fullName)) {
      assert.doesNotMatch(
        name,
        /^(mr|ms|mrs|dr|eng|ing|prof|arch)\b\.?\s/i,
        `${JSON.stringify(name)} still carries its honorific`,
      );
    }
  });

  it("recognises the separators a CV actually uses between name and role", () => {
    for (const line of [
      "Abebe Tesfaye — Team Leader",
      "Daniel Woldu | Senior Architect",
      "Sara Bekele, Civil Engineer",
      "Meron Gebrehiwot - Water Supply Engineer",
      "Yonas Alemu: Structural Engineer",
    ]) {
      const text = `KEY STAFF\n\n${line}\n${"Twelve years of professional experience on comparable assignments. ".repeat(3)}`;
      assert.ok(
        expertsFrom(text).length >= 1,
        `no expert extracted from ${JSON.stringify(line)}`,
      );
    }
  });

  it("still accepts the title-case form it always accepted", () => {
    const text = `KEY STAFF\n\nEng. Abebe Tesfaye\n${"Twenty two years of professional experience in water supply. ".repeat(3)}`;
    assert.deepEqual(expertsFrom(text).map((e) => e.fullName), ["Abebe Tesfaye"]);
  });

  it("extracts nobody from ordinary prose", () => {
    // The name capture stays case-sensitive, so relaxing the honorific must
    // not turn methodology text into a staff list.
    const prose = [
      "The Company has delivered water supply projects across the region.",
      "Our approach to design review follows the Client Requirements.",
      "The Team Leader will coordinate all field activities.",
      "Quality Assurance Methodology applies to every assignment we deliver.",
      "Deliverables include an Inception Report and a Final Design Report.",
    ].join(" ");
    assert.deepEqual(expertsFrom(prose, "OTHER", "methodology.txt"), []);
  });

  it("gives each person only their own title and years", () => {
    // A fixed-radius snippet around the name spanned the neighbouring
    // entries, so all three experts were stored with the first person's "22
    // years" and a title taken from someone else's line. Attributes of a
    // named individual, read from a different individual's text, in records
    // that are matched against a tender and can reach a submission.
    const byName = new Map(expertsFrom(CV_TEXT).map((e) => [e.fullName, e]));

    assert.equal(byName.get("ABEBE TESFAYE")?.yearsExperience, 22);
    assert.equal(byName.get("MERON GEBREHIWOT")?.yearsExperience, 15);
    assert.equal(byName.get("DANIEL WOLDU")?.yearsExperience, 17);

    assert.equal(byName.get("ABEBE TESFAYE")?.title, "Team Leader");
    assert.equal(byName.get("MERON GEBREHIWOT")?.title, "Water Supply Engineer");
    assert.equal(byName.get("DANIEL WOLDU")?.title, "Architect");
  });

  it("does not store a mid-word fragment as a job title", () => {
    // "Profession" matched inside "professional", so "22 years professional
    // experience in water supply and municipal infrastructure" became a
    // person's title: "al experience in water supply and municipal
    // infrastructure. Registered".
    for (const expert of expertsFrom(CV_TEXT)) {
      if (!expert.title) continue;
      assert.doesNotMatch(
        expert.title,
        /^al\s|experience in|Registered/i,
        `${expert.fullName} has a fragment as a title: ${JSON.stringify(expert.title)}`,
      );
      assert.ok(expert.title.length <= 60, `a job title should be short, got ${JSON.stringify(expert.title)}`);
    }
  });

  it("carries the person's own text in the profile, not a description of the extractor", () => {
    // The matcher scores fullName, title, profile, disciplines, sectors and
    // certifications. With profile set to "Deterministic extraction from
    // <file>." every extracted expert scored 0, none was selected, and the
    // tender blocked on NO_SELECTED_REVIEWED_EXPERTS with the CV in the vault.
    for (const expert of expertsFrom(CV_TEXT)) {
      const profile = String(expert.profile ?? "");
      assert.ok(
        profile.includes(expert.fullName),
        `${expert.fullName}'s profile must contain their own entry`,
      );
      assert.doesNotMatch(
        profile,
        /^Deterministic extraction from/,
        "the profile must not merely describe the extractor",
      );
      // The document is still named, after the content rather than instead.
      assert.match(profile, /Source: /);
    }
  });

  it("reads a qualified years-of-experience phrase", () => {
    // "13 years ESIA experience" — a qualifier between "years" and
    // "experience" is how CVs write a specialism. Only "professional" was
    // allowed there, so this person's stated experience was invisible and the
    // record stored null.
    const byName = new Map(expertsFrom(CV_TEXT).map((e) => [e.fullName, e]));
    assert.equal(byName.get("SARA HAILU")?.yearsExperience, 13);
    // And the unqualified forms still read correctly.
    assert.equal(byName.get("ABEBE TESFAYE")?.yearsExperience, 22);
    assert.equal(byName.get("MERON GEBREHIWOT")?.yearsExperience, 15);
  });

  it("leaves a field null rather than borrowing a neighbour's value", () => {
    // Sara's role is not in the recognised list. Null is the honest answer;
    // the defect was filling it from the previous person's entry.
    const sara = expertsFrom(CV_TEXT).find((e) => e.fullName === "SARA HAILU");
    assert.ok(sara, "the fourth expert must still be extracted");
    assert.equal(sara?.title, null);
  });

  it("keeps extracted candidates as drafts", () => {
    // The trust level is what stops an unverified regex reading from being
    // quoted in a submittable document. Widening the pattern must not touch
    // it.
    for (const expert of expertsFrom(CV_TEXT)) {
      assert.equal(expert.trustLevel, "REGEX_DRAFT");
    }
  });
});
