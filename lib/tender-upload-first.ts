// Compatibility entrypoint for the canonical request-bounded tender intake.
// The implementation stores verified bytes and durable job rows only; all
// extraction/OCR executes through EXTRACT_TEXT workers.
export { handleUploadFirstTender } from "./background-tender-upload";
