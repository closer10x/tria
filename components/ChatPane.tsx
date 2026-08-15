"use client";

import { useEffect, useRef, useState } from "react";
import { Attachment, Email, Task, Thread } from "@/lib/types";
import AttachmentCard from "./AttachmentCard";
import { ArchiveIcon, ChatIcon, ClipIcon, TrashIcon } from "./ui";
import { useArmedConfirm } from "./useArmedConfirm";

export function filePickerHandler(
  onSetPending: (a: Attachment) => void,
  close: () => void
) {
  return (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).map((f) => ({
      name: f.name,
      size: `${Math.max(1, Math.round(f.size / 1024))} KB`,
    }));
    if (files.length) {
      onSetPending({ type: "file", files });
      close();
    }
    e.target.value = "";
  };
}

export function pendingLabel(a: Attachment): string {
  if (a.type === "task") return "✦ Task";
  if (a.type === "email") return "✉ Email";
  return `${a.files.length} file${a.files.length > 1 ? "s" : ""}`;
}

export default function ChatPane({
  threads,
  emails,
  tasks,
  activeThreadId,
  pendingAttachment,
  typingIn,
  selfName,
  onlineUsers,
  onOpenThread,
  onBack,
  onSend,
  onSetPending,
  onTyping,
  onChangeSelfName,
  onCreateThread,
  onArchiveThread,
  onRestoreThread,
  onDeleteThread,
}: {
  threads: Thread[];
  emails: Email[];
  tasks: Task[];
  activeThreadId: string | null;
  pendingAttachment: Attachment | null;
  typingIn: { threadId: string; author: string } | null;
  /** This device's chat identity — decides which bubbles render as "mine". */
  selfName: string;
  /** Display names currently connected to the realtime channel. */
  onlineUsers: string[];
  onOpenThread: (id: string) => void;
  onBack: () => void;
  onSend: (text: string) => void;
  onSetPending: (a: Attachment | null) => void;
  /** Called while the user types — feeds the realtime typing indicator. */
  onTyping?: () => void;
  onChangeSelfName: (name: string) => void;
  onCreateThread: (name: string) => void;
  onArchiveThread: (id: string) => void;
  onRestoreThread: (id: string) => void;
  /** Permanent — the row arms a confirm before calling this. */
  onDeleteThread: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [newThreadName, setNewThreadName] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const confirmDelete = useArmedConfirm();
  const scrollRef = useRef<HTMLDivElement>(null);
  const active = threads.find((t) => t.id === activeThreadId) ?? null;
  const liveThreads = threads.filter((t) => !t.archived);
  const archivedThreads = threads.filter((t) => t.archived);
  const online = new Set(onlineUsers);
  // legacy messages predate identities and were always the workspace owner's
  const isMine = (author: string) => author === selfName || author === "me";

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [active?.messages.length, typingIn, activeThreadId]);

  const send = () => {
    if (!draft.trim() && !pendingAttachment) return;
    onSend(draft.trim());
    setDraft("");
    setAttachOpen(false);
  };

  const startThread = () => {
    if (!newThreadName.trim()) return;
    onCreateThread(newThreadName.trim());
    setNewThreadName("");
    setNewThreadOpen(false);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {!active ? (
        <div className="nice-scroll min-h-0 flex-1 divide-y divide-(--color-line) overflow-y-auto px-5 pt-1 pb-3">
          {/* who you are + who's here */}
          <div className="flex items-center gap-2 py-2.5">
            {editingName ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (nameDraft.trim()) onChangeSelfName(nameDraft.trim());
                  setEditingName(false);
                }}
              >
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Your name"
                  className="min-w-0 flex-1 rounded-lg border hairline bg-white px-2.5 py-1 text-xs outline-none focus:border-(--color-clay)/50"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-lg bg-(--color-clay) px-2.5 py-1 text-[11px] font-semibold text-white"
                >
                  Save
                </button>
              </form>
            ) : (
              <button
                onClick={() => {
                  setNameDraft(selfName);
                  setEditingName(true);
                }}
                title="Change your chat name"
                className="flex min-w-0 items-center gap-1.5 text-[11px] text-(--color-ink-faint) transition-colors hover:text-(--color-ink)"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-(--color-sage)" />
                Chatting as{" "}
                <span className="font-semibold text-(--color-ink-soft)">
                  {selfName || "…"}
                </span>
              </button>
            )}
            <span className="ml-auto shrink-0 text-[10px] text-(--color-ink-faint)">
              {onlineUsers.length} online
            </span>
          </div>
          {liveThreads.length === 0 && archivedThreads.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
              <ChatIcon className="h-5 w-5 text-(--color-ink-faint)" />
              <p className="text-xs text-(--color-ink-faint)">
                No conversations yet.
              </p>
              <p className="text-[11px] leading-relaxed text-(--color-ink-faint)">
                Start one with + New, or share an email or a task.
              </p>
            </div>
          )}
          {liveThreads.map((thread) => {
            const last = thread.messages[thread.messages.length - 1];
            return (
              <div
                key={thread.id}
                onClick={() => onOpenThread(thread.id)}
                onMouseLeave={() =>
                  confirmDelete.isArmed(thread.id) && confirmDelete.disarm()
                }
                className="group relative w-full cursor-pointer py-3.5 text-left transition-colors hover:bg-(--color-paper)/60"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--color-paper) text-base">
                    {thread.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">
                        {thread.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-(--color-ink-faint) transition-opacity group-hover:opacity-0">
                        {last?.time}
                      </span>
                    </div>
                    <p className="truncate text-xs text-(--color-ink-soft)">
                      {last
                        ? `${isMine(last.author) ? "You" : last.author}: ${
                            last.text || "shared an item"
                          }`
                        : "No messages yet"}
                    </p>
                  </div>
                </div>
                {/* hover quick actions — same pattern as the mail rows */}
                <div className="absolute right-0 top-3 flex items-center gap-0.5 rounded-lg bg-white/95 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                  <button
                    title="Archive thread"
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchiveThread(thread.id);
                    }}
                    className="rounded-md p-1.5 text-(--color-ink-faint) transition-colors hover:bg-(--color-clay-soft) hover:text-(--color-clay)"
                  >
                    <ArchiveIcon className="h-3.5 w-3.5" />
                  </button>
                  {confirmDelete.isArmed(thread.id) ? (
                    <button
                      title="Click again to permanently delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete.disarm();
                        onDeleteThread(thread.id);
                      }}
                      className="rounded-md bg-red-50 px-2 py-1 text-[10px] font-bold text-red-600"
                    >
                      Sure?
                    </button>
                  ) : (
                    <button
                      title="Delete thread"
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete.arm(thread.id);
                      }}
                      className="rounded-md p-1.5 text-(--color-ink-faint) transition-colors hover:bg-red-50 hover:text-red-500"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {archivedThreads.length > 0 && (
            <div className="pt-2">
              <button
                onClick={() => setArchivedOpen((v) => !v)}
                className="w-full py-2 text-left font-display text-[10px] font-medium uppercase tracking-[0.18em] text-(--color-ink-faint) transition-colors hover:text-(--color-ink-soft)"
              >
                {archivedOpen ? "▾" : "▸"} Archived · {archivedThreads.length}
              </button>
              {archivedOpen &&
                archivedThreads.map((thread) => (
                  <div
                    key={thread.id}
                    className="flex items-center gap-3 py-2 opacity-70"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--color-paper) text-sm">
                      {thread.emoji}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {thread.name}
                    </span>
                    <button
                      onClick={() => onRestoreThread(thread.id)}
                      className="shrink-0 rounded-md px-2 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.12em] text-(--color-ink-faint) transition-colors hover:bg-(--color-clay-soft) hover:text-(--color-clay)"
                    >
                      Restore
                    </button>
                    <button
                      title="Delete permanently"
                      onClick={() =>
                        confirmDelete.isArmed(thread.id)
                          ? (confirmDelete.disarm(), onDeleteThread(thread.id))
                          : confirmDelete.arm(thread.id)
                      }
                      className={`shrink-0 rounded-md p-1.5 transition-colors ${
                        confirmDelete.isArmed(thread.id)
                          ? "bg-red-50 text-red-600"
                          : "text-(--color-ink-faint) hover:bg-red-50 hover:text-red-500"
                      }`}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b hairline px-5 pt-3 pb-3">
            <button
              onClick={onBack}
              className="text-xs font-semibold text-(--color-ink-faint) transition-colors hover:text-(--color-ink)"
            >
              ←
            </button>
            <span className="text-base">{active.emoji}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-none">{active.name}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-(--color-ink-faint)">
                {active.members.map((m) => (
                  <span key={m} className="inline-flex items-center gap-1">
                    <span
                      title={online.has(m) ? "online" : "offline"}
                      className={`h-1.5 w-1.5 rounded-full ${
                        online.has(m) || (isMine(m) && selfName)
                          ? "bg-(--color-sage)"
                          : "bg-(--color-ink-faint)/40"
                      }`}
                    />
                    {isMine(m) ? "You" : m}
                  </span>
                ))}
              </p>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="nice-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4"
          >
            {active.messages.map((m) => {
              const mine = isMine(m.author);
              return (
                <div
                  key={m.id}
                  className={`mb-3 flex ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                      mine
                        ? "rounded-br-md bg-(--color-clay) text-white"
                        : "rounded-bl-md border hairline bg-white"
                    }`}
                  >
                    {!mine && (
                      <p className="mb-0.5 text-[10px] font-bold text-(--color-clay)">
                        {m.author}
                      </p>
                    )}
                    {m.text && <p>{m.text}</p>}
                    {m.attachment && (
                      <AttachmentCard
                        attachment={m.attachment}
                        emails={emails}
                        tasks={tasks}
                      />
                    )}
                    <p
                      className={`mt-1 text-right text-[9px] ${
                        mine ? "text-white/60" : "text-(--color-ink-faint)"
                      }`}
                    >
                      {m.time}
                    </p>
                  </div>
                </div>
              );
            })}
            {typingIn?.threadId === active.id && (
              <div className="mb-3 flex justify-start">
                <div className="rounded-2xl rounded-bl-md border hairline bg-white px-3.5 py-2">
                  <p className="mb-1 text-[10px] font-bold text-(--color-clay)">
                    {typingIn.author}
                  </p>
                  <div className="flex items-center gap-1 pb-1">
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-(--color-ink-faint)" />
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-(--color-ink-faint)" />
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-(--color-ink-faint)" />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t hairline p-3">
            {pendingAttachment && (
              <div className="mb-2 flex items-center justify-between rounded-lg bg-(--color-clay-soft)/60 px-3 py-1.5">
                <span className="text-[11px] font-semibold text-(--color-clay)">
                  {pendingLabel(pendingAttachment)} attached
                </span>
                <button
                  onClick={() => onSetPending(null)}
                  className="text-[11px] font-bold text-(--color-clay) hover:opacity-70"
                >
                  ✕
                </button>
              </div>
            )}
            {attachOpen && (
              <div className="rise-in mb-2 max-h-44 overflow-y-auto rounded-xl border hairline bg-white p-2 shadow-lg">
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-(--color-ink-soft) hover:bg-(--color-paper)">
                  <ClipIcon className="h-3.5 w-3.5" /> Upload from computer…
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={filePickerHandler(onSetPending, () =>
                      setAttachOpen(false)
                    )}
                  />
                </label>
                <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-(--color-ink-faint)">
                  Attach a smart task
                </p>
                {tasks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      onSetPending({ type: "task", refId: t.id });
                      setAttachOpen(false);
                    }}
                    className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs font-medium hover:bg-(--color-clay-soft)/50"
                  >
                    <span className="text-(--color-clay)">✦</span> {t.title}
                  </button>
                ))}
                <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-(--color-ink-faint)">
                  Attach an email
                </p>
                {emails.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => {
                      onSetPending({ type: "email", refId: e.id });
                      setAttachOpen(false);
                    }}
                    className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs font-medium hover:bg-(--color-paper)"
                  >
                    ✉ {e.subject}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAttachOpen((v) => !v)}
                title="Attach email or task"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-lg font-medium transition-colors ${
                  attachOpen
                    ? "border-(--color-clay)/40 bg-(--color-clay-soft) text-(--color-clay)"
                    : "hairline bg-white text-(--color-ink-faint) hover:text-(--color-clay)"
                }`}
              >
                +
              </button>
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (e.target.value.trim()) onTyping?.();
                }}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={`Message ${active.name}…`}
                className="min-w-0 flex-1 rounded-xl border hairline bg-white px-3.5 py-2 text-sm outline-none placeholder:text-(--color-ink-faint) focus:border-(--color-clay)/40"
              />
              <button
                onClick={send}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--color-clay) text-white shadow-sm transition-transform hover:scale-105 active:scale-95"
                title="Send"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
                  <path d="M1.7 8L14.5 1.8c.5-.2.9.3.7.8L10.5 14.5c-.2.5-.9.5-1.1 0L7.6 9.9c-.1-.2-.2-.3-.4-.4L1.7 8z" />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}

      {/* new-conversation FAB + starter popover — matches Mail compose / Tasks brain-dump */}
      {!active && !newThreadOpen && (
        <button
          onClick={() => setNewThreadOpen(true)}
          title="New conversation"
          aria-label="New conversation"
          className="absolute bottom-10 right-5 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-(--color-clay) text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
        >
          <ChatIcon className="h-[18px] w-[18px]" />
        </button>
      )}
      {!active && newThreadOpen && (
        <div className="rise-in absolute bottom-10 right-5 z-30 w-[min(22rem,calc(100%-2.5rem))] rounded-xl border hairline bg-white p-2.5 shadow-2xl">
          <p className="mb-1.5 font-display text-[10px] font-medium uppercase tracking-[0.2em] text-(--color-ink-faint)">
            New conversation
          </p>
          <input
            autoFocus
            value={newThreadName}
            onChange={(e) => setNewThreadName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setNewThreadOpen(false);
              if (e.key === "Enter") startThread();
            }}
            placeholder="Thread name — e.g. Launch crew"
            className="w-full rounded-lg border hairline bg-white px-2.5 py-2 text-sm outline-none placeholder:text-(--color-ink-faint) focus:border-(--color-clay)/50"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={startThread}
              disabled={!newThreadName.trim()}
              className="flex-1 rounded-lg bg-(--color-clay) px-3 py-1.5 text-[12px] font-semibold text-white transition-transform hover:scale-[1.01] disabled:opacity-50"
            >
              Start
            </button>
            <button
              onClick={() => setNewThreadOpen(false)}
              className="rounded-lg border hairline px-3 py-1.5 text-[12px] font-semibold text-(--color-ink-soft) transition-colors hover:border-(--color-ink-faint)"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
