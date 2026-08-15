"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Email, Folder, OutgoingAttachment } from "@/lib/types";
import { apiContacts, Contact } from "@/lib/mailApi";
import MailDrawer from "./MailDrawer";
import {
  ArchiveIcon,
  Avatar,
  ClipIcon,
  ClockIcon,
  MailIcon,
  PaneHeader,
  PenIcon,
  RefreshIcon,
  ReplyIcon,
  SparkIcon,
  StarIcon,
  Tag,
  TrashIcon,
} from "./ui";

/** Good enough to tell a typo from an address; the server does the real check. */
const splitAddresses = (v: string) =>
  v.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** Most providers reject much beyond this once base64-encoded. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const folders: { key: Folder; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "snoozed", label: "Snoozed" },
  { key: "drafts", label: "Drafts" },
  { key: "sent", label: "Sent" },
  { key: "archive", label: "Archive" },
  { key: "trash", label: "Trash" },
];

/** A message handed back to the composer — from an undone send or a draft. */
export type RestoreDraft =
  | { kind: "reply"; text: string }
  | {
      kind: "compose";
      to: string;
      subject: string;
      body: string;
      fromAccount?: string;
      draftUid?: number;
    };

// stable per-account accent colors for the switcher and message rows
const ACCOUNT_COLORS = [
  "#c96f4a", // clay
  "#5b93c4", // sky
  "#8b6fc0", // violet
  "#4da583", // sage
  "#c99a3d", // gold
  "#c05f7c", // rose
];

export function accountColor(accounts: string[], accountId: string): string {
  const i = accounts.indexOf(accountId);
  return ACCOUNT_COLORS[(i === -1 ? 0 : i) % ACCOUNT_COLORS.length];
}

/** "jon.garcia.a@gmail.com" → "jon.garcia.a" — enough to tell accounts apart. */
/**
 * What to call an account in the switcher: the name set in Settings, else the
 * full address — the local part alone ("info") doesn't say which mailbox.
 */
const accountLabel = (email: string, labels?: Record<string, string>) =>
  labels?.[email]?.trim() || email;

/** Mock AI query understanding — later this becomes a real Claude call. */
function aiSearch(
  query: string,
  emails: Email[]
): { results: Email[]; chips: string[] } {
  const q = query.toLowerCase();
  const chips: string[] = [];
  let results = emails;

  if (/\bunread\b/.test(q)) {
    results = results.filter((e) => !e.read);
    chips.push("unread");
  }
  if (/\b(attachment|attachments|files?|pdf|image)\b/.test(q)) {
    results = results.filter((e) => e.attachments?.length);
    chips.push("has attachments");
  }
  if (/\b(starred|important|flagged)\b/.test(q)) {
    results = results.filter((e) => e.starred);
    chips.push("starred");
  }
  if (/\breplied\b/.test(q)) {
    results = results.filter((e) => e.replied);
    chips.push("replied");
  }
  if (/\b(today|this morning)\b/.test(q)) {
    results = results.filter((e) => /am|pm/i.test(e.time));
    chips.push("today");
  }

  const fromMatch = q.match(/from\s+([a-zà-ÿ]+)/i);
  if (fromMatch) {
    const who = fromMatch[1];
    results = results.filter((e) =>
      e.from.name.toLowerCase().includes(who)
    );
    chips.push(`from: ${who}`);
  } else {
    // bare name mention
    const names = Array.from(
      new Set(emails.map((e) => e.from.name.split(" ")[0].toLowerCase()))
    );
    const hit = names.find((n) => new RegExp(`\\b${n}\\b`).test(q));
    if (hit) {
      results = results.filter((e) =>
        e.from.name.toLowerCase().startsWith(hit)
      );
      chips.push(`from: ${hit}`);
    }
  }

  const stop = new Set([
    "show","me","my","all","emails","email","mail","mails","the","a","an","with","and","or",
    "that","have","has","from","about","unread","read","attachment","attachments","file",
    "files","starred","important","flagged","replied","today","this","morning","find","search",
    "pdf","image","in","of","to","any","anything","stuff","things",
  ]);
  const keywords = q
    .replace(/[^\wà-ÿ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  const usedNames = chips
    .filter((c) => c.startsWith("from:"))
    .map((c) => c.slice(6).trim());
  const topics = keywords.filter((w) => !usedNames.includes(w));
  if (topics.length) {
    results = results.filter((e) => {
      const hay = (
        e.subject +
        " " +
        e.preview +
        " " +
        e.body.join(" ") +
        " " +
        (e.tag ?? "")
      ).toLowerCase();
      return topics.some((t) => hay.includes(t));
    });
    chips.push(`about: ${topics.join(", ")}`);
  }

  return { results, chips };
}

function draftReply(email: Email): string {
  const first = email.from.name.split(" ")[0];
  if (email.id === "e1")
    return `Maya — reviewed everything. Going with variant B, the pricing copy is approved, and cleared logos are on the way by Thursday. Great work.`;
  if (email.id === "e2")
    return `Derek — net-45 works on our side starting next cycle. Send over the amended agreement and I'll sign today.`;
  return `Hi ${first},\nThanks for the note — I'm on it and will circle back by tomorrow.`;
}

function IconBtn({
  title,
  onClick,
  children,
  danger = false,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded-md p-1.5 text-(--color-ink-faint) transition-colors ${
        danger
          ? "hover:bg-red-50 hover:text-red-500"
          : "hover:bg-(--color-clay-soft) hover:text-(--color-clay)"
      }`}
    >
      {children}
    </button>
  );
}

export default function MailPane({
  emails,
  accounts,
  accountLabels,
  selectedId,
  onSelect,
  onBack,
  onMakeTask,
  onShareToThread,
  onViewTask,
  onSendToAi,
  onArchive,
  onDelete,
  onSnooze,
  onRestore,
  onReply,
  onComposeSend,
  onToggleStar,
  onMarkUnread,
  onFolderChange,
  onScheduleSend,
  onOpenSettings,
  userName,
  onSaveDraft,
  onRefresh,
  refreshing,
  restoreDraft,
  onDraftRestored,
  onLoadMore,
  loadingMore,
  noMoreMail,
  snoozeOptions,
}: {
  emails: Email[];
  accounts: string[]; // live-connected account emails; empty = demo data
  /** email → the name set in Settings; falls back to the address */
  accountLabels?: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBack: () => void;
  onMakeTask: (email: Email) => void;
  onShareToThread: (email: Email) => void;
  onViewTask: (taskId: string) => void;
  onSendToAi: (email: Email) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onSnooze: (id: string, until: string) => void;
  onRestore: (id: string) => void;
  onReply: (email: Email, text: string) => void;
  onComposeSend: (
    to: string,
    subject: string,
    body: string,
    fromAccount?: string,
    attachments?: OutgoingAttachment[]
  ) => void;
  onToggleStar: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onFolderChange: (folder: Folder) => void;
  /** Queue a composed message to go out at `sendAt` (server-side, survives closing the app). */
  onScheduleSend?: (
    to: string,
    subject: string,
    body: string,
    sendAt: Date,
    fromAccount?: string,
    attachments?: OutgoingAttachment[]
  ) => void;
  /** Opens the app settings modal — reached from the mobile drawer. */
  onOpenSettings?: () => void;
  /** Shown in the mobile drawer footer, where the desktop top bar's name pill lived. */
  userName?: string;
  onSaveDraft: (
    to: string,
    subject: string,
    body: string,
    fromAccount?: string,
    /** uid of the version being replaced, so the server drops the old copy */
    replaceUid?: number
  ) => void;
  onRefresh: (folder: Folder) => void;
  refreshing: boolean;
  /** Set when an undone send hands its text back to the composer. */
  restoreDraft: RestoreDraft | null;
  onDraftRestored: () => void;
  /** Fetch the next page of older mail for this folder. */
  onLoadMore?: (folder: Folder) => void;
  loadingMore?: boolean;
  /** True once the mailbox has no older messages left. */
  noMoreMail?: boolean;
  snoozeOptions: string[];
}) {
  const [query, setQuery] = useState("");
  const [aiMode, setAiMode] = useState(false);
  const [folder, setFolder] = useState<Folder>("inbox");
  // mobile-only chrome: burger drawer + a search field that opens on demand
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleCustom, setScheduleCustom] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mobileSearchOpen) mobileSearchRef.current?.focus();
  }, [mobileSearchOpen]);
  // which account's mail to show — "all" is the unified view
  const [account, setAccount] = useState<string>("all");
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [composing, setComposing] = useState(false);
  // multi-select for bulk actions; anchor drives shift-click ranges
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);

  // recipients are committed to pills; `to` is whatever is still being typed
  const [recipients, setRecipients] = useState<string[]>([]);
  const [to, setTo] = useState("");
  const toInput = useRef<HTMLInputElement>(null);
  // people you've emailed before, for To-field autocomplete
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sugIndex, setSugIndex] = useState(0);
  const [sugOpen, setSugOpen] = useState(true);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fromAccount, setFromAccount] = useState<string>("");
  // uid of the Drafts copy being edited, so re-saving replaces it
  const [draftUid, setDraftUid] = useState<number | undefined>();
  const [attached, setAttached] = useState<OutgoingAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // an attachment opened from a message, shown full screen
  const [viewing, setViewing] = useState<{
    name: string;
    url: string;
    contentType?: string;
  } | null>(null);

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setAttaching(true);
    try {
      const read = await Promise.all(
        Array.from(files).map(
          (file) =>
            new Promise<OutgoingAttachment>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
              reader.onload = () =>
                resolve({
                  filename: file.name,
                  contentType: file.type || undefined,
                  size: file.size,
                  // strip the "data:...;base64," prefix
                  data: String(reader.result).split(",")[1] ?? "",
                });
              reader.readAsDataURL(file);
            })
        )
      );
      setAttached((prev) => {
        const next = [...prev, ...read];
        const total = next.reduce((n, a) => n + a.size, 0);
        // most providers reject much beyond this once base64-encoded
        if (total > MAX_ATTACHMENT_BYTES) {
          window.alert(
            "Attachments come to more than 20 MB, which most mail servers reject. Remove one and try again."
          );
          return prev;
        }
        return next;
      });
    } finally {
      setAttaching(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  // fetch the contact ranking once per compose session (server caches the scan)
  useEffect(() => {
    if (composing && contacts.length === 0)
      apiContacts().then(setContacts).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composing]);

  // Gmail-style suggestions: match name or address, hide already-added people
  const suggestions = useMemo(() => {
    const q = to.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(recipients.map((r) => r.toLowerCase()));
    return contacts
      .filter(
        (c) =>
          !taken.has(c.email) &&
          (c.email.includes(q) || c.name.toLowerCase().includes(q))
      )
      .slice(0, 6);
  }, [to, contacts, recipients]);

  const pickSuggestion = (c: Contact) => {
    setRecipients((prev) => [...prev, c.email]);
    setTo("");
    setSugIndex(0);
    toInput.current?.focus();
  };

  // an undone send (or a reopened draft) puts its text back in the composer
  useEffect(() => {
    if (!restoreDraft) return;
    if (restoreDraft.kind === "reply") {
      setReplyOpen(true);
      setReplyText(restoreDraft.text);
    } else {
      setComposing(true);
      setRecipients(splitAddresses(restoreDraft.to));
      setTo("");
      setSubject(restoreDraft.subject);
      setBody(restoreDraft.body);
      setDraftUid(restoreDraft.draftUid);
      if (restoreDraft.fromAccount) setFromAccount(restoreDraft.fromAccount);
    }
    onDraftRestored();
  }, [restoreDraft, onDraftRestored]);

  // if the viewed account got disconnected, fall back to the unified view
  const activeAccount =
    account !== "all" && !accounts.includes(account) ? "all" : account;
  const multiAccount = accounts.length > 1;
  const byAccount = (e: Email) =>
    activeAccount === "all" || !e.accountId || e.accountId === activeAccount;

  const unread = emails.filter(
    (e) => e.folder === "inbox" && !e.read && byAccount(e)
  ).length;
  const selected = emails.find((e) => e.id === selectedId) ?? null;

  const inFolder = emails.filter((e) => e.folder === folder && byAccount(e));
  const q = query.trim().toLowerCase();
  const plainMatches = q
    ? inFolder.filter(
        (e) =>
          e.subject.toLowerCase().includes(q) ||
          e.from.name.toLowerCase().includes(q) ||
          e.from.email.toLowerCase().includes(q)
      )
    : inFolder;
  // Smart search runs behind the scenes: intent parsing (unread / from X /
  // with attachments / about Y) is always tried; a plain substring match is
  // merged in so a literal subject search never comes up empty. The desktop
  // AI toggle only controls whether the understood-filters chips are shown.
  const smart = q ? aiSearch(query, inFolder) : null;
  const filtered = (() => {
    if (!q) return inFolder;
    if (!smart || smart.chips.length === 0) return plainMatches;
    const seen = new Set(smart.results.map((e) => e.id));
    return [...smart.results, ...plainMatches.filter((e) => !seen.has(e.id))];
  })();
  const aiResult = aiMode && smart && smart.chips.length ? smart : null;

  const selecting = selectedIds.size > 0;
  const allSelected =
    filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id));

  /** Shift-click extends from the last row you touched, like a file list. */
  const toggleSelect = (id: string, extend = false) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (extend && anchorId) {
        const from = filtered.findIndex((e) => e.id === anchorId);
        const to = filtered.findIndex((e) => e.id === id);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          for (let i = lo; i <= hi; i++) next.add(filtered[i].id);
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchorId(id);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setAnchorId(null);
  };

  /** Run a per-message action across the selection, then drop it. */
  const bulk = (fn: (id: string) => void) => {
    selectedIds.forEach(fn);
    clearSelection();
  };

  const count = (f: Folder) =>
    emails.filter((e) => e.folder === f && byAccount(e)).length;
  const accountUnread = (a: string) =>
    emails.filter(
      (e) => e.folder === "inbox" && !e.read && e.accountId === a
    ).length;

  const closeDetailState = () => {
    setReplyOpen(false);
    setReplyText("");
    setSnoozeOpen(false);
  };

  const submitReply = () => {
    if (!selected || !replyText.trim()) return;
    onReply(selected, replyText.trim());
    closeDetailState();
  };

  /** Turn typed text into pills, splitting on commas, semicolons and spaces. */
  const commitRecipients = (raw: string) => {
    const parts = raw
      .split(/[,;\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    setRecipients((prev) => [
      ...prev,
      ...parts.filter((p) => !prev.includes(p)),
    ]);
  };

  /** Pills plus anything still in the box, so an unconfirmed address still sends. */
  const allRecipients = () => {
    const pending = to.trim();
    return pending && !recipients.includes(pending)
      ? [...recipients, pending]
      : recipients;
  };

  /**
   * Empty the composer. Every exit path must go through this — leaving the
   * committed recipient pills behind silently pre-addressed the *next*
   * message to the previous one's recipients.
   */
  const resetCompose = () => {
    setComposing(false);
    setAttached([]);
    setRecipients([]);
    setTo("");
    setSubject("");
    setBody("");
    setDraftUid(undefined);
  };

  const submitCompose = () => {
    const list = allRecipients();
    if (list.length === 0 || (!subject.trim() && !body.trim())) return;
    onComposeSend(
      list.join(", "),
      subject.trim(),
      body.trim(),
      accounts.length
        ? fromAccount || (activeAccount !== "all" ? activeAccount : accounts[0])
        : undefined,
      attached
    );
    resetCompose();
    setFolder("sent");
  };

  const currentAccount = () =>
    accounts.length
      ? fromAccount || (activeAccount !== "all" ? activeAccount : accounts[0])
      : undefined;

  const submitScheduled = (when: Date) => {
    const list = allRecipients();
    if (list.length === 0 || (!subject.trim() && !body.trim())) return;
    onScheduleSend?.(
      list.join(", "),
      subject.trim(),
      body.trim(),
      when,
      currentAccount(),
      attached
    );
    setScheduleOpen(false);
    setScheduleCustom("");
    resetCompose();
  };

  /** Presets in the reader's local time. */
  const schedulePresets = (): { label: string; at: Date }[] => {
    const now = new Date();
    const at = (d: Date, h: number, m = 0) => {
      const x = new Date(d);
      x.setHours(h, m, 0, 0);
      return x;
    };
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const monday = new Date(now);
    monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
    const out: { label: string; at: Date }[] = [];
    if (now.getHours() < 8) out.push({ label: "This morning, 8 AM", at: at(now, 8) });
    if (now.getHours() < 13) out.push({ label: "This afternoon, 1 PM", at: at(now, 13) });
    if (now.getHours() < 18) out.push({ label: "This evening, 6 PM", at: at(now, 18) });
    out.push({ label: "Tomorrow, 8 AM", at: at(tomorrow, 8) });
    out.push({ label: "Tomorrow, 1 PM", at: at(tomorrow, 13) });
    out.push({ label: "Monday, 8 AM", at: at(monday, 8) });
    return out;
  };

  const saveDraft = () => {
    const list = allRecipients();
    if (list.length === 0 && !subject.trim() && !body.trim()) return;
    // draftUid is set when this composer was opened from an existing draft;
    // passing it replaces that copy instead of appending a second one
    onSaveDraft(
      list.join(", "),
      subject.trim(),
      body.trim(),
      currentAccount(),
      draftUid
    );
    resetCompose();
    setFolder("drafts");
  };

  return (
    <section className="pane relative flex h-full min-h-0 flex-col rounded-xl">
      {/* On mobile the bottom nav already says "Mail" — the header bar is
          dead space, so it's desktop-only and refresh moves down by the search box. */}
      <div className="hidden lg:block">
        <PaneHeader>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-(--color-clay)">
            <MailIcon />
          </span>
          <h2 className="font-display text-[16px] font-light uppercase tracking-[0.32em] text-white">
            Mail
          </h2>
          <button
            onClick={() => onRefresh(folder)}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh mail"
            className="ml-auto rounded-full border border-white/15 bg-white/5 p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-60"
          >
            <RefreshIcon className={refreshing ? "spin-slow" : ""} />
          </button>
        </PaneHeader>
      </div>

      {composing ? (
        /* ---------- COMPOSE ---------- */
        <div className="fade-slide flex min-h-0 flex-1 flex-col px-5 pt-4 pb-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-display text-[11px] font-normal uppercase tracking-[0.22em] text-(--color-ink-faint)">
              New message
            </p>
            <button
              onClick={resetCompose}
              className="text-xs font-medium text-(--color-ink-faint) hover:text-(--color-ink)"
            >
              Discard
            </button>
          </div>
          {multiAccount && (
            <div className="mb-2 flex items-center gap-2 border-b hairline px-1 pb-2">
              <span className="font-display text-[9px] font-medium uppercase tracking-[0.18em] text-(--color-ink-faint)">
                From
              </span>
              <div className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
                {accounts.map((a) => {
                  const current =
                    (fromAccount ||
                      (activeAccount !== "all" ? activeAccount : accounts[0])) === a;
                  return (
                    <button
                      key={a}
                      onClick={() => setFromAccount(a)}
                      title={a}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                        current
                          ? "border-(--color-ink) bg-(--color-ink) text-(--color-paper)"
                          : "hairline text-(--color-ink-soft) hover:border-(--color-ink-faint)"
                      }`}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: accountColor(accounts, a) }}
                      />
                      {accountLabel(a, accountLabels)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div
            onClick={() => toInput.current?.focus()}
            className="relative mb-2 flex w-full flex-wrap items-center gap-1.5 border-b hairline px-1 py-1.5 focus-within:border-(--color-clay)/50"
          >
            {recipients.map((r, i) => (
              <span
                key={`${r}-${i}`}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                  isEmail(r)
                    ? "hairline bg-(--color-paper) text-(--color-ink-soft)"
                    : "border-red-300 bg-red-50 text-red-600"
                }`}
                title={isEmail(r) ? r : `${r} — doesn't look like an address`}
              >
                {r}
                <button
                  aria-label={`Remove ${r}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRecipients((prev) => prev.filter((_, j) => j !== i));
                  }}
                  className="rounded-full px-0.5 text-(--color-ink-faint) transition-colors hover:text-red-500"
                >
                  ✕
                </button>
              </span>
            ))}
            <input
              ref={toInput}
              value={to}
              onChange={(e) => {
                // pasting a list commits everything but the last fragment
                if (/[,;]/.test(e.target.value)) {
                  const parts = e.target.value.split(/[,;]+/);
                  commitRecipients(parts.slice(0, -1).join(","));
                  setTo(parts[parts.length - 1].trimStart());
                } else setTo(e.target.value);
                setSugIndex(0);
                setSugOpen(true);
              }}
              onKeyDown={(e) => {
                const showing = sugOpen && suggestions.length > 0;
                if (e.key === "ArrowDown" && showing) {
                  e.preventDefault();
                  setSugIndex((i) => (i + 1) % suggestions.length);
                } else if (e.key === "ArrowUp" && showing) {
                  e.preventDefault();
                  setSugIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
                } else if (e.key === "Escape" && showing) {
                  setSugOpen(false);
                } else if (e.key === "Enter" || e.key === "Tab") {
                  if (showing) {
                    e.preventDefault();
                    pickSuggestion(suggestions[sugIndex]);
                  } else if (to.trim()) {
                    e.preventDefault();
                    commitRecipients(to);
                    setTo("");
                  }
                } else if (e.key === "Backspace" && !to) {
                  setRecipients((prev) => prev.slice(0, -1));
                }
              }}
              onBlur={() => {
                // let a click on a suggestion land before committing raw text
                setTimeout(() => {
                  setSugOpen(false);
                  setTo((cur) => {
                    if (cur.trim()) {
                      commitRecipients(cur);
                      return "";
                    }
                    return cur;
                  });
                }, 150);
              }}
              placeholder={recipients.length ? "" : "To"}
              className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-(--color-ink-faint)"
            />
            {sugOpen && suggestions.length > 0 && (
              <div className="absolute left-0 top-full z-30 mt-1 w-full overflow-hidden rounded-lg border hairline bg-white shadow-xl">
                {suggestions.map((c, i) => (
                  <button
                    key={c.email}
                    onMouseDown={(e) => {
                      // mousedown beats the input's onBlur timeout
                      e.preventDefault();
                      pickSuggestion(c);
                    }}
                    onMouseEnter={() => setSugIndex(i)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                      i === sugIndex ? "bg-(--color-clay-soft)" : "bg-white"
                    }`}
                  >
                    <Avatar
                      initials={(c.name || c.email)
                        .split(/[\s@.]+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase() ?? "")
                        .join("")}
                      hue="bg-(--color-paper) text-(--color-ink-soft)"
                      size="sm"
                    />
                    <span className="min-w-0">
                      {c.name && (
                        <span className="block truncate text-[13px] font-medium text-(--color-ink)">
                          {c.name}
                        </span>
                      )}
                      <span className="block truncate text-xs text-(--color-ink-faint)">
                        {c.email}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="mb-2 w-full border-b hairline bg-transparent px-1 py-2 text-sm font-medium outline-none placeholder:text-(--color-ink-faint) focus:border-(--color-clay)/50"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message…"
            className="nice-scroll min-h-0 flex-1 resize-none bg-transparent px-1 py-2 text-[13.5px] leading-relaxed outline-none placeholder:text-(--color-ink-faint)"
          />
          {attached.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {attached.map((a, i) => (
                <span
                  key={`${a.filename}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border hairline bg-(--color-paper) px-2.5 py-1.5 text-xs font-medium text-(--color-ink-soft)"
                >
                  <ClipIcon className="h-3.5 w-3.5 text-(--color-ink-faint)" />
                  <span className="max-w-[14rem] truncate">{a.filename}</span>
                  <span className="text-[10px] text-(--color-ink-faint)">
                    {Math.max(1, Math.round(a.size / 1024))} KB
                  </span>
                  <button
                    title="Remove attachment"
                    onClick={() =>
                      setAttached((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="ml-0.5 rounded px-1 text-(--color-ink-faint) transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={submitCompose}
              className="rounded-lg bg-(--color-clay) px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              Send ↗
            </button>
            {onScheduleSend && (
              <div className="relative">
                <button
                  onClick={() => setScheduleOpen((v) => !v)}
                  title="Schedule send"
                  aria-label="Schedule send"
                  className={`rounded-lg border p-2 transition-colors ${
                    scheduleOpen
                      ? "border-(--color-clay)/50 bg-(--color-clay-soft) text-(--color-clay)"
                      : "hairline text-(--color-ink-soft) hover:border-(--color-clay)/50 hover:text-(--color-clay)"
                  }`}
                >
                  <ClockIcon className="h-4 w-4" />
                </button>
                {scheduleOpen && (
                  <div className="rise-in absolute bottom-full left-0 z-30 mb-2 w-64 rounded-xl border hairline bg-white p-2 shadow-2xl">
                    <p className="px-2 pt-1 pb-1.5 font-display text-[9px] font-medium uppercase tracking-[0.2em] text-(--color-ink-faint)">
                      Send later
                    </p>
                    {schedulePresets().map((p) => (
                      <button
                        key={p.label}
                        onClick={() => submitScheduled(p.at)}
                        className="block w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium hover:bg-(--color-paper)"
                      >
                        {p.label}
                      </button>
                    ))}
                    <div className="mt-1 border-t hairline pt-2">
                      <p className="px-2 pb-1 font-display text-[9px] font-medium uppercase tracking-[0.2em] text-(--color-ink-faint)">
                        Pick a time
                      </p>
                      <div className="flex items-center gap-1.5 px-1">
                        <input
                          type="datetime-local"
                          value={scheduleCustom}
                          min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
                            .toISOString()
                            .slice(0, 16)}
                          onChange={(e) => setScheduleCustom(e.target.value)}
                          className="min-w-0 flex-1 rounded-lg border hairline bg-white px-2 py-1 text-xs outline-none focus:border-(--color-clay)/50"
                        />
                        <button
                          onClick={() => {
                            const d = new Date(scheduleCustom);
                            if (!Number.isNaN(d.getTime())) submitScheduled(d);
                          }}
                          disabled={!scheduleCustom}
                          className="shrink-0 rounded-lg bg-(--color-clay) px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
                        >
                          Schedule
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={saveDraft}
              className="rounded-lg border hairline px-3.5 py-2 text-[13px] font-semibold text-(--color-ink-soft) transition-colors hover:border-(--color-clay)/50 hover:text-(--color-clay)"
            >
              Save draft
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => pickFiles(e.target.files)}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={attaching}
              title="Attach files — any type"
              aria-label="Attach files"
              className="ml-auto rounded-lg border hairline p-2 text-(--color-ink-soft) transition-colors hover:border-(--color-clay)/50 hover:text-(--color-clay) disabled:opacity-60"
            >
              <ClipIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : !selected ? (
        /* ---------- LIST ---------- */
        <>
          {/* ---- mobile toolbar: burger · folder name · search · refresh ---- */}
          <div className="glass absolute inset-x-0 top-0 z-10 flex items-center gap-1.5 rounded-t-xl px-3 py-2 lg:hidden">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open mail menu"
              className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-(--color-ink-faint) transition-colors"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
              </svg>
            </button>
            {mobileSearchOpen ? (
              <div
                className="glass-btn flex min-w-0 flex-1 items-center gap-1 rounded-full pr-1"
              >
                <input
                  ref={mobileSearchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setQuery("");
                      setMobileSearchOpen(false);
                    }
                  }}
                  placeholder="Search mail…"
                  className="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-(--color-ink-faint)"
                />
                <button
                  onClick={() => {
                    setQuery("");
                    setMobileSearchOpen(false);
                  }}
                  aria-label="Close search"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-(--color-ink-faint)"
                >
                  ✕
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="min-w-0 flex-1 truncate text-left font-display text-[13px] font-medium uppercase tracking-[0.2em] text-(--color-ink)"
                >
                  {folders.find((f) => f.key === folder)?.label}
                  {multiAccount && activeAccount !== "all" && (
                    <span className="ml-2 inline-flex items-center gap-1 normal-case tracking-normal text-[11px] text-(--color-ink-faint)">
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: accountColor(accounts, activeAccount) }}
                      />
                      {accountLabel(activeAccount, accountLabels)}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setMobileSearchOpen(true)}
                  aria-label="Search mail"
                  className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-(--color-ink-faint) transition-colors"
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <circle cx="7" cy="7" r="4.5" />
                    <path d="M10.5 10.5L14 14" />
                  </svg>
                </button>
                <button
                  onClick={() => onRefresh(folder)}
                  disabled={refreshing}
                  aria-label="Refresh mail"
                  className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-(--color-ink-faint) transition-colors disabled:opacity-60"
                >
                  <RefreshIcon className={`h-4 w-4 ${refreshing ? "spin-slow" : ""}`} />
                </button>
              </>
            )}
          </div>

          {multiAccount && (
            <div className="no-scrollbar hidden items-center gap-1.5 overflow-x-auto px-5 pt-3 lg:flex">
              <button
                onClick={() => {
                  setAccount("all");
                  clearSelection();
                }}
                className={`shrink-0 rounded-full border px-2.5 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                  activeAccount === "all"
                    ? "border-(--color-ink) bg-(--color-ink) text-(--color-paper)"
                    : "hairline text-(--color-ink-soft) hover:border-(--color-ink-faint)"
                }`}
              >
                All inboxes
              </button>
              {accounts.map((a) => (
                <button
                  key={a}
                  onClick={() => setAccount(a)}
                  title={a}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                    activeAccount === a
                      ? "border-(--color-ink) bg-(--color-ink) text-(--color-paper)"
                      : "hairline text-(--color-ink-soft) hover:border-(--color-ink-faint)"
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: accountColor(accounts, a) }}
                  />
                  {accountLabel(a, accountLabels)}
                  {accountUnread(a) > 0 && (
                    <span
                      className={
                        activeAccount === a
                          ? "text-white/70"
                          : "text-(--color-ink-faint)"
                      }
                    >
                      {accountUnread(a)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="no-scrollbar hidden justify-between gap-2 overflow-x-auto px-5 pt-3 lg:flex">
            {folders.map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setFolder(f.key);
                  clearSelection();
                  onFolderChange(f.key);
                }}
                className={`shrink-0 border-b-2 pb-1.5 font-display text-[10px] font-medium uppercase tracking-[0.12em] transition-colors ${
                  folder === f.key
                    ? "border-(--color-clay) text-(--color-ink)"
                    : "border-transparent text-(--color-ink-faint) hover:text-(--color-ink-soft)"
                }`}
              >
                {f.label}
                {count(f.key) > 0 && (
                  <span className="ml-1 text-(--color-ink-faint)">
                    {count(f.key)}
                  </span>
                )}
              </button>
            ))}
          </div>
          {selecting && (
            <div className="mx-5 mt-[3.5rem] flex flex-wrap items-center gap-1.5 rounded-lg border border-(--color-clay)/40 bg-(--color-clay-soft)/40 px-2.5 py-2 lg:mt-3">
              <span className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-(--color-clay)">
                {selectedIds.size} selected
              </span>
              <button
                onClick={() =>
                  allSelected
                    ? clearSelection()
                    : setSelectedIds(new Set(filtered.map((e) => e.id)))
                }
                className="rounded-md border hairline bg-white px-2 py-1 text-[11px] font-medium text-(--color-ink-soft) transition-colors hover:border-(--color-clay)/50 hover:text-(--color-clay)"
              >
                {allSelected ? "Clear all" : `Select all ${filtered.length}`}
              </button>
              <span className="mx-0.5 h-4 w-px bg-(--color-clay)/25" />
              <button
                onClick={() => bulk((id) => onToggleStar(id))}
                title="Star"
                className="rounded-md p-1.5 text-(--color-ink-soft) transition-colors hover:bg-white hover:text-(--color-gold)"
              >
                <StarIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => bulk((id) => onMarkUnread(id))}
                title="Mark unread"
                className="rounded-md px-2 py-1 text-[11px] font-medium text-(--color-ink-soft) transition-colors hover:bg-white hover:text-(--color-clay)"
              >
                Unread
              </button>
              <button
                onClick={() => bulk((id) => onArchive(id))}
                title="Archive"
                className="rounded-md p-1.5 text-(--color-ink-soft) transition-colors hover:bg-white hover:text-(--color-clay)"
              >
                <ArchiveIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => bulk((id) => onSnooze(id, snoozeOptions[1]))}
                title={`Snooze until ${snoozeOptions[1]}`}
                className="rounded-md p-1.5 text-(--color-ink-soft) transition-colors hover:bg-white hover:text-(--color-clay)"
              >
                <ClockIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => bulk((id) => onDelete(id))}
                title="Delete"
                className="rounded-md p-1.5 text-(--color-ink-soft) transition-colors hover:bg-white hover:text-red-500"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
              <button
                onClick={clearSelection}
                aria-label="Cancel selection"
                className="ml-auto rounded-md px-2 py-1 text-[11px] font-medium text-(--color-ink-faint) transition-colors hover:text-(--color-ink)"
              >
                Cancel
              </button>
            </div>
          )}
          <div className="hidden px-5 pt-3 pb-2 lg:block">
            <div
              className={`flex items-center gap-1.5 rounded-lg border bg-white pr-1.5 transition-colors ${
                aiMode ? "border-(--color-clay)/50" : "hairline"
              }`}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  aiMode
                    ? "Ask your mail… “unread from maya with attachments”"
                    : "Search mail…"
                }
                className="min-w-0 flex-1 bg-transparent px-3.5 py-2 text-sm outline-none placeholder:text-(--color-ink-faint)"
              />
              <button
                onClick={() => setAiMode((v) => !v)}
                title={aiMode ? "AI search on — click for plain search" : "Switch to AI search"}
                className={`flex h-7 items-center gap-1 rounded-md px-2 font-display text-[9px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                  aiMode
                    ? "bg-(--color-clay) text-white"
                    : "bg-(--color-paper) text-(--color-ink-faint) hover:text-(--color-clay)"
                }`}
              >
                <SparkIcon className="h-3 w-3" /> AI
              </button>
            </div>
            {aiResult && (
              <div className="fade-slide mt-1.5 flex flex-wrap items-center gap-1.5">
                <SparkIcon className="h-3 w-3 text-(--color-clay)" />
                {aiResult.chips.length > 0 ? (
                  aiResult.chips.map((c) => (
                    <span
                      key={c}
                      className="rounded-full bg-(--color-clay-soft) px-2 py-0.5 font-display text-[9px] font-medium uppercase tracking-[0.12em] text-(--color-clay)"
                    >
                      {c}
                    </span>
                  ))
                ) : (
                  <span className="text-[10px] text-(--color-ink-faint)">
                    understanding your query…
                  </span>
                )}
                <span className="ml-auto text-[10px] text-(--color-ink-faint)">
                  {filtered.length} match{filtered.length === 1 ? "" : "es"}
                </span>
              </div>
            )}
          </div>
          <div
            onScroll={(e) => {
              if (!onLoadMore || loadingMore || noMoreMail) return;
              const el = e.currentTarget;
              // start fetching a screenful before the bottom
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 400)
                onLoadMore(folder);
            }}
            className={`nice-scroll min-h-0 flex-1 divide-y divide-(--color-line) overflow-y-auto px-5 pb-3 lg:pt-0 ${
              selecting ? "" : "pt-[3.25rem]"
            }`}
          >
            {filtered.map((email) => (
              <div
                key={email.id}
                onClick={() => {
                  // a draft reopens in the composer rather than a read view
                  if (email.folder === "drafts") {
                    setComposing(true);
                    setRecipients(splitAddresses(email.to ?? ""));
                    setTo("");
                    setSubject(email.subject === "(no subject)" ? "" : email.subject);
                    setBody(email.body.join("\n"));
                    setDraftUid(email.uid);
                    if (email.accountId) setFromAccount(email.accountId);
                    return;
                  }
                  onSelect(email.id);
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/tria-email", email.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                className={`group relative w-full cursor-pointer py-3.5 text-left transition-colors ${
                  selectedIds.has(email.id)
                    ? "bg-(--color-clay-soft)/40"
                    : "hover:bg-(--color-paper)/60"
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* the avatar becomes a checkbox on hover, or while selecting */}
                  <span
                    className="relative shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(email.id, e.shiftKey);
                    }}
                  >
                    <span
                      className={
                        selecting || selectedIds.has(email.id)
                          ? "hidden"
                          : "block group-hover:hidden"
                      }
                    >
                      <Avatar initials={email.from.initials} hue={email.from.hue} />
                    </span>
                    <span
                      title="Select"
                      className={`flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] transition-colors ${
                        selectedIds.has(email.id)
                          ? "border-(--color-clay) bg-(--color-clay) text-white"
                          : "border-(--color-ink-faint)/50 bg-white text-transparent hover:border-(--color-clay)"
                      } ${
                        selecting || selectedIds.has(email.id)
                          ? "flex"
                          : "hidden group-hover:flex"
                      }`}
                    >
                      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                        <path
                          d="M2.5 6.5l2.2 2.2L9.5 3.9"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-sm ${
                          email.read
                            ? "font-medium text-(--color-ink-soft)"
                            : "font-semibold"
                        }`}
                      >
                        {email.folder === "sent"
                          ? `To: ${email.to ?? ""}`
                          : email.from.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-(--color-ink-faint) transition-opacity group-hover:opacity-0">
                        {email.starred && (
                          <StarIcon
                            filled
                            className="h-3 w-3 text-(--color-gold)"
                          />
                        )}
                        {email.attachments && (
                          <ClipIcon className="h-3 w-3" />
                        )}
                        {multiAccount &&
                          activeAccount === "all" &&
                          email.accountId && (
                            <span
                              title={email.accountId}
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{
                                background: accountColor(
                                  accounts,
                                  email.accountId
                                ),
                              }}
                            />
                          )}
                        {email.time}
                      </span>
                    </div>
                    <p
                      className={`truncate text-[13px] ${
                        email.read ? "text-(--color-ink-soft)" : "font-medium"
                      }`}
                    >
                      {email.subject}
                    </p>
                    <p className="truncate text-xs text-(--color-ink-faint)">
                      {email.preview}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      {email.tag && <Tag label={email.tag} />}
                      {email.queued && (
                        <span className="inline-flex items-center gap-1 font-display text-[9px] font-medium uppercase tracking-[0.18em] text-(--color-gold)">
                          <ClockIcon className="h-2.5 w-2.5" /> Queued
                        </span>
                      )}
                      {email.replied && (
                        <span className="inline-flex items-center gap-1 font-display text-[9px] font-medium uppercase tracking-[0.18em] text-(--color-sage)">
                          <ReplyIcon className="h-2.5 w-2.5" /> Replied
                        </span>
                      )}
                      {email.taskId && (
                        <span className="inline-flex items-center gap-1 font-display text-[9px] font-medium uppercase tracking-[0.18em] text-(--color-clay)">
                          <SparkIcon className="h-2.5 w-2.5" /> Task
                        </span>
                      )}
                      {email.snoozedUntil && (
                        <span className="inline-flex items-center gap-1 font-display text-[9px] font-medium uppercase tracking-[0.18em] text-(--color-gold)">
                          <ClockIcon className="h-2.5 w-2.5" />{" "}
                          {email.snoozedUntil}
                        </span>
                      )}
                      {!email.read && email.folder === "inbox" && (
                        <span className="ml-auto h-2 w-2 rounded-full bg-(--color-clay)" />
                      )}
                    </div>
                  </div>
                </div>
                {/* hover quick actions */}
                <div className="absolute right-0 top-3 flex items-center gap-0.5 rounded-lg bg-white/95 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                  {folder === "inbox" && (
                    <>
                      <IconBtn
                        title="Reply"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(email.id);
                          setReplyOpen(true);
                        }}
                      >
                        <ReplyIcon className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn
                        title="Archive"
                        onClick={(e) => {
                          e.stopPropagation();
                          onArchive(email.id);
                        }}
                      >
                        <ArchiveIcon className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn
                        title="Snooze until tomorrow"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSnooze(email.id, "Tomorrow, 8 AM");
                        }}
                      >
                        <ClockIcon className="h-3.5 w-3.5" />
                      </IconBtn>
                    </>
                  )}
                  {(folder === "snoozed" ||
                    folder === "archive" ||
                    folder === "trash") && (
                    <IconBtn
                      title="Move to inbox"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRestore(email.id);
                      }}
                    >
                      <MailIcon className="h-3.5 w-3.5" />
                    </IconBtn>
                  )}
                  {folder !== "trash" && (
                    <IconBtn
                      danger
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(email.id);
                      }}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </IconBtn>
                  )}
                </div>
              </div>
            ))}
            {loadingMore && (
              <p className="py-4 text-center text-[11px] text-(--color-ink-faint)">
                Loading older mail…
              </p>
            )}
            {noMoreMail && filtered.length > 0 && (
              <p className="py-4 text-center text-[11px] text-(--color-ink-faint)">
                That's everything in this folder.
              </p>
            )}
            {filtered.length === 0 && (
              <div className="pt-16 text-center text-sm text-(--color-ink-faint)">
                Nothing in {folders.find((f) => f.key === folder)?.label}.
              </div>
            )}
          </div>
          {/* compose FAB */}
          <button
            onClick={() => setComposing(true)}
            title="Compose"
            className="absolute bottom-10 right-5 flex h-11 w-11 items-center justify-center rounded-full bg-(--color-clay) text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
          >
            <PenIcon />
          </button>
        </>
      ) : (
        /* ---------- DETAIL ---------- */
        <div className="fade-slide nice-scroll min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">
          <div className="mb-3 flex items-center justify-between">
            <button
              onClick={() => {
                closeDetailState();
                onBack();
              }}
              className="-ml-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-[15px] font-semibold text-(--color-ink-soft) transition-colors hover:bg-(--color-paper) hover:text-(--color-ink) lg:min-h-0 lg:text-xs lg:text-(--color-ink-faint)"
            >
              <span aria-hidden className="text-lg leading-none lg:text-xs">←</span> Back
            </button>
            <div className="relative flex items-center gap-0.5">
              <IconBtn
                title="Reply"
                onClick={() => {
                  setReplyOpen(true);
                  if (!replyText) setReplyText("");
                }}
              >
                <ReplyIcon className="h-4 w-4" />
              </IconBtn>
              <button
                title={selected.starred ? "Unstar" : "Star"}
                onClick={() => onToggleStar(selected.id)}
                className={`rounded-md p-1.5 transition-colors ${
                  selected.starred
                    ? "text-(--color-gold)"
                    : "text-(--color-ink-faint) hover:bg-(--color-gold-soft) hover:text-(--color-gold)"
                }`}
              >
                <StarIcon filled={selected.starred} className="h-4 w-4" />
              </button>
              <IconBtn
                title="Mark unread"
                onClick={() => onMarkUnread(selected.id)}
              >
                <MailIcon className="h-4 w-4" />
              </IconBtn>
              <IconBtn title="Archive" onClick={() => onArchive(selected.id)}>
                <ArchiveIcon className="h-4 w-4" />
              </IconBtn>
              <IconBtn
                title="Snooze"
                onClick={() => setSnoozeOpen((v) => !v)}
              >
                <ClockIcon className="h-4 w-4" />
              </IconBtn>
              <IconBtn
                danger
                title="Delete"
                onClick={() => onDelete(selected.id)}
              >
                <TrashIcon className="h-4 w-4" />
              </IconBtn>
              {snoozeOpen && (
                <div className="rise-in absolute right-0 top-9 z-10 w-40 rounded-lg border hairline bg-white p-1 shadow-lg">
                  <p className="px-2 py-1 font-display text-[9px] font-medium uppercase tracking-[0.18em] text-(--color-ink-faint)">
                    Snooze until
                  </p>
                  {snoozeOptions.map((o) => (
                    <button
                      key={o}
                      onClick={() => onSnooze(selected.id, o)}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-xs font-medium hover:bg-(--color-paper)"
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mb-4 flex items-start gap-3">
            <Avatar initials={selected.from.initials} hue={selected.from.hue} />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{selected.from.name}</p>
              <p className="flex items-center gap-1.5 text-xs text-(--color-ink-faint)">
                {/* tap to copy — the address is the thing people actually want off this line */}
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(selected.from.email).then(
                      () => {
                        setCopiedEmail(true);
                        setTimeout(() => setCopiedEmail(false), 1400);
                      },
                      () => {}
                    );
                  }}
                  title="Copy email address"
                  className="min-w-0 truncate select-all rounded px-0.5 text-left transition-colors hover:bg-(--color-paper) hover:text-(--color-ink)"
                >
                  {selected.from.email}
                </button>
                {copiedEmail && (
                  <span className="shrink-0 font-display text-[9px] font-semibold uppercase tracking-[0.14em] text-(--color-sage)">
                    Copied
                  </span>
                )}
                <span className="shrink-0">· {selected.time}</span>
              </p>
              {multiAccount && selected.accountId && (
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-(--color-ink-faint)">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: accountColor(accounts, selected.accountId),
                    }}
                  />
                  {selected.folder === "sent" ? "sent from" : "to"}{" "}
                  {selected.accountId}
                </p>
              )}
            </div>
          </div>
          <h3 className="font-display mb-4 text-2xl font-light leading-snug">
            {selected.subject}
          </h3>
          {selected.html ? (
            <div
              className="email-body text-[13.5px] leading-relaxed text-(--color-ink-soft)"
              // sanitized server-side in lib/mail/render.ts (allowlist; no
              // scripts/styles/handlers; remote images blocked)
              dangerouslySetInnerHTML={{ __html: selected.html }}
            />
          ) : (
            <div className="email-body space-y-3 text-[13.5px] leading-relaxed text-(--color-ink-soft)">
              {selected.body.length > 0 ? (
                selected.body.map((p, i) => <p key={i}>{p}</p>)
              ) : (
                <p className="text-(--color-ink-faint)">Loading message…</p>
              )}
            </div>
          )}

          {selected.attachments && (
            <div className="mt-4 flex flex-wrap gap-2">
              {selected.attachments.map((a) => {
                // live mail carries the part id, which is what lets us fetch it
                const openable = Boolean(a.part && selected.uid);
                const url = openable
                  ? `/api/mail/attachment?role=${selected.folder}&uid=${selected.uid}&part=${encodeURIComponent(
                      a.part!
                    )}${
                      selected.accountId
                        ? `&account=${encodeURIComponent(selected.accountId)}`
                        : ""
                    }`
                  : "";
                return (
                  <button
                    key={a.name}
                    disabled={!openable}
                    title={openable ? `Open ${a.name}` : a.name}
                    onClick={() =>
                      openable &&
                      setViewing({ name: a.name, url, contentType: a.contentType })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border hairline bg-(--color-paper) px-2.5 py-1.5 text-xs font-medium text-(--color-ink-soft) transition-colors enabled:hover:border-(--color-clay)/50 enabled:hover:text-(--color-clay) disabled:cursor-default"
                  >
                    <ClipIcon className="h-3.5 w-3.5 text-(--color-ink-faint)" />
                    {a.name}
                    {a.size && (
                      <span className="text-[10px] text-(--color-ink-faint)">
                        {a.size}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-6 grid grid-cols-3 gap-2 border-t hairline pt-4">
            {!selected.taskId ? (
              <button
                onClick={() => onMakeTask(selected)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-(--color-clay) px-2 py-2.5 text-[12px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <SparkIcon /> Smart Task
              </button>
            ) : (
              <button
                onClick={() => onViewTask(selected.taskId!)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-(--color-clay-soft) px-2 py-2.5 text-[12px] font-semibold text-(--color-clay) transition-transform hover:scale-[1.02]"
              >
                <SparkIcon /> View Task
              </button>
            )}
            <button
              onClick={() => onSendToAi(selected)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-(--color-ink) px-2 py-2.5 text-[12px] font-semibold text-(--color-paper) shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <SparkIcon /> Take to AI
            </button>
            <button
              onClick={() => onShareToThread(selected)}
              className="inline-flex items-center justify-center rounded-lg border hairline bg-white px-2 py-2.5 text-[12px] font-semibold text-(--color-ink-soft) transition-colors hover:border-(--color-ink-faint)"
            >
              Share ↗
            </button>
          </div>

          {/* reply composer */}
          {replyOpen ? (
            <div className="rise-in mt-4 rounded-xl border hairline bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-display text-[10px] font-medium uppercase tracking-[0.2em] text-(--color-ink-faint)">
                  Reply to {selected.from.name}
                </p>
                <button
                  onClick={() => setReplyText(draftReply(selected))}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-(--color-clay) hover:opacity-70"
                >
                  <SparkIcon className="h-3 w-3" /> AI draft
                </button>
              </div>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Write to ${selected.from.name.split(" ")[0]}…`}
                rows={4}
                // desktop only: on a phone auto-focus yanks the keyboard up
                // and covers the message you're replying to
                autoFocus={
                  typeof window !== "undefined" &&
                  window.matchMedia("(min-width: 1024px)").matches
                }
                className="nice-scroll w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-(--color-ink-faint)"
              />
              <div className="mt-2 flex items-center justify-between">
                <button
                  onClick={() => {
                    setReplyOpen(false);
                    setReplyText("");
                  }}
                  className="text-xs font-medium text-(--color-ink-faint) hover:text-(--color-ink)"
                >
                  Discard
                </button>
                <button
                  onClick={submitReply}
                  className="rounded-lg bg-(--color-clay) px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  Send ↗
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setReplyOpen(true)}
              className="mt-4 flex w-full items-center gap-2 rounded-xl border hairline bg-white px-3.5 py-2.5 text-left text-[13px] text-(--color-ink-faint) transition-colors hover:border-(--color-clay)/40"
            >
              <ReplyIcon className="h-3.5 w-3.5" />
              Reply to {selected.from.name.split(" ")[0]}…
            </button>
          )}
        </div>
      )}

      {/* Attachment viewer — images and PDFs render, anything else downloads */}
      {viewing && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4"
          onClick={() => setViewing(null)}
        >
          <div className="mb-3 flex shrink-0 items-center gap-3">
            <ClipIcon className="h-4 w-4 shrink-0 text-white/60" />
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">
              {viewing.name}
            </p>
            <a
              href={viewing.url}
              download={viewing.name}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 rounded-lg border border-white/20 px-3 py-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              Download
            </a>
            <button
              onClick={() => setViewing(null)}
              aria-label="Close attachment"
              className="shrink-0 rounded-lg border border-white/20 px-3 py-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div
            onClick={(e) => e.stopPropagation()}
            className="min-h-0 flex-1 overflow-auto rounded-xl bg-white"
          >
            {/^image\//i.test(viewing.contentType ?? "") ||
            /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(viewing.name) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={viewing.url}
                alt={viewing.name}
                className="mx-auto max-h-full max-w-full object-contain"
              />
            ) : /pdf/i.test(viewing.contentType ?? "") ||
              /\.pdf$/i.test(viewing.name) ? (
              <iframe
                src={viewing.url}
                title={viewing.name}
                className="h-full w-full"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <ClipIcon className="h-6 w-6 text-(--color-ink-faint)" />
                <p className="text-sm font-medium">
                  This file type can&apos;t be previewed in the browser.
                </p>
                <p className="text-xs text-(--color-ink-faint)">
                  Word documents and other formats open in their own app.
                </p>
                <a
                  href={viewing.url}
                  download={viewing.name}
                  className="mt-1 rounded-lg bg-(--color-clay) px-4 py-2 text-[13px] font-semibold text-white"
                >
                  Download {viewing.name}
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      <MailDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        folders={folders}
        folder={folder}
        folderCount={count}
        onSelectFolder={(f) => {
          setFolder(f);
          clearSelection();
          onFolderChange(f);
        }}
        accounts={accounts}
        accountLabel={(a) => accountLabel(a, accountLabels)}
        accountColor={(a) => accountColor(accounts, a)}
        accountUnread={accountUnread}
        activeAccount={activeAccount}
        onSelectAccount={(a) => {
          setAccount(a);
          clearSelection();
        }}
        onOpenSettings={() => onOpenSettings?.()}
        live={accounts.length > 0}
        userName={userName}
      />
    </section>
  );
}
