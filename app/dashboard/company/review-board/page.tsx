import { redirect } from "next/navigation";

/**
 * The Review Inbox is the single Company Vault review authority.
 * This compatibility route preserves old bookmarks without retaining a second
 * approval surface or mutation owner.
 */
export default function LegacyKnowledgeReviewBoardPage() {
  redirect("/dashboard/company/review");
}
