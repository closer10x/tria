import { ImapFlow } from "imapflow";
import { MailConfig } from "./store";

export type Role =
  | "inbox"
  | "snoozed"
  | "drafts"
  | "sent"
  | "archive"
  | "trash";

const HUES = [
  "bg-rose-100 text-rose-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-indigo-100 text-indigo-700",
];

export async function makeClient(cfg: MailConfig) {
  // token-backed accounts get a freshly refreshed access token per connection
  const auth = cfg.oauthAccountId
    ? {
        user: cfg.user,
        accessToken: await (
          await import("@/lib/server/oauth")
        ).getAccessToken(cfg.oauthAccountId),
      }
    : { user: cfg.user, pass: cfg.pass };
  return new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort,
    secure: true,
    auth,
    logger: false,
  });
}

export async function withImap<T>(
  cfg: MailConfig,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T> {
  const client = await makeClient(cfg);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

const ROLES: Role[] = ["inbox", "snoozed", "drafts", "sent", "archive", "trash"];

/** Guards request params before they reach a mailbox lookup. */
export function isRole(v: string | null | undefined): v is Role {
  return !!v && (ROLES as string[]).includes(v);
}

/**
 * Map a role to a real mailbox path, or null when this account has no such
 * mailbox.
 *
 * Callers MUST handle null. Returning "INBOX" as a fallback (the old
 * behaviour) made a snooze or trash on a server without that folder move the
 * message from INBOX to INBOX and report success — the mail silently never
 * moved. `create` opts into making the Tria/Snoozed folder, so read paths
 * don't mutate the user's mailbox as a side effect of listing.
 */
export async function resolveRole(
  client: ImapFlow,
  role: Role,
  opts: { create?: boolean } = {}
): Promise<string | null> {
  if (role === "inbox") return "INBOX";
  const list = await client.list();
  const bySpecial = (flag: string) =>
    list.find((m) => m.specialUse === flag)?.path;
  if (role === "drafts")
    return (
      bySpecial("\\Drafts") ?? list.find((m) => /draft/i.test(m.path))?.path ?? null
    );
  if (role === "sent")
    return bySpecial("\\Sent") ?? list.find((m) => /sent/i.test(m.path))?.path ?? null;
  if (role === "trash")
    return bySpecial("\\Trash") ?? list.find((m) => /trash|deleted/i.test(m.path))?.path ?? null;
  if (role === "archive")
    return (
      bySpecial("\\Archive") ??
      bySpecial("\\All") ??
      list.find((m) => /all mail|archive/i.test(m.path))?.path ??
      null
    );
  // snoozed — a Tria-managed folder
  const existing = list.find((m) => /^Tria[/.]Snoozed$/.test(m.path));
  if (existing) return existing.path;
  if (!opts.create) return null;
  try {
    await client.mailboxCreate("Tria/Snoozed");
    return "Tria/Snoozed";
  } catch {
    return null;
  }
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function hueOf(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return HUES[h % HUES.length];
}

/** Calendar day as seen in `tz` — "2026-08-15". en-CA gives ISO ordering. */
const dayIn = (d: Date, tz?: string) =>
  d.toLocaleDateString("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

export function formatTime(d: Date | undefined, tz?: string): string {
  if (!d) return "";
  const opts: Intl.DateTimeFormatOptions = { timeZone: tz };
  // "Is this today?" has to be asked in the reader's timezone. Comparing
  // toDateString() asked it in the server's — UTC in production — so for the
  // hours either side of local midnight a message from today was labelled
  // with a date, or yesterday's was labelled with a time.
  const sameDay = dayIn(d, tz) === dayIn(new Date(), tz);
  if (sameDay)
    return d.toLocaleTimeString([], {
      ...opts,
      hour: "numeric",
      minute: "2-digit",
    });
  return d.toLocaleDateString([], { ...opts, month: "short", day: "numeric" });
}

type AttachmentInfo = {
  name: string;
  size?: string;
  part?: string;
  contentType?: string;
};

function walkAttachments(node: unknown, out: AttachmentInfo[]) {
  if (!node || typeof node !== "object") return;
  const n = node as {
    disposition?: string;
    dispositionParameters?: { filename?: string };
    parameters?: { name?: string };
    size?: number;
    part?: string;
    type?: string;
    childNodes?: unknown[];
  };
  const filename = n.dispositionParameters?.filename ?? n.parameters?.name;
  if (n.disposition === "attachment" && filename) {
    out.push({
      name: filename,
      size: n.size ? `${Math.max(1, Math.round(n.size / 1024))} KB` : undefined,
      // the part id is what lets the client fetch this file back
      part: n.part,
      contentType: n.type,
    });
  }
  n.childNodes?.forEach((c) => walkAttachments(c, out));
}

export type WireEmail = {
  id: string;
  uid: number;
  folder: Role;
  accountId: string; // email address of the account this message belongs to
  sortDate?: number; // epoch ms, for merging accounts into one timeline
  from: { name: string; email: string; initials: string; hue: string };
  to?: string;
  toAll?: string[];
  cc?: string[];
  subject: string;
  preview: string;
  body: string[];
  time: string;
  read: boolean;
  starred: boolean;
  attachments?: AttachmentInfo[];
  /** search only: what matched — subject/from hits rank above body-only hits */
  match?: "header" | "body";
};

const FETCH_FIELDS = {
  envelope: true,
  flags: true,
  uid: true,
  internalDate: true,
  bodyStructure: true,
} as const;

/** One fetched IMAP message → the wire shape the client renders. */
function toWireEmail(
  msg: {
    uid: number;
    envelope?: {
      from?: { name?: string; address?: string }[];
      to?: { address?: string }[];
      cc?: { address?: string }[];
      subject?: string;
    };
    flags?: Set<string>;
    internalDate?: Date | string;
    bodyStructure?: unknown;
  },
  cfg: MailConfig,
  role: Role,
  tz?: string
): WireEmail {
  const env = msg.envelope;
  const fromAddr = env?.from?.[0];
  const name = fromAddr?.name || fromAddr?.address || "Unknown";
  const attachments: AttachmentInfo[] = [];
  walkAttachments(msg.bodyStructure, attachments);
  return {
    id: `live-${cfg.user}-${msg.uid}-${role}`,
    uid: msg.uid,
    folder: role,
    accountId: cfg.user,
    sortDate: msg.internalDate ? new Date(msg.internalDate).getTime() : undefined,
    from: {
      name,
      email: fromAddr?.address ?? "",
      initials: initialsOf(name),
      hue: hueOf(fromAddr?.address ?? name),
    },
    to: env?.to?.[0]?.address,
    toAll: env?.to?.map((a) => a.address).filter((a): a is string => Boolean(a)),
    cc: env?.cc?.map((a) => a.address).filter((a): a is string => Boolean(a)),
    subject: env?.subject ?? "(no subject)",
    preview: "",
    body: [],
    time: formatTime(msg.internalDate ? new Date(msg.internalDate) : undefined, tz),
    read: msg.flags?.has("\\Seen") ?? false,
    starred: msg.flags?.has("\\Flagged") ?? false,
    attachments: attachments.length ? attachments : undefined,
  };
}

export async function listMessages(
  cfg: MailConfig,
  role: Role,
  tz?: string,
  limit = 30,
  /** how many newer messages to skip — paging back through the mailbox */
  offset = 0
): Promise<WireEmail[]> {
  return withImap(cfg, async (client) => {
    const path = await resolveRole(client, role);
    // no such folder on this account (e.g. nothing snoozed yet) — an empty
    // list is the honest answer; don't read INBOX and label it otherwise
    if (!path) return [];
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      const mailbox = client.mailbox;
      const exists = mailbox && typeof mailbox === "object" ? mailbox.exists : 0;
      if (!exists) return [];
      const end = exists - offset;
      if (end < 1) return [];
      const start = Math.max(1, end - limit + 1);
      const out: WireEmail[] = [];
      for await (const msg of client.fetch(`${start}:${end}`, FETCH_FIELDS))
        out.push(toWireEmail(msg, cfg, role, tz));
      return out.reverse();
    } finally {
      lock.release();
    }
  });
}


/* ───────────────────────── server-side search ─────────────────────────
 * The whole mailbox, not the 30 rows the client happens to hold. Query
 * grammar (Gmail-ish):  from:sophia  to:me@x  subject:invoice  has:attachment
 * is:unread  is:starred  before:2026-08-01  after:2026-07-01  "exact phrase"
 * plus free words matched against subject, sender AND body text.
 */

export type ParsedQuery = {
  from?: string[];
  to?: string[];
  subject?: string[];
  text: string[];        // free words / phrases: OR'd across subject|from|body
  hasAttachment?: boolean;
  unread?: boolean;
  starred?: boolean;
  before?: Date;
  after?: Date;
};

export function parseSearchQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { text: [] };
  const re = /(\w+):("([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    if (m[1]) {
      const key = m[1].toLowerCase();
      const val = (m[3] ?? m[4] ?? "").trim();
      if (!val) continue;
      if (key === "from") (out.from ??= []).push(val);
      else if (key === "to") (out.to ??= []).push(val);
      else if (key === "subject") (out.subject ??= []).push(val);
      else if (key === "has" && /^(attachment|file|files)$/i.test(val)) out.hasAttachment = true;
      else if (key === "is") {
        if (/^unread$/i.test(val)) out.unread = true;
        else if (/^read$/i.test(val)) out.unread = false;
        else if (/^(starred|flagged|important)$/i.test(val)) out.starred = true;
      } else if (key === "before" || key === "after") {
        const d = new Date(val);
        if (!Number.isNaN(d.getTime())) out[key] = d;
      } else out.text.push(`${m[1]}:${val}`); // unknown prefix → literal
    } else {
      const val = (m[5] ?? m[6] ?? "").trim();
      if (val) out.text.push(val);
    }
  }
  return out;
}

/** Build the ImapFlow SEARCH object; free text becomes an OR over subject/from/body. */
function toImapSearch(p: ParsedQuery, tier: "header" | "body"): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  for (const f of p.from ?? []) and.push({ from: f });
  for (const t of p.to ?? []) and.push({ to: t });
  for (const s of p.subject ?? []) and.push({ subject: s });
  if (p.unread === true) and.push({ seen: false });
  if (p.unread === false) and.push({ seen: true });
  if (p.starred) and.push({ flagged: true });
  if (p.before) and.push({ before: p.before });
  if (p.after) and.push({ since: p.after });
  // Free words: the header tier matches subject/from (precise on every
  // server); the body tier adds BODY, which some servers (Exchange) match
  // very loosely — so it ranks below and is labelled.
  for (const word of p.text)
    and.push(
      tier === "header"
        ? { or: [{ subject: word }, { from: word }] }
        : { body: word }
    );
  if (and.length === 0) return { all: true };
  if (and.length === 1) return and[0];
  // ImapFlow has no top-level AND key; nested objects AND their own keys, so
  // merge where keys don't collide and chain the rest through `or`-less nesting
  const merged: Record<string, unknown> = {};
  const rest: Record<string, unknown>[] = [];
  for (const c of and) {
    const [k] = Object.keys(c);
    if (k in merged || k === "or") rest.push(c);
    else Object.assign(merged, c);
  }
  // multiple criteria that share a key (two free words → two `or`s) can't be
  // merged into one object; ImapFlow accepts an array of criteria as implicit AND
  return rest.length ? ({ ...merged, $and: rest } as Record<string, unknown>) : merged;
}

// Default scope: where mail actually lives. Trash/drafts/snoozed are opt-in
// via role= — searching them by default triples the round-trips for noise.
const SEARCH_ROLES: Role[] = ["inbox", "archive", "sent"];

/**
 * Search one account across every folder (or one), newest first.
 * The attachment filter is applied client-side after fetch — IMAP SEARCH has
 * no reliable "has attachment" criterion across servers.
 */
export async function searchMessages(
  cfg: MailConfig,
  query: string,
  opts: { role?: Role | "all"; tz?: string; limitPerFolder?: number } = {}
): Promise<WireEmail[]> {
  const parsed = parseSearchQuery(query);
  const roles = opts.role && opts.role !== "all" ? [opts.role] : SEARCH_ROLES;
  const limit = opts.limitPerFolder ?? 40;
  const hasFreeText = parsed.text.length > 0;

  const runCriteria = async (
    client: ImapFlow,
    criteria: Record<string, unknown>
  ): Promise<number[]> => {
    // ImapFlow has no `$and` — split criteria run as separate UID searches
    // intersected in JS
    const { $and, ...base } = criteria as { $and?: Record<string, unknown>[] } & Record<string, unknown>;
    let uids = ((await client.search(base as never, { uid: true })) || []) as number[];
    for (const extra of $and ?? []) {
      if (uids.length === 0) break;
      const set = new Set(((await client.search(extra as never, { uid: true })) || []) as number[]);
      uids = uids.filter((u) => set.has(u));
    }
    return uids;
  };

  // Folders in parallel, each on its own connection: logins overlap so the
  // wall-clock is ~one login, and the per-folder SEARCH+FETCH also overlap.
  // (Serial-on-one-connection was measured slower — Exchange serialises the
  // whole pipeline per session.)
  const searchFolder = async (role: Role): Promise<WireEmail[]> =>
    withImap(cfg, async (client) => {
      const path = await resolveRole(client, role);
      if (!path) return [];
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        const headerUids = await runCriteria(client, toImapSearch(parsed, "header"));
        const headerSet = new Set(headerUids);
        // BODY search is the slow, fuzzy tier: only pay for it when the
        // precise header tier came back thin
        const bodyUids =
          hasFreeText && headerUids.length < limit
            ? (await runCriteria(client, toImapSearch(parsed, "body"))).filter((u) => !headerSet.has(u))
            : [];
        const pick = (uids: number[], n: number) => uids.sort((a, b) => b - a).slice(0, n);
        const wanted: { uid: number; match: "header" | "body" }[] = [
          ...pick(headerUids, limit).map((uid) => ({ uid, match: "header" as const })),
          ...pick(bodyUids, Math.max(0, limit - Math.min(headerUids.length, limit))).map((uid) => ({ uid, match: "body" as const })),
        ];
        if (wanted.length === 0) return [];
        const matchOf = new Map(wanted.map((w) => [w.uid, w.match]));
        const found: WireEmail[] = [];
        // bodyStructure is the expensive part of the fetch on Exchange; the
        // attachment icon can be filled in when the message is opened
        const fields = parsed.hasAttachment ? FETCH_FIELDS : { ...FETCH_FIELDS, bodyStructure: false };
        for await (const msg of client.fetch(wanted.map((w) => w.uid), fields, { uid: true })) {
          const w = toWireEmail(msg, cfg, role, opts.tz);
          if (parsed.hasAttachment && !w.attachments?.length) continue;
          let match = matchOf.get(msg.uid) ?? "body";
          // Exchange's IMAP SEARCH is fuzzy even on SUBJECT/FROM. Trust a
          // header hit only if the envelope really contains every free word.
          if (match === "header" && hasFreeText) {
            const hay = `${w.subject} ${w.from.name} ${w.from.email}`.toLowerCase();
            if (!parsed.text.every((t) => hay.includes(t.toLowerCase()))) match = "body";
          }
          w.match = match;
          found.push(w);
        }
        return found;
      } finally {
        lock.release();
      }
    }).catch(() => [] as WireEmail[]); // one folder failing shouldn't sink the search
  const perFolder = await Promise.all(roles.map(searchFolder));
  // header matches first, newest first within each tier
  return perFolder.flat().sort((a, b) => {
    if (a.match !== b.match) return a.match === "header" ? -1 : 1;
    return (b.sortDate ?? 0) - (a.sortDate ?? 0);
  });
}
