// A stored value is shown as prose only when it is prose.
//
// THE DELIVERED DEFECT
// --------------------
// Hosted run 34038487418 shipped this as the opening of a named expert's
// biography, under "A.5.1 Principal Qualifications — Detailed Bios":
//
//   Profile. HOPE URBAN PLANNING ARCHITECTURAL AND ENGINEERING CONSULTANCY PLC
//   ENG. AHMED KEBEDE TEKAW General Manager & Practicing Professional Engineer
//   Structural Engineer · Geotechnical Engineer · Project Manager Major Projects
//   | 5 International | 11+ Years Experience General Manager & Practicing
//   Professional Engineer Hope Urban Planning Architectural and Engineering
//   Consultancy Ahmed Kebede Tekaw Languages Amharic (Excellent), English…
//
// and this in the "Key Technical Contribution" column of A.6:
//
//   … Amhara Region, Ethiopia (7,000 m²) Ref: ጊ/ከ/መ/ ል/1591/18 Date: 19/01/2018
//   E.C. Author: Tariku Abebaw (Building Officer, Gimba…
//
// The first is the CV's letterhead read straight off the source document. The
// second is the reference letter's own bookkeeping — provenance the app keeps
// to prove the record, not something a client is asked to read. Both were cut
// mid-parenthesis.
//
// Nothing here rewrites a record: these values are source-verified and
// immutable, and one changed character makes them unusable for generation.
// This is the rendering boundary deciding what part of a stored value is shown.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  withoutSourceProvenance,
  proseProfileOrEmpty,
  factualCardOrEmpty,
  tidyTruncation,
} from "../lib/engine/vault-prose";
import { truncateAtWordBoundary, expertProofLine } from "../lib/engine/proposal-intelligence";
import { buildPrincipalQualificationsSection } from "../lib/engine/principal-qualifications";

const DELIVERED_CV_DUMP =
  "HOPE URBAN PLANNING ARCHITECTURAL AND ENGINEERING CONSULTANCY PLC ENG. AHMED KEBEDE TEKAW "
  + "General Manager & Practicing Professional Engineer Structural Engineer · Geotechnical Engineer "
  + "· Project Manager Major Projects | 5 International | 11+ Years Experience General Manager & "
  + "Practicing Professional Engineer Hope Urban Planning Architectural and Engineering Consultancy "
  + "Ahmed Kebede Tekaw Languages Amharic (Excellent), English (Excellent), Afan Oromo (Excellent) "
  + "Total Professional Experience 11+ years (since July 2015 G.C.) 2. EDUCATION, TRAINING & ";

const DELIVERED_SUMMARY_WITH_PROVENANCE =
  "G+6 General Hospital – Dr Abdul Seid / Gimba City, South Wollo Zone, Amhara Region, Ethiopia "
  + "(7,000 m²) Ref: ጊ/ከ/መ/ ል/1591/18 Date: 19/01/2018 E.C. Author: Tariku Abebaw "
  + "(Building Officer, Gimba City Administration)";

const REAL_PROSE_PROFILE =
  "Ahmed leads the firm's structural and geotechnical practice. He has directed hospital and "
  + "mixed-use design assignments from inception through construction supervision, and is "
  + "responsible for the firm's internal design-review gates. His work covers foundation design "
  + "on variable ground conditions and coordination between structural and MEP disciplines.";

describe("a letterhead dump is not a biography", () => {
  it("refuses the CV header card the delivered proposal printed", () => {
    assert.equal(
      proseProfileOrEmpty(DELIVERED_CV_DUMP),
      "",
      "a stored value that is the source document's furniture must not be shown as a profile",
    );
  });

  it("keeps a real written profile", () => {
    assert.equal(proseProfileOrEmpty(REAL_PROSE_PROFILE), REAL_PROSE_PROFILE);
  });

  it("refuses a label card even when it is not shouted", () => {
    const card = "Position: Senior Electrical Engineer. Languages: English, Amharic. "
      + "Software Skills: ETAP, AutoCAD Electrical, DIALux. Countries of Work: Ethiopia, Djibouti.";
    assert.equal(proseProfileOrEmpty(card), "");
  });

  it("refuses an empty or missing value without throwing", () => {
    assert.equal(proseProfileOrEmpty(null), "");
    assert.equal(proseProfileOrEmpty(undefined), "");
    assert.equal(proseProfileOrEmpty(""), "");
  });
});

describe("reference-letter bookkeeping is not a technical contribution", () => {
  it("keeps the description and drops the provenance that follows it", () => {
    const shown = withoutSourceProvenance(DELIVERED_SUMMARY_WITH_PROVENANCE);
    assert.match(shown, /^G\+6 General Hospital – Dr Abdul Seid/);
    assert.ok(!/Ref:/.test(shown), `no reference number: ${shown}`);
    assert.ok(!/Author:/.test(shown), `no letter author: ${shown}`);
    assert.ok(!/19\/01\/2018/.test(shown), `no letter date: ${shown}`);
    assert.match(shown, /7,000 m²/, "the project's own facts survive");
  });

  it("returns nothing when the value is provenance from its first character", () => {
    assert.equal(withoutSourceProvenance("Ref: HAEC/034/23 Date: 12/03/2024 Author: Someone"), "");
  });

  it("leaves an ordinary summary untouched", () => {
    const summary = "Design and construction supervision of a 7,000 m² general hospital, covering "
      + "clinical zoning, medical gas reticulation and MEP coordination.";
    assert.equal(withoutSourceProvenance(summary), summary);
  });
});

describe("a shortened value must read as shortened, not broken", () => {
  it("does not end inside an unclosed parenthetical", () => {
    const cut = truncateAtWordBoundary(DELIVERED_SUMMARY_WITH_PROVENANCE, 200);
    assert.ok(!/\([^)]*…$/.test(cut), `no dangling open bracket: ${cut}`);
  });

  it("does not end on a dangling conjunction", () => {
    assert.equal(tidyTruncation("2. EDUCATION, TRAINING &…"), "2. EDUCATION, TRAINING…");
    assert.equal(tidyTruncation("clinical zoning and…"), "clinical zoning…");
  });

  it("does not end on a label with nothing under it", () => {
    assert.equal(tidyTruncation("11+ years Disciplines: Sectors: …"), "11+ years…");
  });

  it("still cuts on a word boundary", () => {
    const cut = truncateAtWordBoundary("Structural engineering and geotechnical investigation for the hospital campus", 30);
    assert.ok(cut.endsWith("…"));
    assert.ok(!/\w…$/.test(cut.replace(/\s\w+…$/, "")) || /\s/.test(cut), "cut lands between words");
    assert.ok("Structural engineering and geotechnical investigation for the hospital campus".startsWith(cut.replace(/…$/, "")));
  });

  it("leaves a short value alone", () => {
    assert.equal(truncateAtWordBoundary("Short value", 200), "Short value");
  });
});

// ── The bios section must survive a vault with no written profiles ───────────
//
// Run 34039741983 refused every stored profile as document furniture — correctly
// — and the whole "A.5.1 Principal Qualifications — Detailed Bios" sub-section
// then disappeared from the delivered proposal: the only remaining content was
// an internal source-evidence note, which the internal-content stripper removed,
// and the structure seal dropped the empty headings that were left. An evaluator
// scoring team depth needs that section.
describe("a bio is composed from the record when the vault has no prose", () => {
  const expert = {
    fullName: "Eng. Kemal Mohammed Zeinu",
    title: "Senior Environmental & Electrical Expert",
    yearsExperience: 14,
    disciplines: JSON.stringify(["Electrical Engineering", "Environmental Engineering", "Hydraulic / Water Resources"]),
    sectors: JSON.stringify(["Healthcare", "Infrastructure"]),
    certifications: JSON.stringify(["PhD, Huazhong University of Science & Technology"]),
    profile: DELIVERED_CV_DUMP,
  } as unknown as Parameters<typeof buildPrincipalQualificationsSection>[0]["experts"][number];

  it("keeps the section and states only what the record carries", async () => {
    const section = buildPrincipalQualificationsSection({ experts: [expert] });
    assert.ok(section, "the section must not disappear");
    assert.match(section!, /Principal Qualifications/);
    assert.match(section!, /\*\*Profile\.\*\*/);
    assert.match(section!, /Eng\. Kemal Mohammed Zeinu is proposed as Senior Environmental & Electrical Expert/);
    assert.match(section!, /14 years experience recorded in the reviewed specialist record/);
    assert.match(section!, /Electrical Engineering, Environmental Engineering and Hydraulic \/ Water Resources/);
    assert.match(section!, /Healthcare and Infrastructure/);
  });

  it("does not print the letterhead it refused", () => {
    const section = buildPrincipalQualificationsSection({ experts: [expert] })!;
    assert.ok(!/HOPE URBAN PLANNING ARCHITECTURAL/.test(section), `no letterhead: ${section.slice(0, 400)}`);
    assert.ok(!/Languages Amharic/.test(section));
  });

  it("does not leave an internal instruction in the client document", () => {
    const section = buildPrincipalQualificationsSection({ experts: [expert] })!;
    assert.ok(!/Source-evidence action/i.test(section));
    assert.ok(!/knowledge vault/i.test(section));
  });

  it("still prefers a real written profile when the vault has one", () => {
    const withProse = { ...(expert as object), profile: REAL_PROSE_PROFILE } as typeof expert;
    const section = buildPrincipalQualificationsSection({ experts: [withProse] })!;
    assert.match(section, /Ahmed leads the firm's structural and geotechnical practice/);
    assert.ok(!/is proposed as Senior Environmental/.test(section), "the composed fallback is not used when prose exists");
  });
});

// ── The proof line is a facts line, and a CV card is not facts ───────────────
//
// Run 34041093363 still shipped this into "Proposed Team and Expert
// Contributions" and the PER 02 profile cards, after the bios and the A.4 table
// had been cleaned:
//
//   Daniel Getachew Tadesse — Senior Electrical Engineer | 11+ years experience
//   | Disciplines: … | Sectors: … | (M.SC.) 11+ Years Professional Experience
//   Specialized in Electrical Systems & Renewable Energy Senior Electrical
//   Engineer Hope Architectural and Engineering Consultancy PLC Daniel Getachew
//   Tadesse English: Fluent (Professional); Amharic: Native; Dutch: Basic ETAP,
//   AutoCAD Electrical, DIALux, SAM, MATLAB/Simulink, MS Project Ethiopia,
//   Djibouti, Netherlands …
//
// The title, the firm and the person's name each appear twice, because the CV's
// header card is being read as though it were a profile. The structured fields
// in front of it already say everything the card says.
describe("the expert proof line drops a CV card", () => {
  const DELIVERED_CARD =
    "(M.SC.) 11+ Years Professional Experience Specialized in Electrical Systems & Renewable Energy "
    + "Senior Electrical Engineer Hope Architectural and Engineering Consultancy PLC Daniel Getachew "
    + "Tadesse English: Fluent (Professional); Amharic: Native; Dutch: Basic ETAP, AutoCAD Electrical, "
    + "DIALux, SAM, MATLAB/Simulink, MS Project Ethiopia, Djibouti, Netherlands Hope Architectural & "
    + "Engineering Consultancy PLC October 2023 – Present Senior Electrical Engineer & Renewable "
    + "Energy Specialist";

  it("refuses a card that repeats the person's own title and firm", () => {
    assert.equal(factualCardOrEmpty(DELIVERED_CARD), "");
  });

  it("keeps a short factual card that says something new", () => {
    const card = "MSc Electrical Engineering; hospital MEP design; medical gas reticulation";
    assert.equal(factualCardOrEmpty(card), card);
  });

  it("keeps the structured facts in the proof line either way", () => {
    const line = expertProofLine({
      fullName: "Daniel Getachew Tadesse",
      title: "Senior Electrical Engineer",
      yearsExperience: 11,
      disciplines: JSON.stringify(["Electrical Engineering", "Environmental Engineering"]),
      sectors: JSON.stringify(["Healthcare", "Infrastructure"]),
      certifications: JSON.stringify([]),
      profile: DELIVERED_CARD,
    } as unknown as Parameters<typeof expertProofLine>[0]);

    assert.match(line, /Daniel Getachew Tadesse — Senior Electrical Engineer/);
    assert.match(line, /Disciplines: Electrical Engineering, Environmental Engineering/);
    assert.match(line, /Sectors: Healthcare, Infrastructure/);
    assert.ok(!/DR\. ENG\.|M\.SC\.\) 11\+ Years/.test(line), `no CV card: ${line}`);
    assert.ok(!/Hope Architectural and Engineering Consultancy PLC/.test(line), `no letterhead: ${line}`);
  });
});
