"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Two-step delete: the first press arms the button, the second one deletes.
 *
 * Used by every permanent delete outside mail — tasks, threads, saved
 * accounts. Mail is deliberately left out: delete there moves the message to
 * Trash, so it is already undoable.
 *
 * The armed state disarms itself after a few seconds. Hover-based disarming
 * is not enough on a phone, where there is no pointer to leave the row and an
 * armed button would otherwise sit there indefinitely waiting to be brushed
 * by a later tap — which is the accidental delete this is meant to prevent.
 */
export function useArmedConfirm(timeoutMs = 4000) {
  const [armedId, setArmedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const disarm = useCallback(() => {
    clear();
    setArmedId(null);
  }, []);

  const arm = useCallback(
    (id: string) => {
      clear();
      setArmedId(id);
      timer.current = setTimeout(() => setArmedId(null), timeoutMs);
    },
    [timeoutMs]
  );

  // a pending timer must not outlive the pane
  useEffect(() => clear, []);

  return { armedId, arm, disarm, isArmed: (id: string) => armedId === id };
}
