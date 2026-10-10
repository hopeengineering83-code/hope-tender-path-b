// A service-lines section that ends with one bullet.
//
// 2026-10-05, hands-off acceptance: "A.2 Core Service Lines (directly relevant
// to the … Medical Center)" reached the delivered PDF as a single bullet,
// "Feasibility studies". The writer was asked for five to eight; the later
// sanitising passes removed the rest, and nothing noticed that the list had
// collapsed. A one-item list under a heading that promises the firm's relevant
// service lines reads as a firm with one service.
//
// The repair uses only the firm's own recorded service lines, and only those
// the tender's own text calls for, so the heading's "directly relevant" stays
// true. It runs only when the list has collapsed below two items; a list the
// writer produced is never replaced.

const SERVICE_HEADING = /^(#{2,3})\s+(?:[A-H](?:\.\d+)*\s+)?(?:Core\s+)?Service\s+Lines\b.*$/im;
const GENERIC_WORDS = new Set([
  "services", "service", "consultancy", "consulting", "studies", "study", "design", "engineering",
  "preparation", "and", "the", "for", "with", "management", "works", "facility", "facilities",
  // Words every tender carries whatever the work: "tender documents", "the
  // contract", "City Administration", "renovation planning".
  "tender", "document", "documents", "contract", "administration", "planning", "infrastructure", "resources",
]);

/** The firm's recorded service lines that the tender's own text names the work of. */
export function serviceLinesTheTenderCallsFor(serviceLines: readonly string[], tenderText: string): string[] {
  const text = tenderText.toLowerCase();
  return serviceLines.filter((line) => {
    const words = line.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
    // "MEP design" names MEP; "Architectural design" names architectural work.
    return words.some((w) => new RegExp(`\\b${w.slice(0, Math.max(4, Math.min(w.length, 8)))}`).test(text));
  });
}

export function repairCollapsedServiceLines(
  markdown: string,
  opts: { serviceLines: readonly string[]; tenderText: string },
): { markdown: string; repaired: boolean } {
  const heading = SERVICE_HEADING.exec(markdown);
  if (!heading) return { markdown, repaired: false };
  const bodyStart = heading.index + heading[0].length;
  const rest = markdown.slice(bodyStart);
  const next = rest.search(/^#{1,3}\s+/m);
  const body = next >= 0 ? rest.slice(0, next) : rest;
  const bullets = body.split("\n").filter((l) => /^\s*[-*•]\s+\S/.test(l));
  if (bullets.length >= 2) return { markdown, repaired: false };
  const relevant = serviceLinesTheTenderCallsFor(opts.serviceLines, opts.tenderText);
  const existing = bullets.map((b) => b.replace(/^\s*[-*•]\s+/, "").trim().toLowerCase());
  const lines = [...bullets.map((b) => b.trim()), ...relevant.filter((r) => !existing.some((e) => e.startsWith(r.toLowerCase()))).map((r) => `- ${r}`)];
  if (lines.length < 2) return { markdown, repaired: false };
  const prose = body.split("\n").filter((l) => l.trim() && !/^\s*[-*•]\s+\S/.test(l));
  const rebuilt = ["", ...prose, ...(prose.length > 0 ? [""] : []), ...lines.slice(0, 8), ""].join("\n");
  return { markdown: markdown.slice(0, bodyStart) + "\n" + rebuilt + (next >= 0 ? rest.slice(next) : ""), repaired: true };
}
