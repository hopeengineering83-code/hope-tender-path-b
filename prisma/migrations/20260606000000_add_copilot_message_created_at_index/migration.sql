-- Add standalone createdAt index on TenderCopilotMessage
-- Allows the weekly cleanup cron to prune old rows without a full-table scan
CREATE INDEX IF NOT EXISTS "TenderCopilotMessage_createdAt_idx"
  ON "TenderCopilotMessage" ("createdAt");
