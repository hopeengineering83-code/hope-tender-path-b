// What the share panel may show for each share link.
//
// New shares persist only the token's hash (token: null); the raw token is
// returned once, by the POST that creates the share. The panel used to build
// every row's URL from `share.token`, so a new share appeared as "/share/null"
// and, after a reload, that dead address was the only link left on screen.
// Revoking compared the one-time URL with that null token, so the URL of a
// just-revoked share stayed on screen to be copied.

export type ShareListEntry = {
  id: string;
  token: string | null;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt?: string | null;
};

/** The one-time URL of a share created in this session, tied to its id. */
export type CreatedShare = { id: string; url: string };

/** Shares still usable: a revoked share is not an active link. */
export function activeShares<T extends ShareListEntry>(shares: readonly T[]): T[] {
  return shares.filter((share) => !share.revokedAt);
}

/**
 * The URL to show for a share, or null when none can be shown: a legacy share
 * still has its plaintext token; a share created in this session has its
 * one-time URL; any other hash-only share has no recoverable URL at all.
 */
export function shareLinkFor(share: ShareListEntry, created: CreatedShare | null, origin: string): string | null {
  if (share.token) return `${origin}/share/${share.token}`;
  if (created && created.id === share.id) return created.url;
  return null;
}

/** The one-time URL to keep after a revoke: gone when it was that share's. */
export function createdShareAfterRevoke(created: CreatedShare | null, revokedId: string): CreatedShare | null {
  return created && created.id === revokedId ? null : created;
}
