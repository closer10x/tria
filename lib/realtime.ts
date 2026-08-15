import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { Message, Thread } from "./types";

/**
 * Live thread sync over Supabase Realtime: postgres_changes keeps every open
 * client's threads in step (the `threads` table is in the supabase_realtime
 * publication), and a broadcast event carries typing indicators.
 */

type ThreadRow = {
  id: string;
  name: string;
  members: string[] | null;
  emoji: string | null;
  messages: Message[] | null;
};

const rowToThread = (r: ThreadRow): Thread => ({
  id: r.id,
  name: r.name,
  members: r.members ?? [],
  emoji: r.emoji ?? "",
  messages: r.messages ?? [],
});

/**
 * Union-merge an incoming thread into local state by message id, so two
 * clients sending in the same debounce window converge on both messages
 * instead of last-writer-wins dropping one.
 */
export function mergeThread(local: Thread | undefined, incoming: Thread): Thread {
  if (!local) return incoming;
  const seen = new Set(local.messages.map((m) => m.id));
  const unseen = incoming.messages.filter((m) => !seen.has(m.id));
  return {
    ...incoming,
    messages: [...local.messages, ...unseen],
  };
}

export type ThreadsRealtime = {
  /** Throttled by the caller; announces typing in a thread to other clients. */
  sendTyping: (threadId: string, author: string) => void;
  /** (Re-)announce this client's display name to the presence roster. */
  updatePresence: (name: string) => void;
  unsubscribe: () => void;
};

export function subscribeThreads(handlers: {
  onUpsert: (thread: Thread) => void;
  onDelete: (threadId: string) => void;
  onTyping: (threadId: string, author: string) => void;
  /** Names currently online, deduped, self included. */
  onPresence: (names: string[]) => void;
  /** Used to ignore this client's own typing broadcasts. */
  selfAuthor: () => string;
}): ThreadsRealtime | null {
  if (!supabase) return null;
  // random per-tab key: two devices with the same display name both count
  const presenceKey =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Math.random());
  const channel: RealtimeChannel = supabase
    .channel("tria-threads", { config: { presence: { key: presenceKey } } })
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "threads" },
      (payload) => {
        if (payload.eventType === "DELETE") {
          const id = (payload.old as { id?: string })?.id;
          if (id) handlers.onDelete(id);
          return;
        }
        handlers.onUpsert(rowToThread(payload.new as ThreadRow));
      }
    )
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      const p = payload as { threadId?: string; author?: string } | undefined;
      if (p?.threadId && p.author && p.author !== handlers.selfAuthor())
        handlers.onTyping(p.threadId, p.author);
    })
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<{ name?: string }>();
      const names = new Set<string>();
      for (const metas of Object.values(state))
        for (const m of metas) if (m.name) names.add(m.name);
      handlers.onPresence(Array.from(names));
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED")
        channel.track({ name: handlers.selfAuthor() });
    });

  return {
    sendTyping: (threadId, author) => {
      channel.send({
        type: "broadcast",
        event: "typing",
        payload: { threadId, author },
      });
    },
    updatePresence: (name) => {
      channel.track({ name });
    },
    unsubscribe: () => {
      supabase?.removeChannel(channel);
    },
  };
}
