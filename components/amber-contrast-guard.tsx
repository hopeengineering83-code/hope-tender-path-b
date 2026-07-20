/**
 * Global compatibility guard for legacy amber status text.
 *
 * Focused donor branches may still contain `text-amber-700` while carrying
 * newer application behavior that must not be overwritten by a blanket file
 * replacement. This guard preserves those newer files and enforces the same
 * WCAG-oriented amber-800 foreground used by the direct source updates.
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
