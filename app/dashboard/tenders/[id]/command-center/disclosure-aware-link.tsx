"use client";

import { useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { openParentDetailsAndScroll } from "@/lib/ui/tender-workflow-sync";

/**
 * Client-side wrapper for cross-page hash links from the command center to
 * the tender detail page. After navigation, opens any closed <Disclosure>
 * that wraps the target element, then scrolls to it.
 *
 * This replaces plain <Link href="...#anchor"> which cannot open closed
 * disclosures — the root cause of the "icons act independently" bug.
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
      // Parse the href to extract pathname and hash
      const url = new URL(href, window.location.origin);
      const hash = url.hash;

      // If it's a same-page hash link, just open the disclosure
      if (url.pathname === window.location.pathname) {
        event.preventDefault();
        const element = document.querySelector(hash);
        if (element) {
          openParentDetailsAndScroll(element);
        }
        return;
      }

      // For cross-page links, navigate first, then open the disclosure
      // after the page loads
      event.preventDefault();
      router.push(href);
      // After navigation, wait for the page to render, then open the disclosure
      setTimeout(() => {
        if (hash) {
          const element = document.querySelector(hash);
          if (element) {
            openParentDetailsAndScroll(element);
          }
        }
      }, 500);
    },
    [href, router],
  );

  return (
    <a
      href={href}
      onClick={handleClick}
      className={className}
      title={title}
    >
      {children}
    </a>
  );
}
