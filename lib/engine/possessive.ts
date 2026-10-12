// The possessive of a name, as English writes it.
//
// Builders appended "'s" to whatever name they held, so a client whose name
// ends in "s" read "Pharo Ventures's engagement" in a delivered proposal. A
// name ending in "s" takes the apostrophe alone ("Ventures'"); every other
// name takes "'s".
export function possessive(name: string): string {
  const trimmed = name.trim();
  return /s$/i.test(trimmed) ? `${trimmed}'` : `${trimmed}'s`;
}
