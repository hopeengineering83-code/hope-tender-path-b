// A requirement's exactFileName names a file the TENDER asks the bidder to
// submit. It becomes a required Build Plan item, so a name the tender never
// stated turns into a deliverable nobody asked for.
//
// 2026-09-28, Preview, accept run 36452678140: a re-run of AI Analyze wrote
// "Expert CVS.pdf.txt", "Projects Reference.pdf.txt" and
// "02_Legal_Registration_Documents_Summary.docx.txt" — the stored names of the
// owner's Company Vault uploads — onto three requirements. The Build Plan made
// two of them required submission files and the package went from READY to
// blocked on documents that do not exist.
//
// The model's value is kept only when the tender source states it:
//  - the full name appears in the source, or
//  - the name has one extension and its base name appears in the source
//    ("Technical Proposal.pdf" for a tender asking for a technical proposal in
//    PDF).
// A stacked extension ("x.pdf.txt", "x.docx.txt") is how an uploaded file is
// stored after text conversion; it is kept only when the source states it in
// full. With no source text there is nothing to check against, so the value
// is returned unchanged and the extraction gates decide.

const FILE_EXTENSION = /\.(?:docx?|pdf|xlsx?|pptx?|zip|csv|txt|rtf|odt|json)$/i;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[_\s]+/g, " ")
    .trim();
}

export function sourceGroundedExactFileName(
  name: string | null | undefined,
  sourceTexts: Iterable<string | null | undefined>,
): string | null {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) return null;
  const sources = [...sourceTexts]
    .filter((text): text is string => typeof text === "string" && text.trim().length > 0)
    .map(normalize);
  if (sources.length === 0) return value;
  const statedInSource = (needle: string) => {
    const normalized = normalize(needle);
    return normalized.length > 0 && sources.some((text) => text.includes(normalized));
  };
  if (statedInSource(value)) return value;
  if (!FILE_EXTENSION.test(value)) return null;
  const base = value.replace(FILE_EXTENSION, "");
  if (FILE_EXTENSION.test(base)) return null;
  return statedInSource(base) ? value : null;
}
