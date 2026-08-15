import { isOffline, netFetch } from "./offline";
import { Email, Folder, MailAction, OutgoingAttachment, Provider } from "./types";

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
    const res = await netFetch("/api/mail/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    return (await res.json()) as { ok: boolean; accounts?: string[]; error?: string };
  } catch {
    return {
      ok: false,
      error: isOffline()
        ? "You're offline — connect an account once you're back on a network."
        : "Couldn't reach the mail server. Check your connection and try again.",
    };
  }
}

/** Accounts already connected in this session (cookie-backed). */
export async function apiAccounts(): Promise<string[]> {
  try {
    const res = await netFetch("/api/mail/accounts");
    const data = (await res.json()) as { ok: boolean; accounts?: string[] };
    return data.accounts ?? [];
  } catch {
    return [];
  }
}

/** Disconnect one account, or all when omitted. Returns the remaining accounts. */
export async function apiDisconnect(account?: string): Promise<string[]> {
  try {
    const res = await netFetch(
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
  const res = await netFetch("/api/ai", {
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
  const res = await netFetch("/api/saved-accounts");
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
  const res = await netFetch("/api/saved-accounts", {
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
  const res = await netFetch(`/api/saved-accounts?id=${encodeURIComponent(id)}`, {
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
  account: string = "all",
  /** how many newer messages to skip — paging back through the mailbox */
  offset = 0
): Promise<Email[]> {
  const res = await netFetch(
    `/api/mail/messages?role=${role}&tz=${encodeURIComponent(tz)}&account=${encodeURIComponent(account)}&offset=${offset}`
  );
  const data = (await res.json()) as { ok: boolean; messages?: Email[]; error?: string };
  if (!data.ok || !data.messages) throw new Error(data.error ?? "Fetch failed");
  return data.messages;
}

export async function apiBody(
  role: Folder,
  uid: number,
  account?: string
): Promise<{ body: string[]; html?: string; messageId?: string; references?: string[] }> {
  const res = await netFetch(
    `/api/mail/message?role=${role}&uid=${uid}${
      account ? `&account=${encodeURIComponent(account)}` : ""
    }`
  );
  const data = (await res.json()) as {
    ok: boolean;
    body?: string[];
    html?: string;
    messageId?: string;
    references?: string[];
    error?: string;
  };
  if (!data.ok || !data.body) throw new Error(data.error ?? "Fetch failed");
  return { body: data.body, html: data.html, messageId: data.messageId, references: data.references };
}

export async function apiAction(
  role: Folder,
  uid: number,
  action: MailAction,
  account?: string
): Promise<void> {
  const res = await netFetch("/api/mail/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, uid, action, account }),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(data.error ?? "Action failed");
}

/** Read an email and pull out the work it's actually asking for. */
export async function apiSmartTask(payload: {
  from: string;
  subject: string;
  body: string;
  now?: string;
}): Promise<{
  title: string;
  note: string;
  priority: "high" | "medium" | "low";
  due: string;
  checklist: { label: string }[];
}> {
  const res = await netFetch("/api/ai/task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as {
    ok: boolean;
    task?: {
      title: string;
      note: string;
      priority: "high" | "medium" | "low";
      due: string;
      checklist: { label: string }[];
    };
    error?: string;
  };
  if (!data.ok || !data.task) throw new Error(data.error ?? "Smart task failed");
  return data.task;
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
  const res = await netFetch("/api/mail/draft", {
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
  attachments?: OutgoingAttachment[];
}): Promise<void> {
  const res = await netFetch("/api/mail/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(data.error ?? "Send failed");
}

export type Contact = {
  /** Always lowercase — the contacts route normalizes, and the compose
   * autocomplete's case-insensitive matching depends on it. */
  email: string;
  name: string;
  count: number;
  lastUsed: number;
};

/** People you've emailed before, ranked for compose autocomplete. */
export async function apiContacts(): Promise<Contact[]> {
  try {
    const res = await netFetch("/api/mail/contacts");
    const data = (await res.json()) as { ok: boolean; contacts?: Contact[] };
    return data.contacts ?? [];
  } catch {
    return [];
  }
}

/** Queue a message to be sent at a future time (server-side, via cron). */
export async function apiScheduleSend(payload: {
  to: string;
  subject: string;
  text: string;
  sendAt: string; // ISO
  account?: string;
  attachments?: OutgoingAttachment[];
}): Promise<{ id: string; sendAt: string }> {
  const res = await fetch("/api/mail/scheduled", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as {
    ok: boolean;
    scheduled?: { id: string; sendAt: string };
    error?: string;
  };
  if (!data.ok || !data.scheduled) throw new Error(data.error ?? "Couldn't schedule");
  return data.scheduled;
}

export type ScheduledSummary = {
  id: string;
  account: string;
  sendAt: string;
  status: "pending" | "sending" | "sent" | "failed" | "cancelled";
  lastError?: string;
  payload: { to: string; subject: string; text: string; attachmentCount: number };
};

export async function apiScheduledList(): Promise<ScheduledSummary[]> {
  const res = await fetch("/api/mail/scheduled");
  const data = (await res.json()) as { ok: boolean; scheduled?: ScheduledSummary[] };
  return data.scheduled ?? [];
}

export async function apiScheduledCancel(id: string): Promise<boolean> {
  const res = await fetch(`/api/mail/scheduled?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const data = (await res.json()) as { ok: boolean; cancelled?: boolean; error?: string };
  if (!data.ok) throw new Error(data.error ?? "Couldn't cancel");
  return Boolean(data.cancelled);
}

/** Server-side search across every folder of every connected account. */
export async function apiSearch(
  q: string,
  tz: string,
  opts: { account?: string; role?: Folder; signal?: AbortSignal } = {}
): Promise<Email[]> {
  const params = new URLSearchParams({ q, tz });
  if (opts.account && opts.account !== "all") params.set("account", opts.account);
  if (opts.role) params.set("role", opts.role);
  const res = await fetch(`/api/mail/search?${params}`, { signal: opts.signal });
  const data = (await res.json()) as { ok: boolean; messages?: Email[]; error?: string };
  if (!data.ok || !data.messages) throw new Error(data.error ?? "Search failed");
  return data.messages;
}
