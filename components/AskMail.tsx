"use client";

import { useEffect, useRef, useState } from "react";
import { AiMailAnswer, apiAskMail } from "@/lib/mailApi";
import { Email } from "@/lib/types";
import { SparkIcon } from "./ui";

/**
 * "Ask your mail" — a natural-language question goes to Claude, which runs
 * real searches over the mailbox and answers with citations that open in the
 * reader. Renders as a bottom sheet on phones and a popover on desktop.
 */

const SUGGESTIONS = [
  "What did Sophia send me this week?",
  "Any invoices I haven't paid?",
  "Find the contract from the title company",
  "What's the latest on the grand opening?",
  "Summarize unread emails from today",
];

type Turn =
  | { role: "user"; text: string }
  | { role: "ai"; text: string; citations: AiMailAnswer["citations"]; messages: Email[] }
  | { role: "error"; text: string };

export default function AskMail({
  open,
  onClose,
  account,
  onOpenEmail,
}: {
  open: boolean;
  onClose: () => void;
  /** "all" or one account address — scopes the searches */
  account: string;
  /** open a cited message in the reader (adopts it into state if needed) */
  onOpenEmail: (email: Email) => void;
}) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [thought, setThought] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // desktop gets focus; on a phone the keyboard would cover the answer area
    if (window.matchMedia("(min-width: 1024px)").matches) inputRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setQuestion("");
    setTurns((t) => [...t, { role: "user", text }]);
    setBusy(true);
    setThought("Searching your mail…");
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await apiAskMail({
        question: text,
        account,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        now: new Date().toLocaleDateString([], {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        signal: ctrl.signal,
      });
      setTurns((t) => [
        ...t,
        { role: "ai", text: res.text, citations: res.citations, messages: res.messages },
      ]);
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setTurns((t) => [
          ...t,
          { role: "error", text: e instanceof Error ? e.message : "Something went wrong." },
        ]);
    } finally {
      if (!ctrl.signal.aborted) {
        setBusy(false);
        setThought(null);
      }
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Ask your mail"
        className="rise-in relative flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-(--color-panel) shadow-2xl lg:max-h-[80vh] lg:max-w-xl lg:rounded-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center gap-2.5 border-b hairline px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--color-clay-soft) text-(--color-clay)">
            <SparkIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">Ask your mail</p>
            <p className="text-[11px] text-(--color-ink-faint)">
              Searches {account === "all" ? "every account" : account} and answers with sources
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-(--color-ink-faint) transition-colors hover:bg-(--color-paper) hover:text-(--color-ink)"
          >
            ✕
          </button>
        </div>

        <div ref={scrollRef} className="nice-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {turns.length === 0 && (
            <div className="space-y-1.5">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-(--color-ink-faint)">
                Try asking
              </p>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="block w-full rounded-lg border hairline px-3 py-2 text-left text-[13px] text-(--color-ink-soft) transition-colors hover:border-(--color-clay)/40 hover:text-(--color-ink)"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="mb-3 flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-(--color-clay) px-3.5 py-2 text-[13px] text-white">
                  {t.text}
                </div>
              </div>
            ) : t.role === "error" ? (
              <p key={i} className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">
                {t.text}
              </p>
            ) : (
              <div key={i} className="mb-3">
                <div className="rounded-2xl rounded-bl-md border hairline bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-(--color-ink)">
                  {t.text.split("\n").map((line, j) => (
                    <p key={j} className={line ? "" : "h-2"}>
                      {line}
                    </p>
                  ))}
                </div>
                {t.citations.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-(--color-ink-faint)">
                      Sources
                    </p>
                    {t.citations.map((c) => {
                      const full = t.messages.find((m) => m.id === c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => full && onOpenEmail(full)}
                          className="flex w-full items-center gap-2 rounded-lg border hairline px-2.5 py-1.5 text-left transition-colors hover:border-(--color-clay)/40 hover:bg-(--color-paper)"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium">{c.subject}</span>
                            <span className="block truncate text-[10px] text-(--color-ink-faint)">
                              {c.from} · {c.time} · {c.folder}
                            </span>
                          </span>
                          <span className="shrink-0 text-[10px] font-semibold text-(--color-clay)">
                            Open →
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )
          )}
          {busy && (
            <div className="mb-3 flex items-center gap-2 text-[12px] text-(--color-ink-faint)">
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-(--color-ink-faint)/40 border-t-(--color-clay)" />
              {thought}
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="flex items-center gap-2 border-t hairline p-3"
        >
          <input
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything about your email…"
            className="min-w-0 flex-1 rounded-xl border hairline bg-white px-3.5 py-2.5 text-sm outline-none placeholder:text-(--color-ink-faint) focus:border-(--color-clay)/50"
          />
          <button
            type="submit"
            disabled={!question.trim() || busy}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-clay) text-white shadow-sm transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
            aria-label="Ask"
          >
            <SparkIcon className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
