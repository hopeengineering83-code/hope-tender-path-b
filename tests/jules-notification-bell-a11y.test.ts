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
  type FetchCall,
} from "./helpers/rtl-env";
import { NotificationBell } from "../app/components/notification-bell";

const h = React.createElement;

let calls: FetchCall[];

describe("NotificationBell Accessibility and Non-Optimistic Behavior", () => {
  beforeEach(() => {
    // Reset window location href to initial
    globalThis.window.location.href = "http://localhost/dashboard/tenders/test-tender";

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

  it("provides specific meaningful accessible label for '✕' button on unread notification", async () => {
    const { container } = renderWithRouter(h(NotificationBell, { initialUnread: 2 }));
    const button = container.querySelector("button");
    assert.ok(button);

    fireEvent.click(button);

    await waitFor(() => {
      const closeButtons = container.querySelectorAll("#notification-popup button");
      // Find the cross buttons (there should be '✕' close buttons with a specific aria-label)
      const markReadBtn1 = Array.from(closeButtons).find(
        (btn) => btn.getAttribute("aria-label") === 'Mark "Tender Deadline Approaching" as read'
      );
      const markReadBtn2 = Array.from(closeButtons).find(
        (btn) => btn.getAttribute("aria-label") === 'Mark "Tender Proposal Generated" as read'
      );
      assert.ok(markReadBtn1);
      assert.ok(markReadBtn2);
      assert.equal(markReadBtn1.textContent?.trim(), "✕");
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

    // Since PATCH succeeded (200), the unread count should be decremented.
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
    assert.equal(globalThis.window.location.href, "http://localhost/dashboard/tenders/test-tender"); // No immediate navigation

    // Verify that PATCH request is dispatched
    await waitFor(() => {
      assert.ok(calls.some((c) => c.method === "PATCH"));
    });

    // Once the PATCH succeeds, unread count is decremented, popup closed, and window.location.href updated
    await waitFor(() => {
      assert.equal(button.getAttribute("aria-label"), "Notifications (1 unread)");
      assert.ok(globalThis.window.location.href.includes("/tenders/t1"));
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

    // Wait a moment and assert that unread is unchanged, location.href is unchanged,
    // the popup is still visible, and error alert is shown!
    await waitFor(() => {
      assert.equal(button.getAttribute("aria-label"), "Notifications (2 unread)");
      assert.equal(globalThis.window.location.href, "http://localhost/dashboard/tenders/test-tender"); // No navigation
      const popup = container.querySelector("#notification-popup");
      assert.ok(popup); // Popup still visible
      const alertDiv = container.querySelector("[role='alert']");
      assert.ok(alertDiv); // Alert visible
      assert.match(alertDiv.textContent ?? "", /Failed to mark notification as read/);
    });
  });
});
