// Set up global environment variables for Next.js Link component in happy-dom
(globalThis as any).self = globalThis;
(globalThis as any).requestIdleCallback = (cb: any) => setTimeout(cb, 1);
(globalThis as any).cancelIdleCallback = (id: any) => clearTimeout(id);

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  React,
  renderWithRouter,
  installFetchMock,
  fireEvent,
  waitFor,
  cleanup,
  fakeRouter,
  type FetchCall,
} from "./helpers/rtl-env";
import { NotificationBell } from "../app/components/notification-bell";

const h = React.createElement;

let calls: FetchCall[];

describe("NotificationBell Accessibility and Non-Optimistic Behavior", () => {
  beforeEach(() => {
    // Reset fakeRouter push tracker
    fakeRouter.push = () => {};

    // Basic setup: initial list of notifications
    calls = installFetchMock([
      {
        match: "/api/notifications?limit=20",
        method: "GET",
        json: {
          unreadCount: 2,
          notifications: [
            {
              id: "n1",
              type: "TENDER_DEADLINE_SOON",
              title: "Tender Deadline Approaching",
              body: "The tender is closing soon.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t1",
              readAt: null,
            },
            {
              id: "n2",
              type: "TENDER_GENERATED",
              title: "Tender Proposal Generated",
              body: "Document is ready.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t2",
              readAt: null,
            },
          ],
        },
      },
      {
        match: "/api/notifications",
        method: "PATCH",
        json: { success: true },
      },
    ]);
  });

  afterEach(() => cleanup());

  it("adds accessibility attributes and stable popup id to the trigger button", () => {
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(button.getAttribute("aria-controls"), "notification-popup");
    assert.equal(button.getAttribute("aria-label"), "Notifications (2 unread)");
  });

  it("hides unread visual badge with aria-hidden='true'", () => {
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const badge = container.querySelector("span");
    assert.ok(badge);
    assert.equal(badge.getAttribute("aria-hidden"), "true");
    assert.equal(badge.textContent?.trim(), "2");
  });

  it("updates accessibility attributes after clicking/opening the bell", async () => {
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    fireEvent.click(button);
    assert.equal(button.getAttribute("aria-expanded"), "true");

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });
  });

  it("provides specific meaningful accessible label for the close-icon button on unread notification", async () => {
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    fireEvent.click(button);

    await waitFor(() => {
      const closeButtons = container.querySelectorAll("#notification-popup button");
      // Find the cross buttons (there should be close buttons with a specific aria-label)
      const markReadBtn1 = Array.from(closeButtons).find(
        (btn) => btn.getAttribute("aria-label") === 'Mark "Tender Deadline Approaching" as read'
      );
      const markReadBtn2 = Array.from(closeButtons).find(
        (btn) => btn.getAttribute("aria-label") === 'Mark "Tender Proposal Generated" as read'
      );
      assert.ok(markReadBtn1);
      assert.ok(markReadBtn2);
      // The close mark is a real inline SVG icon (components/icons.tsx), not a raw
      // Unicode glyph — glyph rendering depends on the viewer's OS/browser emoji
      // font and shows blank "tofu" boxes in many environments. The accessible
      // name still comes from the button's own aria-label above; this just
      // confirms a real icon (not empty content) renders inside the button.
      assert.ok(markReadBtn1.querySelector("svg"), "close button must render an icon");
    });
  });

  it("performs NON-OPTIMISTIC unread/read state updates (updates only after OK response)", async () => {
    // Redefine fetch mock so the GET returns 2 unread, and the PATCH fails
    cleanup();
    calls = installFetchMock([
      {
        match: "/api/notifications?limit=20",
        method: "GET",
        json: {
          unreadCount: 2,
          notifications: [
            {
              id: "n1",
              type: "TENDER_DEADLINE_SOON",
              title: "Tender Deadline Approaching",
              body: "The tender is closing soon.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t1",
              readAt: null,
            },
            {
              id: "n2",
              type: "TENDER_GENERATED",
              title: "Tender Proposal Generated",
              body: "Document is ready.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t2",
              readAt: null,
            },
          ],
        },
      },
      {
        match: "/api/notifications",
        method: "PATCH",
        status: 500,
        json: { error: "Internal Server Error" },
      },
    ]);

    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    // Initial aria label has 2 unread
    assert.equal(button.getAttribute("aria-label"), "Notifications (2 unread)");

    // Open dropdown
    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const closeButtons = container.querySelectorAll("#notification-popup button");
    const markReadBtn = Array.from(closeButtons).find(
      (btn) => btn.getAttribute("aria-label") === 'Mark "Tender Deadline Approaching" as read'
    ) as HTMLButtonElement;
    assert.ok(markReadBtn);

    // Click mark read
    fireEvent.click(markReadBtn);

    // Check that fetch PATCH was dispatched
    await waitFor(() => {
      assert.ok(calls.some((c) => c.method === "PATCH"));
    });

    // Since PATCH failed (500), the unread count should NOT be updated.
    // aria-label of trigger should still be "Notifications (2 unread)"
    assert.equal(button.getAttribute("aria-label"), "Notifications (2 unread)");

    // An error alert should be surfaced in the popup
    const alertDiv = container.querySelector("[role='alert']");
    assert.ok(alertDiv);
    assert.match(alertDiv.textContent ?? "", /Failed to mark notification as read/);
  });

  it("performs SUCCESSFUL unread/read state updates (updates after OK response)", async () => {
    // Redefine mock so PATCH succeeds, and the follow-up GET returns 1 unread
    cleanup();
    let getCallCount = 0;
    const g = globalThis as any;
    g.fetch = async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method || "GET";
      calls.push({ url, method, body: init?.body });

      if (method === "PATCH") {
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
      }

      getCallCount++;
      return new Response(
        JSON.stringify({
          unreadCount: getCallCount > 1 ? 1 : 2,
          notifications: [
            {
              id: "n1",
              type: "TENDER_DEADLINE_SOON",
              title: "Tender Deadline Approaching",
              body: "The tender is closing soon.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t1",
              readAt: getCallCount > 1 ? new Date().toISOString() : null,
            },
            {
              id: "n2",
              type: "TENDER_GENERATED",
              title: "Tender Proposal Generated",
              body: "Document is ready.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t2",
              readAt: null,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    calls = [];
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    // Open dropdown to trigger first GET
    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const closeButtons = container.querySelectorAll("#notification-popup button");
    const markReadBtn = Array.from(closeButtons).find(
      (btn) => btn.getAttribute("aria-label") === 'Mark "Tender Deadline Approaching" as read'
    ) as HTMLButtonElement;
    assert.ok(markReadBtn);

    // Click mark read
    fireEvent.click(markReadBtn);

    // Check that fetch PATCH was dispatched and then a second GET re-fetched authoritatively
    await waitFor(() => {
      assert.ok(calls.some((c) => c.method === "PATCH"));
      const getCalls = calls.filter((c) => c.method === "GET" && c.url.includes("/api/notifications"));
      assert.equal(getCalls.length, 2); // 1st on open, 2nd on success authoritative sync
    });

    // Since GET returned unreadCount = 1, aria-label of trigger should be decremented
    await waitFor(() => {
      assert.equal(button.getAttribute("aria-label"), "Notifications (1 unread)");
    });

    // No error alert should be surfaced in the popup
    const alertDiv = container.querySelector("[role='alert']");
    assert.ok(!alertDiv);
  });

  it("disables markRead close button and ignores duplicate rapid clicks to prevent race conditions", async () => {
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const closeButtons = container.querySelectorAll("#notification-popup button");
    const markReadBtn = Array.from(closeButtons).find(
      (btn) => btn.getAttribute("aria-label") === 'Mark "Tender Deadline Approaching" as read'
    ) as HTMLButtonElement;
    assert.ok(markReadBtn);

    // Click mark read rapidly twice
    fireEvent.click(markReadBtn);
    fireEvent.click(markReadBtn);

    // Only one fetch call should be recorded, and the button should be disabled
    assert.equal(markReadBtn.disabled, true);

    await waitFor(() => {
      const patchCalls = calls.filter((c) => c.method === "PATCH");
      assert.equal(patchCalls.length, 1);
    });
  });

  it("disables markAllRead button and ignores duplicate rapid clicks to prevent race conditions", async () => {
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const markAllBtn = Array.from(container.querySelectorAll("#notification-popup button")).find(
      (btn) => btn.textContent?.trim() === "Mark all read"
    ) as HTMLButtonElement;
    assert.ok(markAllBtn);

    // Click mark all read rapidly twice
    fireEvent.click(markAllBtn);
    fireEvent.click(markAllBtn);

    // Only one fetch call should be recorded, and the button should be disabled
    assert.equal(markAllBtn.disabled, true);

    await waitFor(() => {
      const patchCalls = calls.filter((c) => c.method === "PATCH");
      assert.equal(patchCalls.length, 1);
    });
  });

  it("interlocks mark-all and mark-one close clicks to prevent cross-race condition", async () => {
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const markAllBtn = Array.from(container.querySelectorAll("#notification-popup button")).find(
      (btn) => btn.textContent?.trim() === "Mark all read"
    ) as HTMLButtonElement;
    assert.ok(markAllBtn);

    const closeButtons = container.querySelectorAll("#notification-popup button");
    const markReadBtn = Array.from(closeButtons).find(
      (btn) => btn.getAttribute("aria-label") === 'Mark "Tender Deadline Approaching" as read'
    ) as HTMLButtonElement;
    assert.ok(markReadBtn);

    // Scenario A: Mark all is pending, individual mark read is disabled and ignored
    fireEvent.click(markAllBtn);
    assert.equal(markReadBtn.disabled, true);
    fireEvent.click(markReadBtn);

    await waitFor(() => {
      // Should have only 1 mark-all read PATCH request, no individual read PATCH request
      const patchCalls = calls.filter((c) => c.method === "PATCH");
      assert.equal(patchCalls.length, 1);
      assert.equal((patchCalls[0].body as any)?.markAll, true);
    });
  });

  it("interlocks mark-one and mark-all clicks to prevent cross-race condition", async () => {
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const markAllBtn = Array.from(container.querySelectorAll("#notification-popup button")).find(
      (btn) => btn.textContent?.trim() === "Mark all read"
    ) as HTMLButtonElement;
    assert.ok(markAllBtn);

    const closeButtons = container.querySelectorAll("#notification-popup button");
    const markReadBtn = Array.from(closeButtons).find(
      (btn) => btn.getAttribute("aria-label") === 'Mark "Tender Deadline Approaching" as read'
    ) as HTMLButtonElement;
    assert.ok(markReadBtn);

    // Scenario B: Individual mark read is pending, mark all read is disabled and ignored
    fireEvent.click(markReadBtn);
    assert.equal(markAllBtn.disabled, true);
    fireEvent.click(markAllBtn);

    await waitFor(() => {
      // Should have only 1 individual read PATCH request, no mark-all read PATCH request
      const patchCalls = calls.filter((c) => c.method === "PATCH");
      assert.equal(patchCalls.length, 1);
      assert.deepEqual((patchCalls[0].body as any)?.ids, ["n1"]);
    });
  });

  it("prevents linked notification navigation and waits until server-confirmation success", async () => {
    // Spy on fakeRouter.push
    let pushedPath = "";
    (fakeRouter as any).push = (path: string) => {
      pushedPath = path;
    };

    // Mock successful re-fetch response upon PATCH resolution
    cleanup();
    let getCallCount = 0;
    const g = globalThis as any;
    g.fetch = async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method || "GET";
      calls.push({ url, method, body: init?.body });
      if (method === "PATCH") {
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      getCallCount++;
      return new Response(
        JSON.stringify({
          unreadCount: getCallCount > 1 ? 1 : 2,
          notifications: [
            {
              id: "n1",
              type: "TENDER_DEADLINE_SOON",
              title: "Tender Deadline Approaching",
              body: "The tender is closing soon.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t1",
              readAt: getCallCount > 1 ? new Date().toISOString() : null,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    calls = [];
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const links = container.querySelectorAll("#notification-popup a");
    const linkEl = Array.from(links).find((link) => link.textContent?.trim() === "Tender Deadline Approaching") as HTMLAnchorElement;
    assert.ok(linkEl);

    // Click the link - should block immediate navigation
    fireEvent.click(linkEl);
    assert.equal(pushedPath, ""); // No immediate navigation

    // Verify that PATCH request is dispatched
    await waitFor(() => {
      assert.ok(calls.some((c) => c.method === "PATCH"));
    });

    // Once the PATCH succeeds, unread count is decremented via re-fetch, popup closed, and router.push is executed
    await waitFor(() => {
      assert.equal(button.getAttribute("aria-label"), "Notifications (1 unread)");
      assert.equal(pushedPath, "/tenders/t1");
      assert.ok(!container.querySelector("#notification-popup")); // Popup closed
    });
  });

  it("keeps popup visible and shows error if linked notification markRead PATCH fails", async () => {
    // Redefine fetch mock so the GET returns 2 unread, and the PATCH fails
    cleanup();
    calls = installFetchMock([
      {
        match: "/api/notifications?limit=20",
        method: "GET",
        json: {
          unreadCount: 2,
          notifications: [
            {
              id: "n1",
              type: "TENDER_DEADLINE_SOON",
              title: "Tender Deadline Approaching",
              body: "The tender is closing soon.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t1",
              readAt: null,
            },
          ],
        },
      },
      {
        match: "/api/notifications",
        method: "PATCH",
        status: 500,
        json: { error: "Internal Server Error" },
      },
    ]);

    // Spy on fakeRouter.push
    let pushedPath = "";
    (fakeRouter as any).push = (path: string) => {
      pushedPath = path;
    };

    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const links = container.querySelectorAll("#notification-popup a");
    const linkEl = Array.from(links).find((link) => link.textContent?.trim() === "Tender Deadline Approaching") as HTMLAnchorElement;
    assert.ok(linkEl);

    // Click the link
    fireEvent.click(linkEl);

    // Verify that PATCH request is dispatched
    await waitFor(() => {
      assert.ok(calls.some((c) => c.method === "PATCH"));
    });

    // Wait a moment and assert that unread is unchanged, router.push is NOT executed,
    // the popup is still visible, and error alert is shown!
    await waitFor(() => {
      assert.equal(button.getAttribute("aria-label"), "Notifications (2 unread)");
      assert.equal(pushedPath, ""); // No navigation
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup); // Popup still visible
      const alertDiv = container.querySelector("[role='alert']");
      assert.ok(alertDiv); // Alert visible
      assert.match(alertDiv.textContent ?? "", /Failed to mark notification as read/);
    });
  });

  it("uses synchronous useRef mutex to prevent same-tick race between mark-all and mark-one close clicks", async () => {
    // Redefine fetch mock so PATCH is deferred
    cleanup();
    let resolvePatch: any;
    const patchPromise = new Promise((resolve) => {
      resolvePatch = resolve;
    });

    let getCallCount = 0;
    calls = [];
    const g = globalThis as any;
    g.fetch = async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method || "GET";
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      });
      if (method === "PATCH") {
        await patchPromise;
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      getCallCount++;
      return new Response(
        JSON.stringify({
          unreadCount: getCallCount > 1 ? 0 : 2,
          notifications: getCallCount > 1 ? [] : [
            {
              id: "n1",
              type: "TENDER_DEADLINE_SOON",
              title: "Tender Deadline Approaching",
              body: "The tender is closing soon.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t1",
              readAt: null,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);
    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const markAllBtn = Array.from(container.querySelectorAll("#notification-popup button")).find(
      (btn) => btn.textContent?.trim() === "Mark all read"
    ) as HTMLButtonElement;
    assert.ok(markAllBtn);

    const closeButtons = container.querySelectorAll("#notification-popup button");
    const markReadBtn = Array.from(closeButtons).find(
      (btn) => btn.getAttribute("aria-label") === 'Mark "Tender Deadline Approaching" as read'
    ) as HTMLButtonElement;
    assert.ok(markReadBtn);

    // Click BOTH in the SAME synchronous tick!
    fireEvent.click(markAllBtn);
    fireEvent.click(markReadBtn);

    // Wait and verify that only 1 PATCH fetch request was dispatched (markAllRead)
    const patchCalls = calls.filter((c) => c.method === "PATCH");
    assert.equal(patchCalls.length, 1);
    assert.equal((patchCalls[0].body as any)?.markAll, true);

    // Resolve deferred patch to finish clean and authoritatively load notifications
    resolvePatch();
    await waitFor(() => {
      assert.equal(button.getAttribute("aria-label"), "Notifications");
    });
  });

  it("uses synchronous useRef mutex to prevent same-tick race between mark-one and mark-all clicks", async () => {
    // Redefine fetch mock so PATCH is deferred
    cleanup();
    let resolvePatch: any;
    const patchPromise = new Promise((resolve) => {
      resolvePatch = resolve;
    });

    let getCallCount = 0;
    calls = [];
    const g = globalThis as any;
    g.fetch = async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method || "GET";
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      });
      if (method === "PATCH") {
        await patchPromise;
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      getCallCount++;
      return new Response(
        JSON.stringify({
          unreadCount: getCallCount > 1 ? 1 : 2,
          notifications: [
            {
              id: "n1",
              type: "TENDER_DEADLINE_SOON",
              title: "Tender Deadline Approaching",
              body: "The tender is closing soon.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t1",
              readAt: getCallCount > 1 ? new Date().toISOString() : null,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);
    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const markAllBtn = Array.from(container.querySelectorAll("#notification-popup button")).find(
      (btn) => btn.textContent?.trim() === "Mark all read"
    ) as HTMLButtonElement;
    assert.ok(markAllBtn);

    const closeButtons = container.querySelectorAll("#notification-popup button");
    const markReadBtn = Array.from(closeButtons).find(
      (btn) => btn.getAttribute("aria-label") === 'Mark "Tender Deadline Approaching" as read'
    ) as HTMLButtonElement;
    assert.ok(markReadBtn);

    // Click BOTH in the SAME synchronous tick - mark-one first!
    fireEvent.click(markReadBtn);
    fireEvent.click(markAllBtn);

    // Wait and verify that only 1 PATCH fetch request was dispatched (markRead)
    const patchCalls = calls.filter((c) => c.method === "PATCH");
    assert.equal(patchCalls.length, 1);
    assert.deepEqual((patchCalls[0].body as any)?.ids, ["n1"]);

    // Resolve deferred patch to finish clean
    resolvePatch();
    await waitFor(() => {
      assert.equal(button.getAttribute("aria-label"), "Notifications (1 unread)");
    });
  });

  it("blocks rendering of external, protocol-relative, and javascript: links to prevent open redirect and XSS", async () => {
    // Redefine fetch mock with unsafe links
    cleanup();
    calls = installFetchMock([
      {
        match: "/api/notifications?limit=20",
        method: "GET",
        json: {
          unreadCount: 7,
          notifications: [
            {
              id: "u1",
              type: "SYSTEM",
              title: "External Link",
              body: "Unsafe",
              createdAt: new Date().toISOString(),
              link: "https://evil.com/phish",
              readAt: null,
            },
            {
              id: "u2",
              type: "SYSTEM",
              title: "Protocol Relative",
              body: "Unsafe",
              createdAt: new Date().toISOString(),
              link: "//evil.com/phish",
              readAt: null,
            },
            {
              id: "u3",
              type: "SYSTEM",
              title: "XSS Javascript",
              body: "Unsafe",
              createdAt: new Date().toISOString(),
              link: "javascript:alert(1)",
              readAt: null,
            },
            {
              id: "u4",
              type: "SYSTEM",
              title: "Normalized Backslash Path",
              body: "Unsafe",
              createdAt: new Date().toISOString(),
              link: "/\\evil.example/path",
              readAt: null,
            },
            {
              id: "u5",
              type: "SYSTEM",
              title: "Encoded Backslash Path",
              body: "Unsafe",
              createdAt: new Date().toISOString(),
              link: "/%5C%5Cevil.example",
              readAt: null,
            },
            {
              id: "u6",
              type: "SYSTEM",
              title: "Encoded Slashes Path",
              body: "Unsafe",
              createdAt: new Date().toISOString(),
              link: "/%2F%2Fevil.example",
              readAt: null,
            },
            {
              id: "u7",
              type: "SYSTEM",
              title: "CR LF Injection Path",
              body: "Unsafe",
              createdAt: new Date().toISOString(),
              link: "/path\r\n/evil.example",
              readAt: null,
            },
          ],
        },
      },
      {
        match: "/api/notifications",
        method: "PATCH",
        json: { success: true },
      },
    ]);

    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 7 }));
    const button = container.querySelector("button");
    assert.ok(button);

    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const links = container.querySelectorAll("#notification-popup a");
    // All 7 unsafe links should be filtered out and not rendered as anchor <a> tags at all!
    assert.equal(links.length, 0);

    // Instead, they should be rendered as plain text elements
    const texts = container.querySelectorAll("#notification-popup p");
    assert.ok(Array.from(texts).some(p => p.textContent?.includes("External Link")));
    assert.ok(Array.from(texts).some(p => p.textContent?.includes("Protocol Relative")));
    assert.ok(Array.from(texts).some(p => p.textContent?.includes("XSS Javascript")));
    assert.ok(Array.from(texts).some(p => p.textContent?.includes("Normalized Backslash Path")));
    assert.ok(Array.from(texts).some(p => p.textContent?.includes("Encoded Backslash Path")));
    assert.ok(Array.from(texts).some(p => p.textContent?.includes("Encoded Slashes Path")));
    assert.ok(Array.from(texts).some(p => p.textContent?.includes("CR LF Injection Path")));
  });

  it("clicks on an already-read notification and navigates immediately without triggering a markRead PATCH request", async () => {
    // Redefine fetch mock so n1 is unread and n2 is already read (readAt is set)
    cleanup();
    calls = installFetchMock([
      {
        match: "/api/notifications?limit=20",
        method: "GET",
        json: {
          unreadCount: 1,
          notifications: [
            {
              id: "n1",
              type: "TENDER_DEADLINE_SOON",
              title: "Unread Notification",
              body: "Closing soon.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t1",
              readAt: null,
            },
            {
              id: "n2",
              type: "TENDER_GENERATED",
              title: "Already Read Notification",
              body: "Generated.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t2",
              readAt: new Date().toISOString(),
            },
          ],
        },
      },
      {
        match: "/api/notifications",
        method: "PATCH",
        json: { success: true },
      },
    ]);

    // Spy on fakeRouter.push
    let pushedPath = "";
    (fakeRouter as any).push = (path: string) => {
      pushedPath = path;
    };

    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 1 }));
    const button = container.querySelector("button");
    assert.ok(button);

    // Open popup
    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const links = container.querySelectorAll("#notification-popup a");
    const readLinkEl = Array.from(links).find((link) => link.textContent?.trim() === "Already Read Notification") as HTMLAnchorElement;
    assert.ok(readLinkEl);

    // Click the already-read link
    fireEvent.click(readLinkEl);

    // Should navigate immediately with router.push
    assert.equal(pushedPath, "/tenders/t2");

    // But should make ZERO PATCH requests!
    const patchCalls = calls.filter((c) => c.method === "PATCH");
    assert.equal(patchCalls.length, 0);

    // Unread count should remain exactly 1
    assert.equal(button.getAttribute("aria-label"), "Notifications (1 unread)");
  });

  it("linked notification: PATCH succeeds but refresh GET fails — no router navigation, popup remains open, and error is visible", async () => {
    // Redefine fetch mock so PATCH succeeds, but refresh GET fails with 500
    cleanup();
    let getCallCount = 0;
    const g = globalThis as any;
    g.fetch = async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method || "GET";
      calls.push({ url, method, body: init?.body });

      if (method === "PATCH") {
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
      }

      getCallCount++;
      if (getCallCount > 1) {
        // Refresh GET fails!
        return new Response(JSON.stringify({ error: "Server error during refresh" }), { status: 500, headers: { "content-type": "application/json" } });
      }

      return new Response(
        JSON.stringify({
          unreadCount: 2,
          notifications: [
            {
              id: "n1",
              type: "TENDER_DEADLINE_SOON",
              title: "Tender Deadline Approaching",
              body: "The tender is closing soon.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t1",
              readAt: null,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    // Spy on fakeRouter.push
    let pushedPath = "";
    (fakeRouter as any).push = (path: string) => {
      pushedPath = path;
    };

    calls = [];
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    // Open dropdown to trigger first GET
    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const links = container.querySelectorAll("#notification-popup a");
    const linkEl = Array.from(links).find((link) => link.textContent?.trim() === "Tender Deadline Approaching") as HTMLAnchorElement;
    assert.ok(linkEl);

    // Click the link
    fireEvent.click(linkEl);

    // Verify that PATCH request is dispatched
    await waitFor(() => {
      assert.ok(calls.some((c) => c.method === "PATCH"));
    });

    // Since refresh GET failed, there should be NO navigation, popup remains open, and the alert error is visible!
    await waitFor(() => {
      assert.equal(pushedPath, ""); // No navigation!
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup); // Popup still open!
      const alertDiv = container.querySelector("[role='alert']");
      assert.ok(alertDiv); // Alert visible!
      assert.match(alertDiv.textContent ?? "", /Failed to load notifications/);
    });
  });

  it("mark-all: PATCH succeeds but refresh GET fails — no false success and no locally fabricated unread count", async () => {
    // Redefine fetch mock so PATCH succeeds, but refresh GET fails with 500
    cleanup();
    let getCallCount = 0;
    const g = globalThis as any;
    g.fetch = async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method || "GET";
      calls.push({ url, method, body: init?.body });

      if (method === "PATCH") {
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
      }

      getCallCount++;
      if (getCallCount > 1) {
        // Refresh GET fails!
        return new Response(JSON.stringify({ error: "Server error during refresh" }), { status: 500, headers: { "content-type": "application/json" } });
      }

      return new Response(
        JSON.stringify({
          unreadCount: 2,
          notifications: [
            {
              id: "n1",
              type: "TENDER_DEADLINE_SOON",
              title: "Tender Deadline Approaching",
              body: "The tender is closing soon.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t1",
              readAt: null,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    calls = [];
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    // Open dropdown to trigger first GET
    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const markAllBtn = Array.from(container.querySelectorAll("#notification-popup button")).find(
      (btn) => btn.textContent?.trim() === "Mark all read"
    ) as HTMLButtonElement;
    assert.ok(markAllBtn);

    // Click mark all read
    fireEvent.click(markAllBtn);

    // Verify that PATCH request is dispatched
    await waitFor(() => {
      assert.ok(calls.some((c) => c.method === "PATCH"));
    });

    // Since refresh GET failed, unread count remains 2 (not fabricated to 0), and error alert is shown!
    await waitFor(() => {
      assert.equal(button.getAttribute("aria-label"), "Notifications (2 unread)");
      const alertDiv = container.querySelector("[role='alert']");
      assert.ok(alertDiv);
      assert.match(alertDiv.textContent ?? "", /Failed to load notifications/);
    });
  });

  it("retrying after a failed refresh succeeds and synchronizes authoritative state", async () => {
    cleanup();
    let getCallCount = 0;
    let shouldFailRefresh = true;
    const g = globalThis as any;
    g.fetch = async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method || "GET";
      calls.push({ url, method, body: init?.body });

      if (method === "PATCH") {
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
      }

      getCallCount++;
      if (getCallCount > 1 && shouldFailRefresh) {
        // Refresh GET fails on the first retry!
        return new Response(JSON.stringify({ error: "Server error during refresh" }), { status: 500, headers: { "content-type": "application/json" } });
      }

      return new Response(
        JSON.stringify({
          unreadCount: getCallCount > 2 ? 1 : 2,
          notifications: [
            {
              id: "n1",
              type: "TENDER_DEADLINE_SOON",
              title: "Tender Deadline Approaching",
              body: "The tender is closing soon.",
              createdAt: new Date().toISOString(),
              link: "/tenders/t1",
              readAt: getCallCount > 2 ? new Date().toISOString() : null,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    calls = [];
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    // Open dropdown to trigger first GET
    fireEvent.click(button);

    await waitFor(() => {
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup);
    });

    const closeButtons = container.querySelectorAll("#notification-popup button");
    const markReadBtn = Array.from(closeButtons).find(
      (btn) => btn.getAttribute("aria-label") === 'Mark "Tender Deadline Approaching" as read'
    ) as HTMLButtonElement;
    assert.ok(markReadBtn);

    // Click mark read (First attempt - refresh fails)
    fireEvent.click(markReadBtn);

    await waitFor(() => {
      assert.equal(button.getAttribute("aria-label"), "Notifications (2 unread)");
      const alertDiv = container.querySelector("[role='alert']");
      assert.ok(alertDiv);
      assert.match(alertDiv.textContent ?? "", /Failed to load notifications/);
    });

    // Configure refresh to succeed now
    shouldFailRefresh = false;

    // Trigger a second markRead on retry
    fireEvent.click(markReadBtn);

    // Verify it succeeded on retry, clears error alert, and synchronizes unread count to 1
    await waitFor(() => {
      assert.equal(button.getAttribute("aria-label"), "Notifications (1 unread)");
      const alertDiv = container.querySelector("[role='alert']");
      assert.ok(!alertDiv); // Alert cleared!
    });
  });
});
