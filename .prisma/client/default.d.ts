/**
 * Minimal Prisma Client stub for offline TypeScript compilation
 * This is a fallback stub when prisma generate cannot be executed
 */

export declare class PrismaClient {
  constructor(options?: any);
  [key: string]: any;
}

export declare namespace Prisma {
  export type {
    User,
    Session,
    Tender,
    TenderFile,
    TenderAnalysis,
    TenderRequirement,
    TenderMetadataOverride,
    AiJob,
    TenderShare,
    PasswordResetToken,
    NotificationPreference,
    Notification,
    DocumentReview,
    DocumentComment,
  };

  export class Sql {
    [key: string]: any;
  }

  export interface PrismaAction {
    [key: string]: any;
  }

  export interface TransactionClient {
    [key: string]: any;
  }
}

// Define all models as any
export interface User {
  [key: string]: any;
}

export interface Session {
  [key: string]: any;
}

export interface Tender {
  [key: string]: any;
}

export interface TenderFile {
  [key: string]: any;
}

export interface TenderAnalysis {
  [key: string]: any;
}

export interface TenderRequirement {
  [key: string]: any;
}

export interface TenderMetadataOverride {
  [key: string]: any;
}

export interface AiJob {
  [key: string]: any;
}

export interface TenderShare {
  [key: string]: any;
}

export interface PasswordResetToken {
  [key: string]: any;
}

export interface NotificationPreference {
  [key: string]: any;
}

export interface Notification {
  [key: string]: any;
}

export interface DocumentReview {
  [key: string]: any;
}

export interface DocumentComment {
  [key: string]: any;
}

export declare const prisma: PrismaClient;

export default PrismaClient;
