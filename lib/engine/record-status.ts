// Whether a company record's stored status means the firm holds it now.
//
// The status is a filter, not client text. Run 36074770709 printed it as a
// tag — "Business Licence (licence) — Ministry of Trade [ACTIVE]" in A.3 and
// an "ACTIVE" column in D.3. A record that is listed is, by being listed,
// held; a record whose status says otherwise (expired, pending, revoked,
// superseded) is not claimed at all.

/** A record status that means the firm holds it now, or no status recorded. */
export function isCurrentRecordStatus(status: string | null | undefined): boolean {
  const value = (status ?? "").trim();
  return !value || /^(?:active|valid|current|verified|in\s+force)$/i.test(value);
}
