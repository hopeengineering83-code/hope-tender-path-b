import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("shared shell contains page overflow and keeps 1024px on the drawer layout", () => {
  const layout = source("app/dashboard/layout.tsx");
  assert.match(layout, /xl:flex/);
  assert.match(layout, /xl:hidden/);
  assert.match(layout, /overflow-x-hidden/);
  assert.match(layout, /overflow-x:\s*auto/);
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
