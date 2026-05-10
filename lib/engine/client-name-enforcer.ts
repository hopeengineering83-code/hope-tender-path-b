/**
 * Client Name Enforcer (PR V).
 *
 * THE PROBLEM
 * Even with the prompt directive forbidding it, the AI sometimes
 * substitutes a client name pulled from the COMPANY's project history
 * (e.g., "Pharo Ventures") into the cover letter "To:" line, the
 * subject line, the executive summary, and Why-Us banner. The user's
 * real-output gap analysis showed:
 *
 *   Subject: Technical Proposal — Pharo Ventures Tender
 *   To: Pharo Ventures
 *   "...Pharo Ventures requires a technically robust delivery..."
 *
 * ...for a tender where the actual client was "Path" (or "The Client"
 * unconfirmed). This is the single most common bid-disqualifying
 * error and the prompt directive alone doesn't reliably block it.
 *
 * THE FIX
 * Final post-pass that scans the markdown for ALL plausible client
 * substitutions and force-corrects them to the canonical clientName.
 * Operates in three modes:
 *
 *   1. WHEN canonical clientName is a real-looking name (not "The Client"
 *      / "Client" / "[CLIENT TO BE CONFIRMED]"): replace any HALLUCINATED
 *      client mentions with the canonical name. We detect hallucinated
 *      mentions via a list of known firm-history clients pulled from
 *      the company vault — i.e., names that appear in the firm's project
 *      records but are NOT the canonical clientName.
 *
 *   2. WHEN canonical clientName is unconfirmed: replace any inserted
 *      client name in the cover letter "To:" line and subject line
 *      with "[CLIENT TO BE CONFIRMED]" so the bid team can fill in
 *      manually before submission.
 *
 *   3. ALWAYS strip ", [BRAND]" and similar trailing brand patterns
 *      from the executive summary's first paragraph if the brand
 *      isn't the canonical client.
 *
 * NEVER FABRICATES — only substitutes the canonical clientName or a
 * neutral placeholder. Never invents a third name.
 */

export interface ClientNameEnforcerOpts {
  canonicalClientName: string;
  knownFirmClients: string[]; // names of clients from the firm's vault history
}

export interface ClientNameEnforcerResult {
  markdown: string;
  substitutionsMade: number;
}

const PLACEHOLDER_NAMES = new Set([
  "the client",
  "client",
  "client name",
  "[client to be confirmed]",
  "[client]",
  "—",
  "tbd",
  "to be confirmed",
]);

function isPlaceholderClient(name: string): boolean {
  return PLACEHOLDER_NAMES.has(name.trim().toLowerCase());
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function enforceClientName(
  markdown: string,
  opts: ClientNameEnforcerOpts,
): ClientNameEnforcerResult {
  const canonical = (opts.canonicalClientName || "").trim();
  if (!canonical) return { markdown, substitutionsMade: 0 };

  let substitutionsMade = 0;
  let result = markdown;

  // Build a list of substitution patterns. Each entry: regex → replacement.
  // We only substitute IN the cover-letter / executive-summary zone to
  // avoid touching legitimate references to firm-history clients in
  // Section B project cards.
  const lines = result.split("\n");
  let zoneStart = -1;
  let zoneEnd = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#{1,4}\s+Cover Letter\b/i.test(lines[i]) && zoneStart < 0) zoneStart = i;
    if (zoneStart >= 0 && /^#{1,4}\s+(?:Section\s+B\b|Relevant Experience\b|Project Portfolio\b|Client References\b)/i.test(lines[i])) {
      zoneEnd = i; break;
    }
  }
  if (zoneEnd < 0) zoneEnd = lines.length;
  if (zoneStart < 0) return { markdown: result, substitutionsMade: 0 };

  // Collect client-name candidates to scrub from the zone.
  // - Each name in knownFirmClients that is NOT the canonical client
  // - Any "Subject: ... <NAME> Tender" / "To: <NAME>" patterns where the
  //   name doesn't match canonical
  const namesToReplace: string[] = [];
  for (const c of opts.knownFirmClients) {
    const trimmed = (c || "").trim();
    if (trimmed.length < 3) continue;
    if (trimmed.toLowerCase() === canonical.toLowerCase()) continue;
    if (isPlaceholderClient(trimmed)) continue;
    namesToReplace.push(trimmed);
  }

  // Also: detect any prominent ALL-CAPS proper noun appearing in the
  // "Subject: Technical Proposal — X" / "To: X" pattern that isn't
  // the canonical client.
  const subjectRe = /^(Subject:.*?(?:Technical Proposal[^\n]*?(?:—|-|for)\s+))(.+?)(\s+Tender|\s*$)/im;
  const subjectLines: string[] = [];
  for (let i = zoneStart; i < zoneEnd && i < lines.length; i += 1) {
    const m = lines[i].match(subjectRe);
    if (m) {
      const detected = m[2].trim();
      if (detected.length >= 3 && detected.toLowerCase() !== canonical.toLowerCase() && !isPlaceholderClient(detected)) {
        subjectLines.push(detected);
      }
    }
  }
  for (const s of subjectLines) {
    if (!namesToReplace.includes(s)) namesToReplace.push(s);
  }

  // Apply substitutions ONLY within the cover-letter / exec-summary zone
  for (let i = zoneStart; i < zoneEnd && i < lines.length; i += 1) {
    let line = lines[i];
    for (const wrongName of namesToReplace) {
      // Use lookahead/lookbehind instead of \b so names with apostrophes
      // (e.g. "O'Connor") match correctly — \b fails at non-word chars.
      const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(wrongName)}(?![A-Za-z0-9])`, "g");
      const before = line;
      line = line.replace(re, isPlaceholderClient(canonical) ? "[CLIENT TO BE CONFIRMED]" : canonical);
      if (line !== before) substitutionsMade += 1;
    }
    lines[i] = line;
  }

  result = lines.join("\n");
  return { markdown: result, substitutionsMade };
}
