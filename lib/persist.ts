import { supabase } from "./supabase";
import { AiMessage, Settings, Task, Thread } from "./types";

/**
 * Supabase persistence for Tria's client state.
 * Load once on mount; sync functions are fire-and-forget (debounced by the caller).
 * The mail password is intentionally never written to the database.
 */

type TaskRow = {
  id: string;
  title: string;
  note: string | null;
  source_email_id: string | null;
  priority: Task["priority"];
  due: string | null;
  status: Task["status"];
  checklist: Task["checklist"];
  attachments: Task["attachments"] | null;
  created_at_label: string | null;
  position: number;
  pinned: boolean;
};

const taskToRow = (t: Task, position: number): TaskRow => ({
  id: t.id,
  title: t.title,
  note: t.note ?? null,
  source_email_id: t.sourceEmailId ?? null,
  priority: t.priority,
  due: t.due ?? null,
  status: t.status,
  checklist: t.checklist,
  attachments: t.attachments ?? null,
  created_at_label: t.createdAt ?? null,
  position,
  pinned: t.pinned ?? false,
});

const rowToTask = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  note: r.note ?? undefined,
  sourceEmailId: r.source_email_id ?? undefined,
  priority: r.priority,
  due: r.due ?? undefined,
  status: r.status,
  checklist: r.checklist ?? [],
  attachments: r.attachments ?? undefined,
  createdAt: r.created_at_label ?? "",
  pinned: r.pinned ?? false,
});

export type PersistedState = {
  tasks: Task[] | null;
  threads: Thread[] | null;
  aiMessages: AiMessage[] | null;
  settings: Partial<Settings> | null;
};

/** Returns null when Supabase is unconfigured or unreachable (stay memory-only). */
export async function loadState(): Promise<PersistedState | null> {
  if (!supabase) return null;
  try {
    const [tasksRes, threadsRes, aiRes, settingsRes] = await Promise.all([
      supabase.from("tasks").select("*").order("position"),
      supabase.from("threads").select("*").order("updated_at"),
      supabase.from("ai_messages").select("*").order("seq"),
      supabase.from("app_settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    if (tasksRes.error || threadsRes.error || aiRes.error || settingsRes.error)
      return null;

    const tasks = tasksRes.data?.length
      ? (tasksRes.data as TaskRow[]).map(rowToTask)
      : null;
    const threads = threadsRes.data?.length
      ? threadsRes.data.map((r) => ({
          id: r.id,
          name: r.name,
          members: r.members ?? [],
          emoji: r.emoji ?? "",
          messages: r.messages ?? [],
        }))
      : null;
    const aiMessages = aiRes.data?.length
      ? aiRes.data.map((r) => ({
          id: r.id,
          role: r.role,
          text: r.text,
          time: r.time,
          attachment: r.attachment ?? undefined,
        }))
      : null;
    const settings =
      (settingsRes.data?.data as Partial<Settings> | undefined) ?? null;

    return { tasks, threads, aiMessages, settings };
  } catch {
    return null;
  }
}

/** Upsert every task and delete rows that no longer exist locally. */
export async function syncTasks(tasks: Task[]) {
  if (!supabase) return;
  const rows = tasks.map((t, i) => taskToRow(t, i));
  await supabase.from("tasks").upsert(rows);
  const keep = tasks.map((t) => `"${t.id}"`).join(",");
  const del = supabase.from("tasks").delete();
  await (keep ? del.not("id", "in", `(${keep})`) : del.neq("id", ""));
}

export async function syncThreads(threads: Thread[]) {
  if (!supabase) return;
  await supabase.from("threads").upsert(
    threads.map((t) => ({
      id: t.id,
      name: t.name,
      members: t.members,
      emoji: t.emoji,
      messages: t.messages,
      updated_at: new Date().toISOString(),
    }))
  );
}

export async function syncAiMessages(messages: AiMessage[]) {
  if (!supabase) return;
  await supabase.from("ai_messages").upsert(
    messages.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      time: m.time,
      attachment: m.attachment ?? null,
    }))
  );
}

export async function syncSettings(settings: Settings) {
  if (!supabase) return;
  const { password: _password, ...safe } = settings;
  await supabase
    .from("app_settings")
    .upsert({ id: 1, data: safe, updated_at: new Date().toISOString() });
}
