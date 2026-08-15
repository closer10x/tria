"use client";

import { useEffect, useState } from "react";

/**
 * The grace period after hitting send: the message is held locally and a bar
 * counts down, so a misfire can be pulled back before it leaves.
 */
export default function UndoSendBar({
  label,
  seconds,
  onUndo,
  onSendNow,
}: {
  label: string;
  seconds: number;
  onUndo: () => void;
  onSendNow: () => void;
}) {
  const [left, setLeft] = useState(seconds);
  // drives the draining bar: starts full, transitions to empty over `seconds`
  const [drained, setDrained] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setDrained(true));
    const tick = setInterval(
      () => setLeft((s) => (s > 1 ? s - 1 : 1)),
      1000
    );
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(tick);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="toast-in fixed bottom-24 left-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl bg-(--color-ink) shadow-2xl lg:bottom-6"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-(--color-paper)/25" />
          <span className="font-display text-[10px] font-semibold tabular-nums text-(--color-paper)">
            {left}
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-(--color-paper)">
          {label}
        </span>
        <button
          onClick={onSendNow}
          className="shrink-0 rounded-md px-2 py-1 font-display text-[10px] font-medium uppercase tracking-[0.14em] text-(--color-paper)/50 transition-colors hover:text-(--color-paper)/80"
        >
          Send now
        </button>
        <button
          onClick={onUndo}
          className="shrink-0 rounded-md bg-(--color-paper)/10 px-2.5 py-1 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-(--color-paper) transition-colors hover:bg-(--color-paper)/20"
        >
          Undo
        </button>
      </div>
      <div className="h-0.5 w-full bg-(--color-paper)/10">
        <div
          className="h-full bg-(--color-clay)"
          style={{
            width: drained ? "0%" : "100%",
            transitionProperty: "width",
            transitionDuration: `${seconds}s`,
            transitionTimingFunction: "linear",
          }}
        />
      </div>
    </div>
  );
}
