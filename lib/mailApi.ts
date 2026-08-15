import { Email, Folder, Provider } from "./types";

type ConnectPayload = {
  /** Full-credential connect. Omit pass to fall back to the saved login. */
  user?: string;
  pass?: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  provider?: Provider;
  /** Connect a saved account by its id (email) using the stored password. */
  accountId?: string;
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

/** Ask Claude, sending a snapshot of what's on screen as context. */
export async function apiAsk(payload: {
  turns: { role: "user" | "assistant"; text: string }[];
  context: unknown;
}): Promise<string> {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; text?: string; error?: string };
  if (!data.ok) throw new Error(data.error ?? "The AI request failed.");
  return data.text ?? "";
}

/** An account persisted in Supabase — password stays server-side, encrypted. */
export type SavedAccountInfo = {
  id: string;
  email: string;
  provider: Provider;
  /** User-set name for this account; the UI falls back to the address. */
  label?: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  hasPassword: boolean;
  /** Signed in with Microsoft/Google — no password involved. */
  isOAuth?: boolean;
  oauthProvider?: "microsoft" | "google";
};

export type SavedAccountsResult = {
  accounts: SavedAccountInfo[];
  /** Accounts that were live last session — candidates for auto-restore. */
  connectedAccountIds: string[];
};

export async function apiSavedAccounts(): Promise<SavedAccountsResult> {
  const res = await fetch("/api/saved-accounts");
  const data = (await res.json()) as { ok: boolean } & Partial<SavedAccountsResult>;
  return {
    accounts: data.accounts ?? [],
    connectedAccountIds: data.connectedAccountIds ?? [],
  };
}

export async function apiSavedAccountSave(payload: {
  email: string;
  provider: Provider;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  password?: string;
  label?: string;
}): Promise<SavedAccountsResult> {
  const res = await fetch("/api/saved-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; error?: string } & Partial<SavedAccountsResult>;
  if (!data.ok) throw new Error(data.error ?? "Save failed");
  return {
    accounts: data.accounts ?? [],
    connectedAccountIds: data.connectedAccountIds ?? [],
  };
}

export async function apiSavedAccountDelete(id: string): Promise<SavedAccountsResult> {
  const res = await fetch(`/api/saved-accounts?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const data = (await res.json()) as { ok: boolean } & Partial<SavedAccountsResult>;
  return {
    accounts: data.accounts ?? [],
    connectedAccountIds: data.connectedAccountIds ?? [],
  };
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

/** Rename one saved account without touching its credentials. */
export async function apiSavedAccountLabel(
  account: SavedAccountInfo,
  label: string
): Promise<SavedAccountsResult> {
  return apiSavedAccountSave({
    email: account.email,
    provider: account.provider,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    label,
  });
}

/** Save a draft into the account's Drafts mailbox. Returns its new uid. */
export async function apiSaveDraft(payload: {
  to: string;
  subject: string;
  text: string;
  account?: string;
  replaceUid?: number;
}): Promise<number | undefined> {
  const res = await fetch("/api/mail/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; uid?: number; error?: string };
  if (!data.ok) throw new Error(data.error ?? "Could not save draft");
  return data.uid;
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
