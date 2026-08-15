/**
 * Connectivity state for the whole client.
 *
 * `navigator.onLine` alone is not enough: it reports true whenever a network
 * interface is up, so a laptop on a wifi network with no upstream — or a
 * sleeping serverless backend — still reads "online" while every request
 * fails. So the signal here is the union of two sources:
 *
 *   1. the browser's online/offline events (instant, but over-optimistic), and
 *   2. what actually happened to our own requests (authoritative, but only
 *      known once something has been tried).
 *
 * `netFetch` feeds source 2 — a transport-level failure marks us offline, any
 * completed response marks us online again. Route handlers returning 500 are
 * *not* connectivity failures and deliberately don't flip the state.
 */

let offline = typeof navigator !== "undefined" && !navigator.onLine;

type Listener = (offline: boolean) => void;
const listeners = new Set<Listener>();

function set(next: boolean) {
  if (next === offline) return;
  offline = next;
  for (const l of listeners) l(offline);
}

export const isOffline = () => offline;

/** Subscribe to connectivity changes. Returns an unsubscribe function. */
export function subscribeOffline(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => set(false));
  window.addEventListener("offline", () => set(true));
}

/**
 * fetch, with the result folded into the connectivity state.
 *
 * A rejected fetch means the request never completed — DNS, TLS, or the
 * network being gone — which is exactly the condition offline mode exists
 * for. The error is re-thrown unchanged so callers keep their own handling.
 */
export async function netFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  try {
    const res = await fetch(input, init);
    set(false);
    return res;
  } catch (err) {
    set(true);
    throw err;
  }
}

/**
 * Probe the server to find out whether we are really back.
 *
 * The browser's `online` event fires when an interface comes up, which is
 * earlier than the point at which requests actually succeed. Callers that
 * want to act on reconnection (replaying the outbox, refetching mail) should
 * confirm with this first so they don't fire into a still-dead network.
 */
export async function confirmOnline(): Promise<boolean> {
  try {
    await netFetch("/api/mail/accounts", { cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}
