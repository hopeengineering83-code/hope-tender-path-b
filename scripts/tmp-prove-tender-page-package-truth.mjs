// Preview acceptance: the tender page must state the package truth the strict
// export gate states.
//
// Opens the real tender page as the signed-in owner, reads the Next Required
// Action header (#workflow-state) and the Release Status panel
// (#generated-documents), screenshots both, and fails when either panel
// contradicts /export-readiness:
//
//   PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED → "Proposal complete — attach
//     originals manually" and a proposal-package download; never "The final
//     ZIP package is ready" / "Download Final ZIP".
//   SUBMISSION_READY → "Ready to download" and "Download Final ZIP".
//
// It also checks that the readiness number on the page is the one /export
// reports. The screenshots are written to /tmp/page-proof/ and printed as
// base64 between markers so the log alone carries the visual evidence.
//
// Env: BASE_URL, TENDER_ID, SESSION_COOKIE. Argument: path to the
// export-readiness JSON fetched earlier in the job.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const { BASE_URL, TENDER_ID, SESSION_COOKIE } = process.env;
if (!BASE_URL || !TENDER_ID || !SESSION_COOKIE) throw new Error("BASE_URL, TENDER_ID and SESSION_COOKIE are required");
const readiness = JSON.parse(readFileSync(process.argv[2], "utf8"));
const packageStatus = readiness.packageStatus;
const strictScore = readiness?.exportReadiness?.summary?.readinessScore ?? readiness?.summary?.readinessScore ?? null;

mkdirSync("/tmp/page-proof", { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await context.addCookies([{ name: "hope_session", value: SESSION_COOKIE, domain: new URL(BASE_URL).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
const page = await context.newPage();
const response = await page.goto(`${BASE_URL}/dashboard/tenders/${TENDER_ID}`, { waitUntil: "networkidle", timeout: 120_000 });
console.log(`tender page HTTP ${response?.status()}`);

const header = page.locator("#workflow-state");
const release = page.locator("#generated-documents");
await header.waitFor({ timeout: 60_000 });
await release.waitFor({ timeout: 60_000 });
const headerText = (await header.innerText()).replace(/\s+/g, " ").trim();
const releaseText = (await release.innerText()).replace(/\s+/g, " ").trim();
const releaseLinks = await release.locator("a").evaluateAll((links) => links.map((a) => ({ text: a.textContent?.trim(), href: a.getAttribute("href") })));

for (const [name, locator] of [["next-required-action", header], ["release-status", release]]) {
  const file = `/tmp/page-proof/${name}.jpg`;
  await locator.screenshot({ path: file, type: "jpeg", quality: 70 });
  const b64 = readFileSync(file).toString("base64");
  console.log(`=== SCREENSHOT ${name} (${b64.length} base64 chars) BEGIN ===`);
  for (let i = 0; i < b64.length; i += 4000) console.log(b64.slice(i, i + 4000));
  console.log(`=== SCREENSHOT ${name} END ===`);
}
await page.screenshot({ path: "/tmp/page-proof/tender-page.jpg", type: "jpeg", quality: 60, fullPage: true });
await browser.close();

console.log(`export-readiness packageStatus: ${packageStatus} (strict readinessScore ${strictScore})`);
console.log(`NEXT REQUIRED ACTION panel: ${headerText.slice(0, 900)}`);
console.log(`RELEASE STATUS panel: ${releaseText.slice(0, 900)}`);
console.log(`RELEASE STATUS downloads: ${JSON.stringify(releaseLinks)}`);
writeFileSync("/tmp/page-proof/panels.json", JSON.stringify({ packageStatus, strictScore, headerText, releaseText, releaseLinks }, null, 2));

const problems = [];
const FINAL_ZIP = /final ZIP package is ready|Download Final ZIP/i;
if (packageStatus === "PROPOSAL_COMPLETE_OWNER_ATTACHMENTS_REQUIRED") {
  if (FINAL_ZIP.test(releaseText) || FINAL_ZIP.test(headerText)) problems.push("a panel claims the final ZIP is ready while owner originals remain");
  if (!releaseText.includes("Proposal complete — attach originals manually")) problems.push("Release Status does not say the proposal is complete");
  if (!headerText.includes("Proposal complete — attach originals manually")) problems.push("Next Required Action does not say the proposal is complete");
  if (!releaseLinks.some((l) => /Download Proposal Package/.test(l.text ?? "") && /scope=proposal/.test(l.href ?? ""))) problems.push("no proposal-package download is offered");
} else if (packageStatus === "SUBMISSION_READY") {
  if (!/Ready to download/.test(releaseText) || !releaseLinks.some((l) => /Download Final ZIP/.test(l.text ?? ""))) problems.push("the final ZIP is ready but Release Status does not offer it");
} else if (FINAL_ZIP.test(releaseText)) {
  problems.push(`a panel claims the final ZIP is ready while export-readiness says ${packageStatus}`);
}
// One readiness number: the page's "Submission readiness" is the strict score.
const shown = /Submission readiness\s+(\d+)\s*\/\s*100/.exec(headerText)?.[1];
if (/Readiness score/i.test(headerText)) problems.push('the header still shows an unlabelled "Readiness score"');
if (shown != null && strictScore != null && Number(shown) !== Number(strictScore)) problems.push(`Submission readiness on the page (${shown}) differs from /export-readiness (${strictScore})`);
console.log(`page Submission readiness: ${shown ?? "not shown"}; bid fit: ${/Bid fit score\s+(\d+)/.exec(headerText)?.[1] ?? "not shown"}`);

if (problems.length > 0) {
  console.error(`Tender page contradicts the export gate: ${problems.join(" | ")}`);
  process.exit(1);
}
console.log("Tender page agrees with the export gate: package semantics and readiness score match.");
