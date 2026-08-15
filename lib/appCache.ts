import { AiMessage, Task, Thread } from "./types";

/**
 * Local snapshot of the Supabase-backed state (tasks, threads, AI chat).
 *
 * loadState() returns null when Supabase is unreachable, and the app then
 * starts from empty arrays — so reloading the tab with no network used to
 * show an empty workspace even though nothing had been lost. This keeps the
 * last known good state on the device so a cold start offline still paints
 * real content; the Supabase load replaces it whenever it succeeds.
 *
 * Mail has its own cache with different sizing rules — see lib/mailCache.ts.
 */

const KEY = "tria-state-cache-v1";
/** Oldest AI turns are dropped first; the rest of the state is small. */
const MAX_AI_MESSAGES = 200;

export type CachedState = {
  tasks: Task[];
  threads: Thread[];
  aiMessages: AiMessage[];
};

export function loadAppCache(): CachedState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedState>;
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const threads = Array.isArray(parsed.threads) ? parsed.threads : [];
    const aiMessages = Array.isArray(parsed.aiMessages) ? parsed.aiMessages : [];
    // an all-empty snapshot carries no information — treat it as absent so it
    // can't mask a real load
    return tasks.length || threads.length || aiMessages.length
      ? { tasks, threads, aiMessages }
      : null;
  } catch {
    return null;
  }
}

export function saveAppCache(state: CachedState) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        tasks: state.tasks,
        threads: state.threads,
        aiMessages: state.aiMessages.slice(-MAX_AI_MESSAGES),
        at: Date.now(),
      })
    );
  } catch {
    // quota exceeded or storage unavailable — drop it rather than crash
    try {
      localStorage.removeItem(KEY);
    } catch {}
  }
}
