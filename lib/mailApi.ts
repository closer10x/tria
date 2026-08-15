import { Email, Folder } from "./types";

type ConnectPayload = {
  user: string;
  pass: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
};

export async function apiConnect(
  cfg: ConnectPayload
): Promise<{ ok: boolean; accounts?: string[]; error?: string }> {
  try {
    const res = await fetch("/api/mail/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    return (await res.json()) as { ok: boolean; accounts?: string[]; error?: string };
  } catch {
    return {
      ok: false,
      error:
        "Couldn't reach the mail server API — live mail needs the Next.js app running (npm run dev), not the static preview.",
    };
  }
}

/** Accounts already connected in this session (cookie-backed). */
export async function apiAccounts(): Promise<string[]> {
  try {
    const res = await fetch("/api/mail/accounts");
    const data = (await res.json()) as { ok: boolean; accounts?: string[] };
    return data.accounts ?? [];
  } catch {
    return [];
  }
}

/** Disconnect one account, or all when omitted. Returns the remaining accounts. */
export async function apiDisconnect(account?: string): Promise<string[]> {
  try {
    const res = await fetch(
      `/api/mail/accounts${account ? `?account=${encodeURIComponent(account)}` : ""}`,
      { method: "DELETE" }
    );
    const data = (await res.json()) as { ok: boolean; accounts?: string[] };
    return data.accounts ?? [];
  } catch {
    return [];
  }
}

export async function apiMessages(
  role: Folder,
  tz: string,
  account: string = "all"
): Promise<Email[]> {
  const res = await fetch(
    `/api/mail/messages?role=${role}&tz=${encodeURIComponent(tz)}&account=${encodeURIComponent(account)}`
  );
  const data = (await res.json()) as { ok: boolean; messages?: Email[]; error?: string };
  if (!data.ok || !data.messages) throw new Error(data.error ?? "Fetch failed");
  return data.messages;
}

export async function apiBody(
  role: Folder,
  uid: number,
  account?: string
): Promise<{ body: string[]; messageId?: string; references?: string[] }> {
  const res = await fetch(
    `/api/mail/message?role=${role}&uid=${uid}${
      account ? `&account=${encodeURIComponent(account)}` : ""
    }`
  );
  const data = (await res.json()) as {
    ok: boolean;
    body?: string[];
    messageId?: string;
    references?: string[];
    error?: string;
  };
  if (!data.ok || !data.body) throw new Error(data.error ?? "Fetch failed");
  return { body: data.body, messageId: data.messageId, references: data.references };
}

export async function apiAction(
  role: Folder,
  uid: number,
  action:
    | "read"
    | "unread"
    | "star"
    | "unstar"
    | "archive"
    | "trash"
    | "inbox"
    | "snooze",
  account?: string
): Promise<void> {
  const res = await fetch("/api/mail/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, uid, action, account }),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(data.error ?? "Action failed");
}

export async function apiSend(payload: {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
  account?: string;
}): Promise<void> {
  const res = await fetch("/api/mail/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(data.error ?? "Send failed");
}
