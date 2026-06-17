-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PROPOSAL_MANAGER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "description" TEXT,
    "website" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "country" TEXT,
    "serviceLines" TEXT NOT NULL DEFAULT '[]',
    "sectors" TEXT NOT NULL DEFAULT '[]',
    "profileSummary" TEXT,
    "knowledgeMode" TEXT NOT NULL DEFAULT 'PROFILE_FIRST',
    "setupCompletedAt" TIMESTAMP(3),
    "gmName" TEXT,
    "gmTitle" TEXT,
    "gmLicense" TEXT,
    "foundingYear" INTEGER,
    "headcount" INTEGER,
    "licenseGrade" TEXT,
    "registrationNumber" TEXT,
    "tin" TEXT,
    "vat" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "aiStrictMode" BOOLEAN NOT NULL DEFAULT true,
    "allowBrandingDefault" BOOLEAN NOT NULL DEFAULT true,
    "allowSignatureDefault" BOOLEAN NOT NULL DEFAULT true,
    "allowStampDefault" BOOLEAN NOT NULL DEFAULT true,
    "exportFormat" TEXT NOT NULL DEFAULT 'DOCX',
    "pageNumbering" BOOLEAN NOT NULL DEFAULT true,
    "includeTableOfContents" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL DEFAULT '',
    "fileContent" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "extractedText" TEXT,
    "aiExtractionStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "aiExtractedAt" TIMESTAMP(3),
    "aiExtractionError" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL DEFAULT '',
    "fileContent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expert" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "yearsExperience" INTEGER,
    "disciplines" TEXT NOT NULL DEFAULT '[]',
    "sectors" TEXT NOT NULL DEFAULT '[]',
    "certifications" TEXT NOT NULL DEFAULT '[]',
    "profile" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "trustLevel" TEXT NOT NULL DEFAULT 'REGEX_DRAFT',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "sourceDocumentId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientName" TEXT,
    "country" TEXT,
    "sector" TEXT,
    "serviceAreas" TEXT NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "contractValue" DOUBLE PRECISION,
    "currency" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "trustLevel" TEXT NOT NULL DEFAULT 'REGEX_DRAFT',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "sourceDocumentId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEvidence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "description" TEXT,
    "fileName" TEXT,
    "storagePath" TEXT,
    "extractedText" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authority" TEXT,
    "referenceNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "recordType" TEXT NOT NULL,
    "currency" TEXT DEFAULT 'USD',
    "amount" DOUBLE PRECISION,
    "notes" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyComplianceRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "complianceType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "evidenceSummary" TEXT,
    "referenceNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyComplianceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tender" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "clientName" TEXT,
    "category" TEXT NOT NULL DEFAULT 'General',
    "country" TEXT,
    "budget" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "deadline" TIMESTAMP(3),
    "submissionMethod" TEXT,
    "submissionAddress" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "stage" TEXT NOT NULL DEFAULT 'TENDER_INTAKE',
    "intakeSummary" TEXT,
    "analysisSummary" TEXT,
    "evaluationMethodology" TEXT,
    "pageLimit" INTEGER,
    "exactFileOrder" TEXT NOT NULL DEFAULT '[]',
    "exactFileNaming" TEXT NOT NULL DEFAULT '[]',
    "readinessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "bidOutcome" TEXT,
    "bidOutcomeNote" TEXT,
    "bidOutcomeAt" TIMESTAMP(3),
    "clientContactName" TEXT,
    "clientContactTitle" TEXT,
    "clientContactEmail" TEXT,
    "clientContactPhone" TEXT,
    "clientAddress" TEXT,
    "submissionEmails" TEXT,
    "validityDays" INTEGER,
    "bidBondAmount" DOUBLE PRECISION,
    "bidBondCurrency" TEXT,
    "preBidMeetingDate" TIMESTAMP(3),
    "preBidMeetingLocation" TEXT,
    "mandatorySiteVisit" BOOLEAN NOT NULL DEFAULT false,
    "numberOfCopiesRequired" INTEGER,
    "technicalWeight" INTEGER,
    "financialWeight" INTEGER,
    "procuringEntityName" TEXT,
    "legalClientName" TEXT,
    "donorAgency" TEXT,
    "implementingAgency" TEXT,
    "metadataContaminated" BOOLEAN NOT NULL DEFAULT false,
    "clientNameSourcePage" INTEGER,
    "clientNameSourceQuote" TEXT,
    "submissionEmailSourcePage" INTEGER,
    "contactDetailsSourceJson" TEXT,
    "submissionMethodSourcePage" INTEGER,
    "submissionMethodSourceQuote" TEXT,
    "submissionAddressSourcePage" INTEGER,
    "submissionAddressSourceQuote" TEXT,
    "evaluationCriteriaSourceJson" TEXT,
    "analysisExtractionStatus" TEXT,
    "clientCity" TEXT,
    "clientWebsite" TEXT,
    "submissionEmailSubject" TEXT,
    "preBidChannel" TEXT,
    "clientRepresentative" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Tender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderShare" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "maxDownloads" INTEGER,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "TenderShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderFile" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL DEFAULT '',
    "fileContent" TEXT,
    "classification" TEXT,
    "extractedText" TEXT,
    "totalPages" INTEGER,
    "extractedPages" INTEGER,
    "ocrPages" INTEGER,
    "failedPages" INTEGER,
    "extractionScore" DOUBLE PRECISION,
    "extractionMethod" TEXT,
    "deletionStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "deletionAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastDeletionError" TEXT,
    "deletedAt" TIMESTAMP(3),
    "pageStatusJson" TEXT,
    "ocrModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderRequirement" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requirementType" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "sectionReference" TEXT,
    "requiredQuantity" INTEGER,
    "pageLimit" INTEGER,
    "exactFileName" TEXT,
    "exactOrder" INTEGER,
    "restrictions" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "sourceTenderFileId" TEXT,
    "sourcePageNumber" INTEGER,
    "sourceSectionHeading" TEXT,
    "sourceExactQuote" TEXT,
    "sourceExtractionMethod" TEXT,
    "sourceConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceMatrix" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "requirementId" TEXT,
    "evidenceType" TEXT NOT NULL,
    "evidenceSource" TEXT NOT NULL,
    "evidenceReference" TEXT,
    "supportLevel" TEXT NOT NULL DEFAULT 'PARTIAL',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderExpertMatch" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderExpertMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderProjectMatch" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderProjectMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceGap" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "requirementId" TEXT,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mitigationPlan" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'DOCX',
    "storagePath" TEXT,
    "exactFileName" TEXT,
    "exactOrder" INTEGER,
    "contentSummary" TEXT,
    "fileContent" TEXT,
    "validationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "generationStatus" TEXT NOT NULL DEFAULT 'PLANNED',
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNotes" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedExpertCount" INTEGER DEFAULT 0,
    "draftExpertCount" INTEGER DEFAULT 0,
    "reviewedProjectCount" INTEGER DEFAULT 0,
    "draftProjectCount" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentReview" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "priorStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentComment" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportPackage" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARING',
    "fileList" TEXT NOT NULL DEFAULT '[]',
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "description" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalVersion" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "markdown" TEXT NOT NULL,
    "fileContent" TEXT,
    "benchmarkScore" INTEGER,
    "qualityScore" INTEGER,
    "winProbabilityScore" INTEGER,
    "mode" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchScoreBreakdown" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "dimensionCode" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "rationale" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ENGINE_MATCH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchScoreBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluatorObjection" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "proposalVersion" INTEGER NOT NULL DEFAULT 1,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sectionRef" TEXT,
    "recommendedAction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluatorObjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionEvidenceMap" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "proposalVersion" INTEGER NOT NULL DEFAULT 1,
    "sectionId" TEXT NOT NULL,
    "sectionTitle" TEXT NOT NULL,
    "requirementIds" TEXT NOT NULL DEFAULT '',
    "evidenceIds" TEXT NOT NULL DEFAULT '',
    "expertIds" TEXT NOT NULL DEFAULT '',
    "projectIds" TEXT NOT NULL DEFAULT '',
    "textHash" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "reviewerStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "content" TEXT,
    "aiProvider" TEXT,
    "lastGeneratedAt" TIMESTAMP(3),
    "generationAttemptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SectionEvidenceMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT,
    "userId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "input" TEXT NOT NULL DEFAULT '{}',
    "output" TEXT,
    "errorMessage" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "runId" TEXT,
    "analysisInputHash" TEXT,
    "analysisVersion" BIGSERIAL NOT NULL,
    "stagedMergedResult" TEXT,
    "validationResult" TEXT,
    "promotedAt" TIMESTAMP(3),
    "promotedBy" TEXT,
    "supersededBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiJobStep" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "stepName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiJobStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalyzeChunk" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "resultJson" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAnalyzeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderHealthSnapshot" (
    "provider" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureCategory" TEXT,
    "lastSafeErrorMessage" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "cooldownUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderHealthSnapshot_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "PricingWorkbook" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "validityDays" INTEGER NOT NULL DEFAULT 90,
    "vatPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "withholdingPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contingencyPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scenario" TEXT NOT NULL DEFAULT 'BALANCED',
    "noPriceLeakage" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingWorkbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostLine" (
    "id" TEXT NOT NULL,
    "workbookId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'DAY',
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expertId" TEXT,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderCopilotMessage" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderCopilotMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderMetadataOverride" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "fieldState" TEXT NOT NULL,
    "overrideValue" TEXT,
    "reason" TEXT,
    "previousValue" TEXT,
    "overriddenBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderMetadataOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "keyHash" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("keyHash")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Company_userId_key" ON "Company"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSettings_companyId_key" ON "AppSettings"("companyId");

-- CreateIndex
CREATE INDEX "CompanyDocument_companyId_idx" ON "CompanyDocument"("companyId");

-- CreateIndex
CREATE INDEX "CompanyAsset_companyId_idx" ON "CompanyAsset"("companyId");

-- CreateIndex
CREATE INDEX "Expert_companyId_idx" ON "Expert"("companyId");

-- CreateIndex
CREATE INDEX "Expert_trustLevel_idx" ON "Expert"("trustLevel");

-- CreateIndex
CREATE INDEX "Expert_deletedAt_idx" ON "Expert"("deletedAt");

-- CreateIndex
CREATE INDEX "Project_companyId_idx" ON "Project"("companyId");

-- CreateIndex
CREATE INDEX "Project_trustLevel_idx" ON "Project"("trustLevel");

-- CreateIndex
CREATE INDEX "Project_deletedAt_idx" ON "Project"("deletedAt");

-- CreateIndex
CREATE INDEX "ProjectEvidence_projectId_idx" ON "ProjectEvidence"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TenderShare_token_key" ON "TenderShare"("token");

-- CreateIndex
CREATE INDEX "TenderShare_tenderId_idx" ON "TenderShare"("tenderId");

-- CreateIndex
CREATE INDEX "TenderShare_token_idx" ON "TenderShare"("token");

-- CreateIndex
CREATE INDEX "TenderFile_tenderId_idx" ON "TenderFile"("tenderId");

-- CreateIndex
CREATE INDEX "TenderRequirement_tenderId_idx" ON "TenderRequirement"("tenderId");

-- CreateIndex
CREATE INDEX "TenderRequirement_sourceTenderFileId_idx" ON "TenderRequirement"("sourceTenderFileId");

-- CreateIndex
CREATE INDEX "ComplianceMatrix_requirementId_idx" ON "ComplianceMatrix"("requirementId");

-- CreateIndex
CREATE INDEX "TenderExpertMatch_tenderId_idx" ON "TenderExpertMatch"("tenderId");

-- CreateIndex
CREATE UNIQUE INDEX "TenderExpertMatch_tenderId_expertId_key" ON "TenderExpertMatch"("tenderId", "expertId");

-- CreateIndex
CREATE INDEX "TenderProjectMatch_tenderId_idx" ON "TenderProjectMatch"("tenderId");

-- CreateIndex
CREATE UNIQUE INDEX "TenderProjectMatch_tenderId_projectId_key" ON "TenderProjectMatch"("tenderId", "projectId");

-- CreateIndex
CREATE INDEX "ComplianceGap_requirementId_idx" ON "ComplianceGap"("requirementId");

-- CreateIndex
CREATE INDEX "DocumentReview_documentId_createdAt_idx" ON "DocumentReview"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentReview_reviewerId_idx" ON "DocumentReview"("reviewerId");

-- CreateIndex
CREATE INDEX "DocumentComment_documentId_createdAt_idx" ON "DocumentComment"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentComment_documentId_parentId_idx" ON "DocumentComment"("documentId", "parentId");

-- CreateIndex
CREATE INDEX "DocumentComment_authorId_idx" ON "DocumentComment"("authorId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProposalVersion_tenderId_idx" ON "ProposalVersion"("tenderId");

-- CreateIndex
CREATE INDEX "ProposalVersion_tenderId_version_idx" ON "ProposalVersion"("tenderId", "version");

-- CreateIndex
CREATE INDEX "MatchScoreBreakdown_tenderId_entityType_idx" ON "MatchScoreBreakdown"("tenderId", "entityType");

-- CreateIndex
CREATE INDEX "MatchScoreBreakdown_tenderId_entityId_idx" ON "MatchScoreBreakdown"("tenderId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchScoreBreakdown_tenderId_entityType_entityId_dimensionC_key" ON "MatchScoreBreakdown"("tenderId", "entityType", "entityId", "dimensionCode");

-- CreateIndex
CREATE INDEX "EvaluatorObjection_tenderId_status_idx" ON "EvaluatorObjection"("tenderId", "status");

-- CreateIndex
CREATE INDEX "EvaluatorObjection_tenderId_severity_status_idx" ON "EvaluatorObjection"("tenderId", "severity", "status");

-- CreateIndex
CREATE INDEX "SectionEvidenceMap_tenderId_idx" ON "SectionEvidenceMap"("tenderId");

-- CreateIndex
CREATE UNIQUE INDEX "SectionEvidenceMap_tenderId_proposalVersion_sectionId_key" ON "SectionEvidenceMap"("tenderId", "proposalVersion", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "AiJob_runId_key" ON "AiJob"("runId");

-- CreateIndex
CREATE INDEX "AiJob_userId_status_idx" ON "AiJob"("userId", "status");

-- CreateIndex
CREATE INDEX "AiJob_tenderId_jobType_idx" ON "AiJob"("tenderId", "jobType");

-- CreateIndex
CREATE INDEX "AiJob_status_createdAt_idx" ON "AiJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiJobStep_jobId_stepIndex_idx" ON "AiJobStep"("jobId", "stepIndex");

-- CreateIndex
CREATE INDEX "AiAnalyzeChunk_tenderId_userId_contentHash_idx" ON "AiAnalyzeChunk"("tenderId", "userId", "contentHash");

-- CreateIndex
CREATE INDEX "AiAnalyzeChunk_status_idx" ON "AiAnalyzeChunk"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AiAnalyzeChunk_tenderId_userId_contentHash_chunkIndex_key" ON "AiAnalyzeChunk"("tenderId", "userId", "contentHash", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "PricingWorkbook_tenderId_key" ON "PricingWorkbook"("tenderId");

-- CreateIndex
CREATE INDEX "PricingWorkbook_tenderId_idx" ON "PricingWorkbook"("tenderId");

-- CreateIndex
CREATE INDEX "CostLine_workbookId_idx" ON "CostLine"("workbookId");

-- CreateIndex
CREATE INDEX "TenderCopilotMessage_tenderId_userId_createdAt_idx" ON "TenderCopilotMessage"("tenderId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "TenderCopilotMessage_tenderId_userId_idx" ON "TenderCopilotMessage"("tenderId", "userId");

-- CreateIndex
CREATE INDEX "TenderCopilotMessage_createdAt_idx" ON "TenderCopilotMessage"("createdAt");

-- CreateIndex
CREATE INDEX "TenderMetadataOverride_tenderId_idx" ON "TenderMetadataOverride"("tenderId");

-- CreateIndex
CREATE UNIQUE INDEX "TenderMetadataOverride_tenderId_field_key" ON "TenderMetadataOverride"("tenderId", "field");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDocument" ADD CONSTRAINT "CompanyDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAsset" ADD CONSTRAINT "CompanyAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expert" ADD CONSTRAINT "Expert_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expert" ADD CONSTRAINT "Expert_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "CompanyDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "CompanyDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEvidence" ADD CONSTRAINT "ProjectEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRecord" ADD CONSTRAINT "LegalRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialRecord" ADD CONSTRAINT "FinancialRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyComplianceRecord" ADD CONSTRAINT "CompanyComplianceRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tender" ADD CONSTRAINT "Tender_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderShare" ADD CONSTRAINT "TenderShare_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderShare" ADD CONSTRAINT "TenderShare_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderFile" ADD CONSTRAINT "TenderFile_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderRequirement" ADD CONSTRAINT "TenderRequirement_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceMatrix" ADD CONSTRAINT "ComplianceMatrix_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceMatrix" ADD CONSTRAINT "ComplianceMatrix_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "TenderRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderExpertMatch" ADD CONSTRAINT "TenderExpertMatch_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderExpertMatch" ADD CONSTRAINT "TenderExpertMatch_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderProjectMatch" ADD CONSTRAINT "TenderProjectMatch_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderProjectMatch" ADD CONSTRAINT "TenderProjectMatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceGap" ADD CONSTRAINT "ComplianceGap_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReview" ADD CONSTRAINT "DocumentReview_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "GeneratedDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReview" ADD CONSTRAINT "DocumentReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentComment" ADD CONSTRAINT "DocumentComment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "GeneratedDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentComment" ADD CONSTRAINT "DocumentComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentComment" ADD CONSTRAINT "DocumentComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DocumentComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportPackage" ADD CONSTRAINT "ExportPackage_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchScoreBreakdown" ADD CONSTRAINT "MatchScoreBreakdown_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluatorObjection" ADD CONSTRAINT "EvaluatorObjection_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionEvidenceMap" ADD CONSTRAINT "SectionEvidenceMap_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJobStep" ADD CONSTRAINT "AiJobStep_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingWorkbook" ADD CONSTRAINT "PricingWorkbook_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLine" ADD CONSTRAINT "CostLine_workbookId_fkey" FOREIGN KEY ("workbookId") REFERENCES "PricingWorkbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderCopilotMessage" ADD CONSTRAINT "TenderCopilotMessage_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderMetadataOverride" ADD CONSTRAINT "TenderMetadataOverride_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderMetadataOverride" ADD CONSTRAINT "TenderMetadataOverride_overriddenBy_fkey" FOREIGN KEY ("overriddenBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
