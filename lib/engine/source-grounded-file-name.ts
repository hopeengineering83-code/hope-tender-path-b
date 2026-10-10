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

// ── The tender-level file-name lists ────────────────────────────────────────
//
// 2026-09-29, Preview, a new tender uploaded as "Path tender.pdf": AI Analyze
// returned exactFileNaming ["Path tender"], the Build Plan made
// "Path tender.pdf" a required TENDER_REQUIRED_FILE, and auto-finalize stopped
// on it ("1 awaiting the tender-issued original"). The model reads every
// chunk under a [FILE_ID:…|FILE_NAME:Path tender.pdf] header and copied that
// name into the list. The list was written through unchecked — the
// requirement path above is grounded, the tender-level lists were not.
//
// So the lists get the same rule, plus one more: an uploaded file's own name
// is how the owner stored the input, not something the tender asks for. Such
// a name counts only when a DIFFERENT uploaded file states it (the RFP naming
// the separately uploaded "Annex 2 Bid Form"); a file stating its own name,
// or the name existing only as an upload, is not a request to submit it.

export type UploadedSourceFile = {
  fileName?: string | null;
  originalFileName?: string | null;
  extractedText?: string | null;
};

function nameKey(value: string): string {
  return normalize(value).replace(FILE_EXTENSION, "").replace(FILE_EXTENSION, "").trim();
}

export function sourceGroundedTenderFileNames(
  names: Iterable<string | null | undefined>,
  files: readonly UploadedSourceFile[],
): string[] {
  const kept: string[] = [];
  const seen = new Set<string>();
  const allTexts = files.map((file) => file.extractedText);
  for (const raw of names) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name) continue;
    const key = nameKey(name);
    const ownFiles = files.filter((file) =>
      [file.fileName, file.originalFileName].some((stored) => typeof stored === "string" && stored.trim() && nameKey(stored) === key),
    );
    const texts = ownFiles.length > 0
      ? files.filter((file) => !ownFiles.includes(file)).map((file) => file.extractedText)
      : allTexts;
    if (ownFiles.length > 0 && !texts.some((text) => typeof text === "string" && text.trim())) continue;
    const grounded = sourceGroundedExactFileName(name, texts);
    if (!grounded || seen.has(key)) continue;
    seen.add(key);
    kept.push(grounded);
  }
  return kept;
}
