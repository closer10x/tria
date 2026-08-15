"use client";

import { useEffect, useRef, useState } from "react";
import { Attachment, Email, Task, Thread } from "@/lib/types";
import AttachmentCard from "./AttachmentCard";
import { ClipIcon } from "./ui";

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
  onOpenThread,
  onBack,
  onSend,
  onSetPending,
}: {
  threads: Thread[];
  emails: Email[];
  tasks: Task[];
  activeThreadId: string | null;
  pendingAttachment: Attachment | null;
  typingIn: string | null;
  onOpenThread: (id: string) => void;
  onBack: () => void;
  onSend: (text: string) => void;
  onSetPending: (a: Attachment | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const active = threads.find((t) => t.id === activeThreadId) ?? null;

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!active ? (
        <div className="nice-scroll min-h-0 flex-1 divide-y divide-(--color-line) overflow-y-auto px-5 pt-1 pb-3">
          {threads.map((thread) => {
            const last = thread.messages[thread.messages.length - 1];
            return (
              <button
                key={thread.id}
                onClick={() => onOpenThread(thread.id)}
                className="w-full py-3.5 text-left transition-colors hover:bg-(--color-paper)/60"
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
                      <span className="shrink-0 text-[11px] text-(--color-ink-faint)">
                        {last?.time}
                      </span>
                    </div>
                    <p className="truncate text-xs text-(--color-ink-soft)">
                      {last
                        ? `${last.author === "me" ? "You" : last.author}: ${
                            last.text || "shared an item"
                          }`
                        : "No messages yet"}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
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
            <div>
              <p className="text-sm font-semibold leading-none">{active.name}</p>
              <p className="mt-0.5 text-[11px] text-(--color-ink-faint)">
                {active.members.join(" · ")}
              </p>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="nice-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4"
          >
            {active.messages.map((m) => {
              const mine = m.author === "me";
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
            {typingIn === active.id && (
              <div className="mb-3 flex justify-start">
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border hairline bg-white px-3.5 py-3">
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-(--color-ink-faint)" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-(--color-ink-faint)" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-(--color-ink-faint)" />
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
                onChange={(e) => setDraft(e.target.value)}
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
    </div>
  );
}
