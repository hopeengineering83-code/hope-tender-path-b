-- Forward-only migration: add missing durable source-evidence columns for
-- policy-critical metadata fields that lack them.
--
-- titleSourceFileId/Page/Quote: title evidence (title was policy-critical but
--   had no durable source storage).
-- deadlineSourceFileId/Page/Quote: deadline evidence (deadline value was hashed
--   but deadline source evidence was not persisted or hashed).
-- submissionEmailSourceQuote: email endpoint evidence quote (the sourceFileId
--   and sourcePage existed but the source quote was missing, so quote
--   containment could not be verified for email submissions).

ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "titleSourceFileId" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "titleSourcePage" INTEGER;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "titleSourceQuote" TEXT;

ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "deadlineSourceFileId" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "deadlineSourcePage" INTEGER;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "deadlineSourceQuote" TEXT;

ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "submissionEmailSourceQuote" TEXT;
