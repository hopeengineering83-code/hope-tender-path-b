/**
 * Global compatibility guard for legacy amber status text.
 *
 * Some historical donor heads contain stale unrelated source even though their
 * intended change is only a color-token replacement. This guard preserves the
 * current application tree and enforces the WCAG-oriented amber-800 foreground
 * for every residual `text-amber-700` utility without copying stale files.
 */
export function AmberContrastGuard() {
  return (
    <style data-amber-contrast-guard>{`
      .text-amber-700 {
        color: #92400e !important;
      }
    `}</style>
  );
}
