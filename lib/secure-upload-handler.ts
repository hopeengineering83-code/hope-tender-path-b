// Compatibility entrypoint for request-bounded source ingestion.
// Verified bytes and deterministic job identities are persisted in the request;
// extraction/OCR and Company Vault ingestion execute only in durable workers.
export { handleSecureUpload } from "./background-secure-upload";
