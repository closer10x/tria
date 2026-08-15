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

export type MailCache = {
  emails: Email[];
  /**
   * Which accounts this snapshot came from. Reloading with no network can't
   * ask the server, and without this the app comes back up in demo mode —
   * so anything the user then does to their mail is dropped instead of
   * queued for the reconnect.
   */
  accounts: string[];
};

export function loadMailCache(): MailCache | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MailCache>;
    if (!Array.isArray(parsed.emails) || parsed.emails.length === 0) return null;
    return {
      emails: parsed.emails,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
  } catch {
    return null;
  }
}

export function saveMailCache(emails: Email[], accounts: string[]) {
  try {
    const slim = emails
      .slice(0, MAX_EMAILS)
      .map((e, i) => (i < MAX_BODIES ? e : { ...e, body: [] }));
    localStorage.setItem(
      KEY,
      JSON.stringify({ emails: slim, accounts, at: Date.now() })
    );
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
