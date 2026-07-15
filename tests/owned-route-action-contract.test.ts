import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("shared shell keeps 1024px on the drawer layout without hiding page overflow", () => {
  const layout = source("app/dashboard/layout.tsx");
  assert.match(layout, /xl:flex/);
  assert.match(layout, /xl:hidden/);
  assert.match(layout, /<main id="main-content" className="min-w-0 flex-1"/);
  assert.doesNotMatch(layout, /#main-content\s+:where\(table\)/);
  assert.doesNotMatch(layout, /<main[^>]*overflow-x-(?:hidden|clip)/);
  assert.doesNotMatch(layout, /max-w-7xl[^\n"]*overflow-x-(?:hidden|clip)/);
});

test("owned responsive components contain only their own wide content", () => {
  const calendar = source("app/dashboard/calendar/calendar-client.tsx");
  const users = source("app/dashboard/users/page.tsx");
  const setup = source("app/dashboard/setup/page.tsx");
  const analytics = source("app/dashboard/analytics/layout.tsx");
  assert.match(calendar, /max-w-full overflow-x-auto/);
  assert.match(users, /max-w-full overflow-x-auto/);
  assert.match(setup, /overflow-x-auto/);
  assert.doesNotMatch(analytics, /overflow-x-(?:hidden|clip)/);
});

test("assets and users do not use silent or browser-alert success paths", () => {
  const assets = source("app/dashboard/assets/page.tsx");
  const users = source("app/dashboard/users/page.tsx");
  assert.doesNotMatch(assets, /\balert\s*\(/);
  assert.match(assets, /role="alert"/);
  assert.match(assets, /await load\(\)/);
  assert.match(users, /role="alert"/);
  assert.match(users, /await load\(\)/);
  assert.match(users, /md:hidden/);
});

test("setup begins from server company truth and does not inject a project currency", () => {
  const setup = source("app/dashboard/setup/page.tsx");
  assert.match(setup, /fetch\("\/api\/company", \{ cache: "no-store" \}\)/);
  assert.match(setup, /await loadCompany\(\)/);
  assert.match(setup, /currency:\s*""/);
  assert.match(setup, /No verified currency/);
});

test("search has URL query state, cancellation, and accessible failures", () => {
  const search = source("app/dashboard/search/page.tsx");
  assert.match(search, /AbortController/);
  assert.match(search, /nextParams\.set\("q"/);
  assert.match(search, /role="alert"/);
  assert.match(search, /getByRole|global-search|Search tenders, experts, and projects/);
});

test("calendar owns its horizontal overflow and touch navigation", () => {
  const calendar = source("app/dashboard/calendar/calendar-client.tsx");
  assert.match(calendar, /overflow-x-auto/);
  assert.match(calendar, /min-w-\[700px\]/);
  assert.match(calendar, /aria-label="Previous month"/);
  assert.match(calendar, /aria-label="Next month"/);
});

test("runtime browser contract covers routes, failures, and refreshes", () => {
  const responsive = source("e2e/tablet-universal-tender-intelligence.spec.ts");
  const anonymous = source("e2e/anonymous/anonymous-access.spec.ts");
  assert.match(responsive, /every rendered navigation route resolves/);
  assert.match(responsive, /expectMainDoesNotHideOverflow/);
  assert.match(responsive, /simulated settings failure/);
  assert.match(responsive, /simulated asset upload failure/);
  assert.match(responsive, /simulated profile failure/);
  assert.match(responsive, /simulated user failure/);
  assert.match(responsive, /simulated search failure/);
  assert.match(anonymous, /unauthenticated admin routes never expose admin UI/);
});
