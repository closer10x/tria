"use client";

import { useEffect, useRef, useState } from "react";
import { Email, Folder, OutgoingAttachment } from "@/lib/types";
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
  onSaveDraft: (
    to: string,
    subject: string,
    body: string,
    fromAccount?: string
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
  // which account's mail to show — "all" is the unified view
  const [account, setAccount] = useState<string>("all");
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState("");
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

  // an undone send (or a reopened draft) puts its text back in the composer
  useEffect(() => {
    if (!restoreDraft) return;
    if (restoreDraft.kind === "reply") {
      setReplyOpen(true);
      setReplyText(restoreDraft.text);
    } else {
      setComposing(true);
      setTo(restoreDraft.to);
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
  const aiResult =
    aiMode && query.trim() ? aiSearch(query, inFolder) : null;
  const filtered = aiResult
    ? aiResult.results
    : inFolder.filter(
        (e) =>
          e.subject.toLowerCase().includes(query.toLowerCase()) ||
          e.from.name.toLowerCase().includes(query.toLowerCase())
      );

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

  const submitCompose = () => {
    if (!to.trim() || (!subject.trim() && !body.trim())) return;
    onComposeSend(
      to.trim(),
      subject.trim(),
      body.trim(),
      accounts.length
        ? fromAccount || (activeAccount !== "all" ? activeAccount : accounts[0])
        : undefined,
      attached
    );
    setComposing(false);
    setAttached([]);
    setTo("");
    setSubject("");
    setBody("");
    setDraftUid(undefined);
    setFolder("sent");
  };

  const currentAccount = () =>
    accounts.length
      ? fromAccount || (activeAccount !== "all" ? activeAccount : accounts[0])
      : undefined;

  const saveDraft = () => {
    if (!to.trim() && !subject.trim() && !body.trim()) return;
    onSaveDraft(to.trim(), subject.trim(), body.trim(), currentAccount());
    setComposing(false);
    setAttached([]);
    setTo("");
    setSubject("");
    setBody("");
    setDraftUid(undefined);
    setFolder("drafts");
  };

  return (
    <section className="pane relative flex h-full min-h-0 flex-col rounded-xl">
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

      {composing ? (
        /* ---------- COMPOSE ---------- */
        <div className="fade-slide flex min-h-0 flex-1 flex-col px-5 pt-4 pb-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-display text-[11px] font-normal uppercase tracking-[0.22em] text-(--color-ink-faint)">
              New message
            </p>
            <button
              onClick={() => setComposing(false)}
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
              <div className="nice-scroll flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
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
                          ? "border-(--color-ink) bg-(--color-ink) text-white"
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
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="To"
            className="mb-2 w-full border-b hairline bg-transparent px-1 py-2 text-sm outline-none placeholder:text-(--color-ink-faint) focus:border-(--color-clay)/50"
          />
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
          {multiAccount && (
            <div className="nice-scroll flex items-center gap-1.5 overflow-x-auto px-5 pt-3">
              <button
                onClick={() => setAccount("all")}
                className={`shrink-0 rounded-full border px-2.5 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                  activeAccount === "all"
                    ? "border-(--color-ink) bg-(--color-ink) text-white"
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
                      ? "border-(--color-ink) bg-(--color-ink) text-white"
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
          <div className="flex justify-between gap-2 overflow-x-auto px-5 pt-3">
            {folders.map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setFolder(f.key);
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
          <div className="px-5 pt-3 pb-2">
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
            className="nice-scroll min-h-0 flex-1 divide-y divide-(--color-line) overflow-y-auto px-5 pb-3"
          >
            {filtered.map((email) => (
              <div
                key={email.id}
                onClick={() => {
                  // a draft reopens in the composer rather than a read view
                  if (email.folder === "drafts") {
                    setComposing(true);
                    setTo(email.to ?? "");
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
                className="group relative w-full cursor-pointer py-3.5 text-left transition-colors hover:bg-(--color-paper)/60"
              >
                <div className="flex items-start gap-3">
                  <Avatar initials={email.from.initials} hue={email.from.hue} />
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
              className="inline-flex items-center gap-1 text-xs font-semibold text-(--color-ink-faint) transition-colors hover:text-(--color-ink)"
            >
              ← Back
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
            <div>
              <p className="text-sm font-semibold">{selected.from.name}</p>
              <p className="text-xs text-(--color-ink-faint)">
                {selected.from.email} · {selected.time}
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
          <div className="space-y-3 text-[13.5px] leading-relaxed text-(--color-ink-soft)">
            {selected.body.length > 0 ? (
              selected.body.map((p, i) => <p key={i}>{p}</p>)
            ) : (
              <p className="text-(--color-ink-faint)">Loading message…</p>
            )}
          </div>

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

          <div className="mt-6 flex flex-wrap gap-2 border-t hairline pt-4">
            {!selected.taskId ? (
              <button
                onClick={() => onMakeTask(selected)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-(--color-clay) px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <SparkIcon /> Make Smart Task
              </button>
            ) : (
              <button
                onClick={() => onViewTask(selected.taskId!)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-(--color-clay-soft) px-3.5 py-2 text-[13px] font-semibold text-(--color-clay) transition-transform hover:scale-[1.02]"
              >
                <SparkIcon /> View Smart Task →
              </button>
            )}
            <button
              onClick={() => onSendToAi(selected)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-(--color-ink) px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <SparkIcon /> Take to AI
            </button>
            <button
              onClick={() => onShareToThread(selected)}
              className="rounded-lg border hairline bg-white px-3.5 py-2 text-[13px] font-semibold text-(--color-ink-soft) transition-colors hover:border-(--color-ink-faint)"
            >
              Share to thread ↗
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
                autoFocus
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
    </section>
  );
}
