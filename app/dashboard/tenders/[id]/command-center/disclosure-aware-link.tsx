"use client";

import { useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { openParentDetailsAndScroll } from "@/lib/ui/tender-workflow-sync";

/**
 * Cross-page workflow link that waits for the destination route and target
 * element, opens every closed <details> ancestor, and then scrolls below the
 * sticky header. Plain hash links cannot reveal targets hidden inside closed
 * workflow disclosures.
 */
export function DisclosureAwareLink({
  href,
  className,
  children,
  title,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  const router = useRouter();

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      const url = new URL(href, window.location.origin);
      const hash = url.hash;

      if (!hash) return;

      event.preventDefault();

      const revealTarget = (): boolean => {
        if (window.location.pathname !== url.pathname) return false;
        const element = document.querySelector(hash);
        if (!element) return false;

        openParentDetailsAndScroll(element);
        window.history.replaceState(null, "", `${url.pathname}${url.search}${hash}`);
        return true;
      };

      if (revealTarget()) return;

      router.push(`${url.pathname}${url.search}${hash}`);

      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        if (revealTarget() || attempts >= 50) {
          window.clearInterval(timer);
        }
      }, 100);
    },
    [href, router],
  );

  return (
    <a href={href} onClick={handleClick} className={className} title={title}>
      {children}
    </a>
  );
}
