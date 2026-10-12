# Upload-only automation goal

The intended owner workflow is:

1. Upload all Company Vault documents and brand assets.
2. Upload tender source files.
3. The app verifies bytes, extracts text, classifies dedicated sources, builds source-grounded company records, auto-verifies only evidence bound to current verified bytes, analyzes the tender, runs the Engine after canonical AI success, and prepares downstream work without asking the owner to review or manually link evidence.

The app must stop only for a genuine fail-closed blocker such as missing source bytes, failed extraction, partial/fallback analysis, unsupported file format, missing official original, or failed integrity/authorization gate. It must never invent evidence or silently weaken final ZIP gates.
