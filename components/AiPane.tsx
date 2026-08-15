"use client";

import { useEffect, useRef, useState } from "react";
import { AiMessage, Attachment, Email, Task } from "@/lib/types";
import { ClipIcon, SparkIcon } from "./ui";
import AttachmentCard from "./AttachmentCard";
import { filePickerHandler, pendingLabel } from "./ChatPane";

export default function AiPane({
  messages,
  emails,
  tasks,
  thinking,
  pendingAttachment,
  onSend,
  onSetPending,
}: {
  messages: AiMessage[];
  emails: Email[];
  tasks: Task[];
  thinking: boolean;
  pendingAttachment: Attachment | null;
  onSend: (text: string) => void;
  onSetPending: (a: Attachment | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, thinking]);

  const send = (text?: string) => {
    const t = (text ?? draft).trim();
    if (!t && !pendingAttachment) return;
    onSend(t);
    setDraft("");
    setAttachOpen(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        className="nice-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {messages.map((m) => {
          const mine = m.role === "user";
          return (
            <div
              key={m.id}
              className={`mb-3 flex ${mine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                  mine
                    ? "rounded-br-md bg-(--color-ink) text-white"
                    : "rounded-bl-md border border-(--color-clay)/20 bg-white"
                }`}
              >
                {!mine && (
                  <p className="mb-0.5 flex items-center gap-1 text-[10px] font-bold text-(--color-clay)">
                    <SparkIcon className="h-2.5 w-2.5" /> Assistant
                  </p>
                )}
                {m.text &&
                  m.text.split("\n").map((line, i) => (
                    <p key={i} className={i > 0 ? "mt-1.5" : ""}>
                      {line}
                    </p>
                  ))}
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
        {thinking && (
          <div className="mb-3 flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-(--color-clay)/20 bg-white px-3.5 py-3">
              <SparkIcon className="h-3 w-3 text-(--color-clay)" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-(--color-clay)" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-(--color-clay)" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-(--color-clay)" />
            </div>
          </div>
        )}
      </div>

      {/* quick prompts */}
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-2">
        {["Summarize my unread", "What's due this week?", "Draft a reply"].map(
          (q) => (
            <button
              key={q}
              onClick={() => send(q)}
              className="shrink-0 rounded-full border hairline bg-white px-3 py-1 text-[11px] font-medium text-(--color-ink-soft) transition-colors hover:border-(--color-clay)/40 hover:text-(--color-clay)"
            >
              {q}
            </button>
          )
        )}
      </div>

      <div className="border-t hairline p-3">
        {pendingAttachment && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-(--color-clay-soft)/60 px-3 py-1.5">
            <span className="text-[11px] font-semibold text-(--color-clay)">
              {pendingLabel(pendingAttachment)} ready for AI
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
              Give AI a smart task
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
              Give AI an email
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
            title="Give AI an email or task"
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
            placeholder="Ask AI anything…"
            className="min-w-0 flex-1 rounded-xl border hairline bg-white px-3.5 py-2 text-sm outline-none placeholder:text-(--color-ink-faint) focus:border-(--color-clay)/40"
          />
          <button
            onClick={() => send()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--color-ink) text-white shadow-sm transition-transform hover:scale-105 active:scale-95"
            title="Send"
          >
            <SparkIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
