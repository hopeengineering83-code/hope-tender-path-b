"use client";

import { usePathname } from "next/navigation";
import { DeleteTenderButton } from "./delete-tender-button";

const TENDER_DETAIL = /^\/dashboard\/tenders\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

export function TenderDetailDeleteControl({ canDelete }: { canDelete: boolean }) {
  const pathname = usePathname();
  if (!canDelete) return null;
  const match = pathname.match(TENDER_DETAIL);
  if (!match) return null;
  return <DeleteTenderButton tenderId={match[1]} compact />;
}
