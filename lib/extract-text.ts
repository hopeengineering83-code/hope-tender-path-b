// Text extraction from PDF and DOCX files for tender/company document analysis.
// Extraction happens at upload time so text is available to the analysis engine.

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  try {
    if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
      return await extractPdf(buffer);
    }
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword" ||
      fileName.toLowerCase().endsWith(".docx") ||
      fileName.toLowerCase().endsWith(".doc")
    ) {
      return await extractDocx(buffer);
    }
    if (mimeType.startsWith("text/") || fileName.toLowerCase().endsWith(".txt")) {
      return buffer.toString("utf8");
    }
    return "";
  } catch (err) {
    console.error("[extract-text] extraction failed:", err);
    return "";
  }
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
  const result = await pdfParse(buffer);
  return result.text ?? "";
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}
