/**
 * PR GG — JV / Consortia Partnership Disclosure table.
 *
 * When the tender intelligence detects joint-venture or consortia rules
 * (intelligence.consortiaRules is non-null), international best-practice
 * proposals include an explicit "JV / Partnership Disclosure" section that:
 *
 *   1. States whether the bid is submitted as a single firm or consortium.
 *   2. If consortium: names the lead firm, each partner, each partner's role,
 *      their nationality / registration country, and their share of work.
 *   3. Confirms JV authorisation (e.g., MoU, letter of intent) is attached.
 *   4. Confirms the lead firm is fully liable for contract performance.
 *
 * Without this section, evaluators on JV-eligible tenders must infer the
 * firm's teaming structure from scattered mentions in Section A — a source
 * of evaluation-panel confusion that costs marks under "Organisation and
 * Teaming" criteria.
 *
 * Structure:
 *   - Single-firm submission: two-row disclosure table confirming no JV.
 *   - JV submission (when jvPartners populated): multi-row partner table.
 *
 * Idempotent via <!-- jv-disclosure:table --> marker.
 * Inserts before Section E (Compliance Matrix) or at end-of-document.
 * Returns null when consortiaRules is null/empty (tender has no JV clause).
 */

const JV_MARKER = "<!-- jv-disclosure:table -->";

const JV_HEADING_RE = /#{1,4}\s+(?:JV|Joint[- ]Venture|Consortium|Consortia|Partnership)\s+(?:Disclosure|Declaration|Statement|Arrangement)/i;

export interface JvPartner {
  firmName: string;
  country?: string | null;
  role?: string | null;
  workShare?: string | null;
}

export interface JvDisclosureOpts {
  consortiaRules: string;
  companyName: string;
  jvPartners?: JvPartner[];
}

export interface JvDisclosureResult {
  markdown: string;
  injected: boolean;
}

function escCell(text: string | null | undefined): string {
  if (!text) return "—";
  return text.replace(/\r?\n+/g, " ").replace(/\|/g, "/").replace(/\s{2,}/g, " ").trim() || "—";
}

function buildJvTable(opts: JvDisclosureOpts): string {
  const hasPartners = (opts.jvPartners ?? []).length > 0;

  const rows: string[] = [];

  if (hasPartners) {
    // Partner disclosure mode
    const partners = opts.jvPartners!;
    rows.push("| # | Firm Name | Country / Registration | Role in Consortium | Estimated Work Share |");
    rows.push("|---|---|---|---|---|");
    rows.push(`| 1 | **${escCell(opts.companyName)}** (Lead Firm) | — | Lead firm; primary point of contact; fully liable for contract performance | — |`);
    partners.forEach((p, i) => {
      rows.push(
        `| ${i + 2} | ${escCell(p.firmName)} | ${escCell(p.country)} | ${escCell(p.role ?? "Sub-consultant / Consortium Partner")} | ${escCell(p.workShare)} |`,
      );
    });
  } else {
    // Single-firm disclosure mode
    rows.push("| Disclosure Item | Status / Confirmation |");
    rows.push("|---|---|");
    rows.push(`| **Submission type** | Single firm — ${escCell(opts.companyName)} submits as the sole bidder. No consortium or joint-venture arrangement applies to this bid. |`);
    rows.push(`| **Sub-consultants** | Sub-consultants, if any, are engaged under ${escCell(opts.companyName)}'s sole responsibility and do not constitute a consortium for the purpose of this tender. |`);
    rows.push(`| **Conflict of interest** | No consortium partner relationship exists that would create a conflict of interest with the client or other bidders. |`);
    rows.push(`| **Consortium eligibility** | Tender clause noted: _${escCell(opts.consortiaRules.slice(0, 500))}_ — not applicable to this single-firm submission. |`);
  }

  const framing = hasPartners
    ? `This bid is submitted by a consortium led by **${opts.companyName}**. The consortium structure, partner roles, and work-share allocations are disclosed below in accordance with the tender's joint-venture / consortium clause. A signed Memorandum of Understanding (MoU) or Letter of Intent between all consortium members is attached as Annex H. The lead firm is fully liable for contract performance regardless of internal work-share arrangements.`
    : `This bid is submitted by **${opts.companyName}** as a single firm. No joint-venture or consortium arrangement applies. The tender's consortium clause has been noted and is reproduced below for the evaluator's reference.`;

  return [
    JV_MARKER,
    "## D.6 JV / Partnership Disclosure",
    "",
    framing,
    "",
    ...rows,
    "",
    "_If the teaming structure changes before submission, update this section and re-attach the consortium agreement._",
    "",
  ].join("\n");
}

function findInsertPoint(markdown: string): number {
  const lines = markdown.split("\n");
  // Before Section E (Compliance Matrix)
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#\s+Section\s+E\b/i.test(lines[i]) || /^##\s+SECTION\s+E\b/i.test(lines[i]) || /^#\s+Compliance\s+Matrix/i.test(lines[i])) {
      return i;
    }
  }
  // After Declaration section
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##?\s+(?:D\.4|Declaration\s+of\s+Eligibility)/i.test(lines[i])) {
      // Find end of declaration section
      let j = i + 1;
      while (j < lines.length) {
        const m = lines[j].match(/^(#+)\s/);
        if (m && m[1].length <= 2) return j;
        j += 1;
      }
      return j;
    }
  }
  return lines.length;
}

export function injectJvDisclosure(
  markdown: string,
  opts: JvDisclosureOpts,
): JvDisclosureResult {
  // Skip if no consortia rules detected
  if (!opts.consortiaRules || !opts.consortiaRules.trim()) {
    return { markdown, injected: false };
  }
  // Idempotent
  if (markdown.includes(JV_MARKER) || JV_HEADING_RE.test(markdown)) {
    return { markdown, injected: false };
  }

  const block = buildJvTable(opts);
  const lines = markdown.split("\n");
  const insertAt = findInsertPoint(markdown);
  const out = [
    ...lines.slice(0, insertAt),
    "",
    block,
    "",
    ...lines.slice(insertAt),
  ];
  return { markdown: out.join("\n"), injected: true };
}
