export function finalizeClientFacingLanguage(markdown: string): string {
  return markdown
    .replace(/Bid-team confirmation:\s*/gi, "Evidence note: ")
    .replace(/bid-team confirmation item(s)?/gi, "source-evidence confirmation item$1")
    .replace(/bid-team-confirmed/gi, "source-confirmed")
    .replace(/bid-team verification/gi, "final verification")
    .replace(/bid team/gi, "proposal team")
    .replace(/Bid team/gi, "Proposal team")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
