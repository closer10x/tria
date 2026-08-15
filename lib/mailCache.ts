import { Email } from "./types";

/**
 * Local mail cache: the last known mailbox snapshot, persisted in
 * localStorage so the Mail pane paints instantly on reload and still shows
 * mail when the network (or the IMAP server) is unreachable. The live fetch
 * replaces it as soon as it lands.
 */

const KEY = "tria-mail-cache-v1";
/** Newest-first cap — keeps the JSON far under localStorage quotas. */
const MAX_EMAILS = 300;
/** Only the most recent messages keep their opened bodies. */
const MAX_BODIES = 60;

export function loadMailCache(): Email[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { emails?: Email[] };
    return Array.isArray(parsed.emails) && parsed.emails.length
      ? parsed.emails
      : null;
  } catch {
    return null;
  }
}

export function saveMailCache(emails: Email[]) {
  try {
    const slim = emails
      .slice(0, MAX_EMAILS)
      .map((e, i) => (i < MAX_BODIES ? e : { ...e, body: [] }));
    localStorage.setItem(KEY, JSON.stringify({ emails: slim, at: Date.now() }));
  } catch {
    // quota exceeded or storage unavailable — drop the cache rather than crash
    try {
      localStorage.removeItem(KEY);
    } catch {}
  }
}

export function clearMailCache() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
