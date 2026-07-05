# Production Visible-Update QA Checklist

Use this checklist after any production deployment to confirm the latest
code is live and visible in the browser.

---

## Step 1 — Open the production URL

Open: https://hope-tender-path-b.vercel.app

If you have a custom domain, use that instead.

---

## Step 2 — Hard refresh to bypass browser cache

- **Chrome / Edge:** Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
- **Firefox:** Ctrl+Shift+R or Cmd+Shift+R
- **Safari:** Cmd+Option+R
- **Mobile:** Close all browser tabs, reopen

---

## Step 3 — Check the build marker in the sidebar

In the bottom-left of the dashboard sidebar you should see:

```
production build <short-sha> ▼
```

Click the marker to expand it and check:
- **Commit** matches the latest main commit (check GitHub → main branch)
- **Environment** shows `production`
- **Built** timestamp is recent (within minutes of the deploy)
- **Server SHA** matches the client SHA — shows `✓ in sync`
- **Feature flags** show: metadataOverride ✓, collapsiblePanels ✓, authorityReview ✓

If you see a yellow **"browser may be showing a cached version"** banner:
→ Hard refresh again or clear all browser cache/cookies for this domain.

---

## Step 4 — Hit /api/version directly

Open in a new tab: https://hope-tender-path-b.vercel.app/api/version

Expected response:
```json
{
  "ok": true,
  "appName": "Hope Tender",
  "environment": "production",
  "gitCommitSha": "<8-char sha matching latest main>",
  "buildTime": "<ISO timestamp>",
  "featureFlags": {
    "metadataOverride": true,
    "collapsiblePanels": true,
    "authorityReview": true,
    "submissionPlanRepair": true
  }
}
```

Compare `gitCommitSha` with the latest commit on GitHub main branch.
They must match for all code changes to be live.

---

## Step 5 — Compare with latest main on GitHub

1. Go to: https://github.com/hopeengineering83-code/hope-tender-path-b/commits/main
2. Note the first 8 characters of the latest commit SHA
3. Confirm it matches `gitCommitSha` from `/api/version`

If they don't match: Vercel has not yet deployed, or the deployment failed.
Check Vercel dashboard → Deployments for build errors.

---

## Step 6 — Open a tender detail page

Navigate to any tender. Verify the following:

### 6a — Expand all / Collapse all controls
Immediately below the "Canonical Readiness Score" widget, you should see:
```
                              Expand all | Collapse all
```
These are small text buttons on the right side. Confirm they exist.

### 6b — Collapsible panels (10 total)
You should see collapsible strips (chevron buttons) for all major sections:

**Diagnostic panels (above the workspace):**
- **Metadata Completion** — open by default
- **Submission Plan** — open by default
- **Requirement Coverage** — open by default
- **Tender Controls** — closed by default
- **Score Breakdown** — closed by default

**Workspace panels (below the diagnostic panels):**
- **Tender workspace** — open by default
- **Tender files** — closed by default
- **Expert Matches** — closed by default (only shown when matches exist)
- **Project Matches** — closed by default (only shown when matches exist)
- **Generated outputs** — open by default

Click each strip to expand/collapse. The chevron should rotate. "Expand all" / "Collapse all" controls all 10 panels.

### 6c — Metadata Completion panel
Expand the "Metadata Completion" panel. It should show either:
- Green: "All critical metadata is present or confirmed."
- Or: A list of missing fields with Fill / Mark N/A / Ignore buttons

### 6d — Panel state is remembered per tender
Collapse two panels. Navigate away (go to Tenders list). Come back to the
same tender. The two panels should still be collapsed.
Navigate to a *different* tender — it should use its own independent state.

### 6e — Critical blockers stay visible
If a panel contains a red CRITICAL blocker (e.g., missing client name),
expanding the panel shows the red section. Collapsing hides it. This is
expected — the TenderRecoveryCommandCenter at the top always shows the
primary next action regardless of panel state.

---

### 6f — Verify /api/tenders/[id] returns 200

Open your browser dev tools → Network tab. Click any tender. Filter for
`/api/tenders/` requests. Confirm status is **200**, not 500.

If you see 500: the Prisma select fields in `app/api/tenders/[id]/route.ts`
may have invalid field names. Fixed in PR #628 — confirm that commit is deployed.

---

## Step 7 — Click Re-check (if needed)

On the Submission Plan panel, click **Refresh** to reload the plan status.
Confirm the panel title shows the current plan state.

---

## Step 8 — Run the OCR/Re-extract only if needed

Do NOT click "Re-extract from PDF" or "Run OCR" unless a tender's
extraction quality is flagged as poor. These are heavy operations.

---

## Step 9 — Click Build Plan only if needed

Do NOT rebuild the submission plan unless the plan state shows
"Plan not built" or "Derived draft unconfirmed." Building the plan
overwrites PLANNED rows.

---

## PWA / service worker cache clear

If the app appears stale even after hard refresh:

**Chrome:**
1. Open DevTools → Application → Storage
2. Click "Clear site data"
3. Or: Settings → Privacy → Clear browsing data → Cached images and files

**Safari (iOS):**
1. Settings → Safari → Clear History and Website Data

**All browsers:**
- The build marker badge in the sidebar shows `⚠ browser may be showing a cached version` with a "Hard refresh" button when client and server SHAs differ — use that first.

---

## Vercel deployment status check

1. Go to: https://vercel.com/hopeengineering83-codes-projects/hope-tender-path-b/deployments
2. The top entry should be "Production" on branch `main`
3. Status should be "Ready"
4. The commit message should match the latest commit on GitHub main
5. If status is "Building" — wait 2–3 minutes and reload
6. If status is "Error" — check build logs for the failure reason
