"use client";

// Disclosure-aware anchor link — opens parent <details> before scrolling.
//
// This is the client-side companion to the openParentDetailsAndScroll() helper.
// Server components cannot use onClick, so any server component that needs a
// hash-anchor link to a panel inside a <details>/<WorkflowStage>/<Disclosure>
// wrapper should use this component instead of a plain <a href="#anchor">.
//
// Without this, clicking the link would silently fail when the target panel
// is inside a closed disclosure — the same "icons act independently" bug
// that affected the workflow action center.

import { useCallback, type ReactNode } from "react";
import { openParentDetailsAndScroll } from "@/lib/ui/tender-workflow-sync";

export function DisclosureAnchorLink({
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
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Only intercept hash links (e.g. "#tender-edit-form")
      if (!href.startsWith("#")) return;
      event.preventDefault();
      const selector = href;
      const element = document.querySelector(selector);
      if (!element) return;
      openParentDetailsAndScroll(element);
    },
    [href],
  );

  return (
    <a href={href} onClick={handleClick} className={className} title={title}>
      {children}
    </a>
  );
}
