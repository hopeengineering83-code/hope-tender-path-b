// One way to print a professional registration.
//
// A registration arrives in whatever form its record holds it: stored
// certifications read "Practicing Professional Engineer (PE) in Construction
// Management (PEPCM/5718)", a CV-derived one "Reg. No. PSTE/6884". Builders
// then wrapped the whole string in brackets of their own, and the delivered
// Executive Summary read "Elias Manaye Yancha, Project Manager / Senior Civil
// Engineer (Practicing Professional Engineer (PE) in Construction Management
// (PEPCM/5718))" — three levels of brackets around one fact.
//
// Every place that prints a registration goes through here. The designation
// and the number are the record's own; nothing is added, only punctuated:
//   "Practicing Professional Engineer (PE) in Construction Management, Reg. No. PEPCM/5718"
//   "Reg. No. PSTE/6884"

function clean(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** A registration number: letters and digits, usually with "/" or "-", no spaces. */
function looksLikeRegistrationNumber(token: string): boolean {
  const t = clean(token).replace(/^(?:reg(?:istration)?\.?\s*(?:no\.?|number)\s*:?|licen[cs]e\s*(?:no\.?|number)?\s*:?|no\.)\s*/i, "");
  return /^[A-Z0-9][A-Z0-9/.-]*$/i.test(t) && /\d/.test(t) && /[A-Z]|\//i.test(t) && t.length <= 24;
}

function bareNumber(token: string): string {
  return clean(token).replace(/^(?:reg(?:istration)?\.?\s*(?:no\.?|number)\s*:?|licen[cs]e\s*(?:no\.?|number)?\s*:?|no\.)\s*/i, "");
}

/** A registration as "<designation>, Reg. No. <number>", or "Reg. No. <number>" alone. */
export function formatRegistration(raw: string | null | undefined): string {
  const text = clean(raw);
  if (!text) return "";
  // "Reg. No. X" / "Registration No: X" / "Licence No. X" on its own.
  if (looksLikeRegistrationNumber(text) && /^(?:reg|licen|no\.)/i.test(text)) return `Reg. No. ${bareNumber(text)}`;
  // A designation followed by its number in brackets: "... (PEPCM/5718)".
  const trailing = /^(.*?)[\s,;:-]*\(([^()]+)\)\s*$/.exec(text);
  if (trailing && looksLikeRegistrationNumber(trailing[2])) {
    const designation = clean(trailing[1]).replace(/[,;:\s-]+$/, "");
    return designation ? `${designation}, Reg. No. ${bareNumber(trailing[2])}` : `Reg. No. ${bareNumber(trailing[2])}`;
  }
  // A designation followed by its number after a separator: "... - PPA/1840".
  const separated = /^(.*?)[\s]*(?:[,;:]|\s-\s|—|–)\s*((?:reg(?:istration)?\.?\s*(?:no\.?|number)\s*:?\s*)?[A-Z0-9][A-Z0-9/.-]*)$/i.exec(text);
  if (separated && clean(separated[1]) && looksLikeRegistrationNumber(separated[2])) {
    return `${clean(separated[1])}, Reg. No. ${bareNumber(separated[2])}`;
  }
  return text;
}

/**
 * A person with their proposed title and, when recorded, their registration:
 *   "Girum Wondwossen Seifu, Senior Architect & Urban Planner (Practicing Professional Architect, Reg. No. PPA/1840)"
 *   "Elias Manaye Yancha, Project Manager / Senior Civil Engineer — Practicing Professional Engineer (PE) in Construction Management, Reg. No. PEPCM/5718"
 * A credential that already carries brackets is set off with a dash instead
 * of being bracketed again, and a designation the title already states is
 * not repeated ("General Manager & Practicing Professional Engineer (Reg. No. PSTE/6884)").
 */
export function formatPersonWithCredential(name: string | null | undefined, title?: string | null, registration?: string | null): string {
  const who = clean(name);
  const role = clean(title);
  let credential = formatRegistration(registration);
  if (credential && role) {
    const m = /^(.*), (Reg\. No\. .+)$/.exec(credential);
    if (m && role.toLowerCase().includes(clean(m[1]).toLowerCase())) credential = m[2];
  }
  const base = role ? `${who}, ${role}` : who;
  if (!credential) return base;
  return credential.includes("(") ? `${base} — ${credential}` : `${base} (${credential})`;
}
