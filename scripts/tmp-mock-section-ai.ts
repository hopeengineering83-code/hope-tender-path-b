// TEMPORARY local QA (PR #1175): reproduces a hosted proposal in which some
// sections are model-written and the others use their per-section fallback.
// Gemini requests are answered locally: the cover-and-summary section gets a
// plausible model answer, every other request fails, so its section falls
// back. Usage: GEMINI_API_KEY=AIza... npx tsx scripts/tmp-mock-section-ai.ts <outDir> <fixture>
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
  const body = typeof init?.body === "string" ? init.body : "";
  const wantTechnical = process.env.MOCK_SECTION === "technical";
  const isTechnical = /Write Section C\b/.test(body);
  const isCover = /Cover Letter and Executive Summary|write the Cover Letter/i.test(body) && !/Section A \(Company Profile\)/.test(body.slice(0, 4000));
  const isCompany = /Write Section A \(Company Profile\) and Section B/.test(body);
  if (process.env.MOCK_SECTION === "company" && isCompany) {
    // The hosted model's shape: Section A, then B.1/B.2 with no Section B heading.
    const text = [
      "# Section A: Company Profile",
      "",
      "## A.1 Company Background",
      "",
      "The firm is a multidisciplinary consultancy with design, engineering and supervision services under one roof, and a record of completed healthcare, hospitality, education and infrastructure projects delivered for public and private clients.",
      "",
      "## B.1 Client References",
      "",
      "The firm's client references are drawn from its own completed projects, listed below with the client, location and value of works.",
      "",
      "## B.2 Project Portfolio",
      "",
      "The projects most relevant to this assignment are presented below, each with the services the firm delivered and how they correspond to the scope of this tender.",
    ].join("\n");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 400, totalTokenCount: 1400 } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (process.env.MOCK_SECTION !== "company" && (wantTechnical ? isTechnical : isCover)) {
    const text = wantTechnical ? [
      "# Section C: Technical Approach",
      "",
      "## C.1 Understanding of the Assignment",
      "",
      "The client requires an end-to-end consultancy partner to assess candidate premises, design the facility to the applicable standards, coordinate all building services, manage approvals and supervise the works through to handover. Each scope item is answered below in the tender's own order.",
      "",
      "## C.2 Technical Methodology",
      "",
      "### C.2.1 Assessment of candidate premises",
      "",
      "Each shortlisted property is scored against written suitability criteria covering structure, services capacity, access and expansion, and the recommendation is issued before any commitment.",
      "",
      "### C.2.2 Architectural design",
      "",
      "Concept and detailed design follow a frozen brief, with functional zoning, patient and staff flows and infection-control separation fixed at concept stage and carried through every later stage.",
      "",
      "### C.2.3 Engineering coordination",
      "",
      "Mechanical, electrical, plumbing and medical-gas services are coordinated with the architecture at every design stage, and clashes are closed before any drawing is issued.",
      "",
      "## C.3 Work Plan",
      "",
      "The work runs in five stages, each closing on the client's written sign-off before the next begins.",
      "",
      "## C.4 Quality Assurance",
      "",
      "Every deliverable is reviewed by a second senior discipline lead before issue, with formal review gates at 30%, 60% and 100% completion.",
    ].join("\n") : [
      "# Cover Letter",
      "",
      "Dear Evaluation Committee,",
      "",
      "We are pleased to submit this Technical Proposal in response to your invitation. Our firm brings directly comparable experience, a named and registered team, and a controlled delivery method in which every scope item has a named lead, a quality check and the client's approval before the dependent item proceeds.",
      "",
      "We would welcome the opportunity to discuss this proposal and remain available for any clarification the Evaluation Committee requires.",
      "",
      "Sincerely,",
      "",
      "# Executive Summary",
      "",
      "This proposal answers each item of the tender's scope of services in the tender's own order. The proposed team is drawn from the firm's own CV records, and the references are the firm's own completed projects of the same kind.",
      "",
      "For each scope item, Section C sets out the lead, the inputs, the deliverables, the quality check and the point at which the client approves the work before the dependent item proceeds.",
    ].join("\n");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 400, totalTokenCount: 1400 } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  // Every other request gets the hosted run's failure: a cut-off table row,
  // which the section validator refuses (deterministic fallback) without
  // putting the provider into cooldown.
  const cut = "| 1 | **Expert Name** – General Manager & Practising ";
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: cut }], role: "model" }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 20, totalTokenCount: 1020 } }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

void import("./tmp-tender-matrix-harness");
