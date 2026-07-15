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
              readAt: null,
            },
            {
              id: "n2",
              type: "TENDER_GENERATED",
              title: "Tender Proposal Generated",
              body: "Document is ready.",
              createdAt: new Date().toISOString(),
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
              readAt: null,
            },
            {
              id: "n2",
              type: "TENDER_GENERATED",
              title: "Tender Proposal Generated",
              body: "Document is ready.",
              createdAt: new Date().toISOString(),
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
});
