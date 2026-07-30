import { redirect } from "next/navigation";

/**
 * Automatic Verification is the single Company Vault source-authority view.
 * This compatibility route preserves old bookmarks without retaining a second
 * approval surface or mutation owner.
 */
export default function LegacyKnowledgeReviewBoardPage() {
  redirect("/dashboard/company/review");
}
