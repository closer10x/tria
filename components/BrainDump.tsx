"use client";

import { useState } from "react";
import type { ParsedTaskDraft } from "@/app/api/ai/parse-tasks/route";
import VoiceButton from "./VoiceButton";
import { SparkIcon } from "./ui";

/**
 * Brain-dump capture bar for the Smart Tasks pane: type or talk one big blur
 * ("email Jon, book flights, 30 min gym"), and it becomes individual tasks.
 */
export default function BrainDump({
  onTasks,
}: {
  onTasks: (tasks: ParsedTaskDraft[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dump, setDump] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const makeList = async () => {
    const text = dump.trim();
    if (!text || parsing) return;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/parse-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, now: new Date().toString() }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        tasks?: ParsedTaskDraft[];
        error?: string;
      };
      if (data.ok && data.tasks?.length) {
        onTasks(data.tasks);
        setDump("");
        setOpen(false);
      } else {
        setError(data.error ?? "Couldn't find any tasks in that.");
      }
    } catch {
      setError("Couldn't reach the task parser — try again.");
    } finally {
      setParsing(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mx-5 mt-3 flex items-center gap-2 rounded-lg border hairline px-3 py-2 text-left text-[13px] text-(--color-ink-faint) transition-colors hover:border-(--color-clay)/50 hover:text-(--color-ink-soft)"
      >
        <SparkIcon className="h-3.5 w-3.5 text-(--color-clay)" />
        Brain-dump your tasks — type or talk, one big blur…
      </button>
    );
  }

  return (
    <div className="mx-5 mt-3 rounded-lg border hairline p-2.5">
      <div className="flex items-end gap-2">
        <textarea
          autoFocus
          value={dump}
          onChange={(e) => setDump(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) makeList();
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="email Jon, book flights, 30 min gym, call the dentist…"
          rows={3}
          className="min-h-0 flex-1 resize-none rounded-lg border hairline bg-white px-3 py-2 text-sm outline-none placeholder:text-(--color-ink-faint) focus:border-(--color-clay)/50"
        />
        {/* each spoken burst is appended to the dump */}
        <VoiceButton
          size={38}
          onResult={(t) => setDump((d) => (d ? d + ", " : "") + t)}
        />
      </div>
      {error && (
        <p className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          onClick={makeList}
          disabled={!dump.trim() || parsing}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-(--color-clay) px-3 py-2 text-[13px] font-semibold text-white transition-transform hover:scale-[1.01] disabled:opacity-50"
        >
          <SparkIcon className="h-3.5 w-3.5" />
          {parsing ? "Making your list…" : "Make task list"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border hairline px-3 py-2 text-[13px] font-semibold text-(--color-ink-soft) transition-colors hover:border-(--color-ink-faint)"
        >
          Close
        </button>
      </div>
    </div>
  );
}
