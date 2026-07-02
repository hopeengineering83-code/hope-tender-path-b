// Real-DOM component-test environment for node:test.
//
// Import this module FIRST in a test file. It registers happy-dom globals
// and exposes @testing-library/react's render wrapped in Next.js's
// AppRouterContext so client components that call useRouter() from
// "next/navigation" mount outside the Next runtime (the router context is
// an ordinary React context — providing it is all useRouter() needs).
//
// These are REAL component renders (react-dom/client into a live DOM):
// effects run, events fire, and fetch calls made by the component hit the
// installed fetch mock. Nothing here simulates or mirrors component logic.

import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/dashboard/tenders/test-tender" });
const g = globalThis as Record<string, unknown>;
g.window = window;
g.document = window.document;
// Node 22 ships a getter-only globalThis.navigator — override via defineProperty.
Object.defineProperty(globalThis, "navigator", {
  value: window.navigator,
  configurable: true,
});
for (const key of [
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLIFrameElement",
  "SVGElement",
  "Element",
  "Node",
  "Text",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "InputEvent",
  "CustomEvent",
  "MutationObserver",
  "DocumentFragment",
] as const) {
  g[key] = (window as unknown as Record<string, unknown>)[key];
}
g.getComputedStyle = window.getComputedStyle.bind(window);
g.requestAnimationFrame = window.requestAnimationFrame.bind(window);
g.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
// React's act() requires this flag so state updates flush deterministically.
g.IS_REACT_ACT_ENVIRONMENT = true;

export type FetchCall = { url: string; method: string; body?: unknown };

/**
 * Installs a fetch mock that records every call and answers from the
 * provided route table (substring or regex match). Unmatched calls resolve
 * with 404 JSON so components fail soft instead of hanging. Returns the
 * live call log — assertions on it prove exactly which requests the
 * rendered component dispatched.
 */
export function installFetchMock(
  routes: Array<{ match: string | RegExp; method?: string; status?: number; json: unknown }> = [],
): FetchCall[] {
  const calls: FetchCall[] = [];
  g.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ url, method, body });
    for (const route of routes) {
      const matches = typeof route.match === "string" ? url.includes(route.match) : route.match.test(url);
      if (matches && (!route.method || route.method.toUpperCase() === method)) {
        return new Response(JSON.stringify(route.json), {
          status: route.status ?? 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ error: "not mocked" }), { status: 404, headers: { "content-type": "application/json" } });
  };
  return calls;
}

// Import React pieces AFTER the DOM globals exist. ESM hoists these above
// the body, but neither react, react-dom, nor @testing-library touches the
// DOM at import time — only render() does, and by then the globals above
// are installed.
import * as React from "react";
import { render as rtlRender, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

// tsx/esbuild compiles the components' JSX with the classic runtime
// (tsconfig has jsx: "preserve"; Next injects the automatic runtime at
// build). Provide the global the classic transform references.
g.React = React;

export { React, fireEvent, waitFor, cleanup, act, within };

/** Fake Next App Router — satisfies useRouter() for client components. */
export const fakeRouter = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  hmrRefresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => Promise.resolve(),
};

/** Renders the actual component inside the App Router context. */
export function renderWithRouter(element: React.ReactElement): RenderResult {
  return rtlRender(element, {
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(AppRouterContext.Provider, { value: fakeRouter as never }, children),
  });
}

/** All button labels currently rendered inside the container. */
export function buttonLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());
}

/** Finds a rendered button whose text includes the label, or null. */
export function findButton(container: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(label),
    ) as HTMLButtonElement | undefined) ?? null
  );
}
