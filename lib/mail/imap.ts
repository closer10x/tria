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

export async function resolveRole(
  client: ImapFlow,
  role: Role
): Promise<string> {
  if (role === "inbox") return "INBOX";
  const list = await client.list();
  const bySpecial = (flag: string) =>
    list.find((m) => m.specialUse === flag)?.path;
  if (role === "drafts")
    return (
      bySpecial("\\Drafts") ?? list.find((m) => /draft/i.test(m.path))?.path ?? "INBOX"
    );
  if (role === "sent")
    return bySpecial("\\Sent") ?? list.find((m) => /sent/i.test(m.path))?.path ?? "INBOX";
  if (role === "trash")
    return bySpecial("\\Trash") ?? list.find((m) => /trash|deleted/i.test(m.path))?.path ?? "INBOX";
  if (role === "archive")
    return (
      bySpecial("\\Archive") ??
      bySpecial("\\All") ??
      list.find((m) => /all mail|archive/i.test(m.path))?.path ??
      "INBOX"
    );
  // snoozed — a Tria-managed folder
  const existing = list.find((m) => /^Tria[/.]Snoozed$/.test(m.path));
  if (existing) return existing.path;
  try {
    await client.mailboxCreate("Tria/Snoozed");
    return "Tria/Snoozed";
  } catch {
    return "INBOX";
  }
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function hueOf(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return HUES[h % HUES.length];
}

export function formatTime(d: Date | undefined, tz?: string): string {
  if (!d) return "";
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = { timeZone: tz };
  const sameDay = d.toDateString() === now.toDateString();
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
  subject: string;
  preview: string;
  body: string[];
  time: string;
  read: boolean;
  starred: boolean;
  attachments?: AttachmentInfo[];
};

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
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      const mailbox = client.mailbox;
      const exists = mailbox && typeof mailbox === "object" ? mailbox.exists : 0;
      if (!exists) return [];
      const end = exists - offset;
      if (end < 1) return [];
      const start = Math.max(1, end - limit + 1);
      const out: WireEmail[] = [];
      for await (const msg of client.fetch(`${start}:${end}`, {
        envelope: true,
        flags: true,
        uid: true,
        internalDate: true,
        bodyStructure: true,
      })) {
        const env = msg.envelope;
        const fromAddr = env?.from?.[0];
        const name = fromAddr?.name || fromAddr?.address || "Unknown";
        const attachments: AttachmentInfo[] = [];
        walkAttachments(msg.bodyStructure, attachments);
        out.push({
          id: `live-${cfg.user}-${msg.uid}-${role}`,
          uid: msg.uid,
          folder: role,
          accountId: cfg.user,
          sortDate: msg.internalDate
            ? new Date(msg.internalDate).getTime()
            : undefined,
          from: {
            name,
            email: fromAddr?.address ?? "",
            initials: initialsOf(name),
            hue: hueOf(fromAddr?.address ?? name),
          },
          to: env?.to?.[0]?.address,
          subject: env?.subject ?? "(no subject)",
          preview: "",
          body: [],
          time: formatTime(
            msg.internalDate ? new Date(msg.internalDate) : undefined,
            tz
          ),
          read: msg.flags?.has("\\Seen") ?? false,
          starred: msg.flags?.has("\\Flagged") ?? false,
          attachments: attachments.length ? attachments : undefined,
        });
      }
      return out.reverse();
    } finally {
      lock.release();
    }
  });
}
