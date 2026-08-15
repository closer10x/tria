"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AiPane from "@/components/AiPane";
import ChatPane from "@/components/ChatPane";
import MailPane from "@/components/MailPane";
import SettingsModal from "@/components/SettingsModal";
import UndoSendBar from "@/components/UndoSendBar";
import type { RestoreDraft } from "@/components/MailPane";
import TaskPane from "@/components/TaskPane";
import { ChatIcon, ClipIcon, GearIcon, MailIcon, PaneHeader, SparkIcon } from "@/components/ui";
import {
  apiAccounts,
  apiAction,
  apiBody,
  apiConnect,
  apiDisconnect,
  apiMessages,
  apiSavedAccountDelete,
  apiSavedAccountSave,
  apiSavedAccountLabel,
  apiAsk,
  apiSmartTask,
  apiSavedAccounts,
  apiSaveDraft,
  apiSend,
  SavedAccountInfo,
} from "@/lib/mailApi";
import {
  loadState,
  syncAiMessages,
  syncSettings,
  syncTasks,
  syncThreads,
} from "@/lib/persist";
import { clearMailCache, loadMailCache, saveMailCache } from "@/lib/mailCache";
import { mergeThread, subscribeThreads, ThreadsRealtime } from "@/lib/realtime";
import {
  AiMessage,
  Attachment,
  Email,
  Folder,
  Message,
  OutgoingAttachment,
  Settings,
  Task,
  TaskStatus,
  Thread,
} from "@/lib/types";

const defaultSettings: Settings = {
  name: "Jon Garcia",
  email: "jon.garcia.a@gmail.com",
  signature: "— Jon",
  provider: "gmail",
  accounts: [],
  imapHost: "imap.gmail.com",
  imapPort: 993,
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  password: "",
  timezone: "America/New_York",
  timeFormat: "12h",
  theme: "dark",
  snoozeTimes: {
    laterToday: "Today, 6 PM",
    tomorrow: "Tomorrow, 8 AM",
    nextWeek: "Mon, 8 AM",
  },
};

/** Grace period before a sent message actually leaves. */
const SEND_DELAY_MS = 5000;

// ids must stay unique across page reloads now that state persists in Supabase
const nextId = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const nowTime = () =>
  new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Placeholder shown while Claude reads the email; replaced when it answers. */
function pendingTask(email: Email): Task {
  return {
    id: nextId("t"),
    title: email.subject || `Follow up with ${email.from.name}`,
    note: email.preview,
    sourceEmailId: email.id,
    priority: "medium",
    status: "todo",
    checklist: [],
    createdAt: "Just now",
    justCreated: true,
  };
}

export default function Home() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);

  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"threads" | "ai">("threads");
  const [mobileTab, setMobileTab] = useState<"mail" | "tasks" | "chat">("mail");
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiUnread, setAiUnread] = useState(false);
  const [pendingAttachment, setPendingAttachment] =
    useState<Attachment | null>(null);
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
  const [typingIn, setTypingIn] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // true once Supabase state has hydrated — gates the save effects below
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadState().then((state) => {
      if (cancelled || !state) return;
      if (state.tasks) setTasks(state.tasks);
      if (state.threads) setThreads(state.threads);
      if (state.aiMessages) setAiMessages(state.aiMessages);
      if (state.settings)
        setSettings((s) => ({ ...s, ...state.settings, password: s.password }));
      setSynced(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!synced) return;
    const t = setTimeout(() => syncTasks(tasks), 500);
    return () => clearTimeout(t);
  }, [tasks, synced]);

  // Threads sync writes only what actually changed locally: the realtime
  // subscription marks remote-received state as already-synced (see
  // lastThreadSyncRef), so adopting another client's message doesn't get
  // written straight back and ping-pong events between clients.
  const lastThreadSyncRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!synced) return;
    const t = setTimeout(() => {
      const changed = threads.filter(
        (th) => lastThreadSyncRef.current.get(th.id) !== JSON.stringify(th)
      );
      if (changed.length === 0) return;
      for (const th of changed)
        lastThreadSyncRef.current.set(th.id, JSON.stringify(th));
      syncThreads(changed);
    }, 500);
    return () => clearTimeout(t);
  }, [threads, synced]);

  useEffect(() => {
    if (!synced) return;
    const t = setTimeout(() => syncAiMessages(aiMessages), 500);
    return () => clearTimeout(t);
  }, [aiMessages, synced]);

  useEffect(() => {
    if (!synced) return;
    const t = setTimeout(() => syncSettings(settings), 500);
    return () => clearTimeout(t);
  }, [settings, synced]);

  // apply the theme and remember it for the pre-paint script in layout.tsx
  useEffect(() => {
    const theme = settings.theme ?? "dark";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("tria-theme", theme);
    } catch {}
  }, [settings.theme]);
  // emails of the accounts connected live this session; empty = demo data
  const [liveAccounts, setLiveAccounts] = useState<string[]>([]);
  const live = liveAccounts.length > 0;
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [attachPrompt, setAttachPrompt] = useState<Email | null>(null);
  // accounts persisted in Supabase (passwords encrypted server-side)
  const [savedAccounts, setSavedAccounts] = useState<SavedAccountInfo[]>([]);
  // a message held in the undo window, plus the text to hand back if undone
  const [pendingSend, setPendingSend] = useState<{
    label: string;
    draft: RestoreDraft;
  } | null>(null);
  const pendingSendRef = useRef<{ run: () => void; timer: ReturnType<typeof setTimeout> } | null>(
    null
  );
  const [restoreDraft, setRestoreDraft] = useState<RestoreDraft | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // folders whose mailbox has no older messages left
  const [exhausted, setExhausted] = useState<Set<Folder>>(new Set());
  const [mailFolder, setMailFolder] = useState<Folder>("inbox");

  // Restore live mail on load: first from the in-memory session (cookie survives
  // reloads), otherwise reconnect saved logins that were live last time.
  useEffect(() => {
    (async () => {
      // paint the last known mailbox immediately — the live fetch replaces it;
      // if the network is down, this is what "offline" shows
      const cached = loadMailCache();
      if (cached) setEmails((prev) => (prev.length === 0 ? cached : prev));
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      let accs = await apiAccounts();
      const saved = await apiSavedAccounts().catch(() => null);
      if (saved) setSavedAccounts(saved.accounts);
      if (accs.length === 0 && saved) {
        const restorable = saved.connectedAccountIds.filter((id) =>
          // OAuth accounts reconnect from their stored refresh token, so they
          // are restorable too even though they have no password
          saved.accounts.some((a) => a.id === id && (a.hasPassword || a.isOAuth))
        );
        for (const id of restorable) {
          const res = await apiConnect({ accountId: id });
          if (res.ok && res.accounts) accs = res.accounts;
        }
      }
      if (accs.length === 0) return;
      setLiveAccounts(accs);
      apiMessages("inbox", tz)
        .then(setEmails)
        .catch(() => {});
    })();
  }, []);

  // Live thread sync: other devices' messages appear as they land, and
  // typing indicators travel over the same channel.
  const realtimeRef = useRef<ThreadsRealtime | null>(null);
  const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsNameRef = useRef(settings.name);
  useEffect(() => {
    settingsNameRef.current = settings.name;
  }, [settings.name]);

  useEffect(() => {
    if (!synced) return; // wait for hydration so merges start from real state
    const sub = subscribeThreads({
      onUpsert: (incoming) =>
        setThreads((prev) => {
          const local = prev.find((t) => t.id === incoming.id);
          const merged = mergeThread(local, incoming);
          const mergedJson = JSON.stringify(merged);
          // nothing local on top of what remote sent → this state is theirs;
          // mark it synced so the debounced writer doesn't echo it back
          // (ref write is idempotent, safe under StrictMode double-invoke)
          if (mergedJson === JSON.stringify(incoming))
            lastThreadSyncRef.current.set(incoming.id, mergedJson);
          if (local && JSON.stringify(local) === mergedJson) return prev;
          return local
            ? prev.map((t) => (t.id === incoming.id ? merged : t))
            : [...prev, merged];
        }),
      onDelete: (id) =>
        setThreads((prev) => prev.filter((t) => t.id !== id)),
      onTyping: (threadId) => {
        setTypingIn(threadId);
        if (typingClearRef.current) clearTimeout(typingClearRef.current);
        typingClearRef.current = setTimeout(() => setTypingIn(null), 3000);
      },
      selfAuthor: () => settingsNameRef.current,
    });
    realtimeRef.current = sub;
    return () => {
      realtimeRef.current = null;
      sub?.unsubscribe();
    };
  }, [synced]);

  // announce typing at most every couple of seconds
  const lastTypingSentRef = useRef(0);
  const broadcastTyping = useCallback(() => {
    if (!activeThreadId || !realtimeRef.current) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    realtimeRef.current.sendTyping(activeThreadId, settingsNameRef.current);
  }, [activeThreadId]);

  // keep the offline mail cache in step with whatever is on screen
  useEffect(() => {
    if (!live || emails.length === 0) return;
    const t = setTimeout(() => saveMailCache(emails), 800);
    return () => clearTimeout(t);
  }, [emails, live]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // report the result of an OAuth round trip, then clean the URL
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const connected = q.get("oauth_connected");
    const error = q.get("oauth_error");
    if (!connected && !error) return;
    showToast(connected ? `⚡ Signed in as ${connected}` : error!);
    if (error) setSettingsOpen(true);
    window.history.replaceState({}, "", window.location.pathname);
  }, [showToast]);

  const openEmail = (id: string) => {
    setSelectedEmailId(id);
    const email = emails.find((e) => e.id === id);
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, read: true } : e))
    );
    if (live && email?.uid && email.body.length === 0) {
      apiBody(email.folder, email.uid, email.accountId)
        .then((r) =>
          setEmails((prev) =>
            prev.map((e) => (e.id === id ? { ...e, body: r.body } : e))
          )
        )
        .catch((err) => showToast(String(err.message ?? err)));
    }
  };

  const makeTask = async (email: Email, includeAttachments = false) => {
    const task = pendingTask(email);
    if (includeAttachments && email.attachments)
      task.attachments = email.attachments;
    setTasks((prev) => [task, ...prev]);
    setEmails((prev) =>
      prev.map((e) => (e.id === email.id ? { ...e, taskId: task.id } : e))
    );
    showToast(
      includeAttachments
        ? "✦ Reading the email — attachments included"
        : "✦ Reading the email…"
    );

    // pull the body if we only have the preview, so extraction sees everything
    let body = email.body.join("\n");
    if (live && email.uid && !body) {
      body = await apiBody(email.folder, email.uid, email.accountId)
        .then((r) => r.body.join("\n"))
        .catch(() => email.preview);
    }

    try {
      const draft = await apiSmartTask({
        from: `${email.from.name} <${email.from.email}>`,
        subject: email.subject,
        body: body || email.preview,
        now: new Date().toDateString(),
      });
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                title: draft.title || t.title,
                note: draft.note || t.note,
                priority: draft.priority,
                due: draft.due || undefined,
                checklist: draft.checklist.map((c) => ({
                  id: nextId("c"),
                  label: c.label,
                  done: false,
                })),
              }
            : t
        )
      );
      showToast(
        `✦ ${draft.checklist.length} step${draft.checklist.length === 1 ? "" : "s"} found`
      );
    } catch (err) {
      // keep the task; it just doesn't have extracted steps
      showToast(String(err instanceof Error ? err.message : err));
    } finally {
      setTimeout(
        () =>
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, justCreated: false } : t))
          ),
        2500
      );
    }
  };

  /** Brain-dump results from the Smart Tasks voice bar → real tasks. */
  const addBrainDumpTasks = (
    drafts: {
      title: string;
      note: string;
      priority: "high" | "medium" | "low";
      due: string;
      checklist: { label: string }[];
    }[]
  ) => {
    if (drafts.length === 0) return;
    const fresh: Task[] = drafts.map((d) => ({
      id: nextId("t"),
      title: d.title,
      note: d.note || undefined,
      priority: d.priority,
      due: d.due || undefined,
      status: "todo",
      checklist: d.checklist.map((c) => ({
        id: nextId("c"),
        label: c.label,
        done: false,
      })),
      createdAt: "Just now",
      justCreated: true,
    }));
    setTasks((prev) => [...fresh, ...prev]);
    setMobileTab("tasks");
    showToast(
      `✦ ${fresh.length} task${fresh.length === 1 ? "" : "s"} from your brain-dump`
    );
    const ids = new Set(fresh.map((t) => t.id));
    setTimeout(
      () =>
        setTasks((prev) =>
          prev.map((t) => (ids.has(t.id) ? { ...t, justCreated: false } : t))
        ),
      2500
    );
  };

  /**
   * Every route into a smart task — the Make Smart Task button and a drop on
   * the task pane — comes through here, so Smart Attach asks about the
   * attachments either way rather than only on drop.
   */
  const startTaskFromEmail = (email: Email) => {
    if (email.attachments?.length) {
      setAttachPrompt(email); // Smart Attach: ask about attachments
    } else {
      makeTask(email);
    }
  };

  const dropEmailToTasks = (emailId: string) => {
    const email = emails.find((e) => e.id === emailId);
    if (!email) return;
    if (email.taskId) {
      highlightTask(email.taskId);
      showToast("This email already has a smart task");
      return;
    }
    startTaskFromEmail(email);
  };

  const reorderTasks = (dragId: string, targetId: string) => {
    setTasks((prev) => {
      const drag = prev.find((t) => t.id === dragId);
      if (!drag) return prev;
      const without = prev.filter((t) => t.id !== dragId);
      const idx = without.findIndex((t) => t.id === targetId);
      if (idx === -1) return prev;
      const target = without[idx];
      const moved =
        drag.status === target.status ? drag : { ...drag, status: target.status };
      return [...without.slice(0, idx), moved, ...without.slice(idx)];
    });
  };

  const liveAction = (
    email: Email | undefined,
    action: "read" | "unread" | "star" | "unstar" | "archive" | "trash" | "inbox" | "snooze"
  ) => {
    if (live && email?.uid)
      apiAction(email.folder, email.uid, action, email.accountId).catch((err) =>
        showToast(String(err.message ?? err))
      );
  };

  const toggleStar = (id: string) => {
    const email = emails.find((e) => e.id === id);
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, starred: !e.starred } : e))
    );
    liveAction(email, email?.starred ? "unstar" : "star");
  };

  const markUnread = (id: string) => {
    const email = emails.find((e) => e.id === id);
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, read: false } : e))
    );
    setSelectedEmailId(null);
    showToast("Marked unread");
    liveAction(email, "unread");
  };

  const loadFolder = (folder: Folder) => {
    if (!live) return;
    apiMessages(folder, settings.timezone)
      .then((msgs) =>
        setEmails((prev) => [
          ...prev.filter((e) => e.folder !== folder),
          ...msgs,
        ])
      )
      .catch((err) => showToast(String(err.message ?? err)));
  };

  const connectAccount = async () => {
    setConnecting(true);
    setConnectError(null);
    // blank password → the server falls back to the saved (encrypted) login
    const res = await apiConnect({
      user: settings.email,
      pass: settings.password || undefined,
      provider: settings.provider,
      imapHost: settings.imapHost,
      imapPort: settings.imapPort,
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort,
    });
    setConnecting(false);
    if (!res.ok) {
      setConnectError(res.error ?? "Connection failed");
      return;
    }
    const accounts = res.accounts ?? [settings.email];
    setLiveAccounts(accounts);
    // the server persisted the login — refresh the saved list and drop the
    // plaintext password from client state
    apiSavedAccounts()
      .then((s) => setSavedAccounts(s.accounts))
      .catch(() => {});
    // remember the account in settings for one-click reconnects
    if (!settings.accounts.some((a) => a.email === settings.email)) {
      setSettings((s) => ({
        ...s,
        password: "",
        accounts: [
          ...s.accounts,
          {
            id: `acc${Date.now() % 100000}`,
            email: settings.email,
            provider: settings.provider,
          },
        ],
      }));
    } else {
      setSettings((s) => ({ ...s, password: "" }));
    }
    setSelectedEmailId(null);
    try {
      const msgs = await apiMessages("inbox", settings.timezone);
      setEmails(msgs);
      showToast(
        accounts.length > 1
          ? `⚡ ${settings.email} added — ${accounts.length} accounts live`
          : `⚡ Live — connected to ${settings.email}`
      );
    } catch (err) {
      showToast(String(err instanceof Error ? err.message : err));
    }
  };

  /** One-click connect for a saved account — the server uses its stored login. */
  const connectSavedAccount = async (id: string) => {
    setConnecting(true);
    setConnectError(null);
    const res = await apiConnect({ accountId: id });
    setConnecting(false);
    if (!res.ok) {
      setConnectError(res.error ?? "Connection failed");
      return;
    }
    setLiveAccounts(res.accounts ?? []);
    setSelectedEmailId(null);
    try {
      const msgs = await apiMessages("inbox", settings.timezone);
      setEmails(msgs);
      showToast(`⚡ Live — connected to ${id}`);
    } catch (err) {
      showToast(String(err instanceof Error ? err.message : err));
    }
  };

  const disconnectAccount = async (account?: string) => {
    const remaining = await apiDisconnect(account);
    setLiveAccounts(remaining);
    setSelectedEmailId(null);
    if (remaining.length === 0) {
      setEmails([]);
      clearMailCache();
      showToast("Disconnected — no accounts connected");
    } else {
      // drop the disconnected account's messages, keep the rest
      setEmails((prev) => prev.filter((e) => !e.accountId || e.accountId !== account));
      showToast(`Disconnected ${account}`);
    }
  };

  const saveAccountToServer = async () => {
    if (!settings.email.trim() || !settings.imapHost.trim()) {
      showToast("Enter an email and IMAP host first");
      return;
    }
    try {
      const res = await apiSavedAccountSave({
        email: settings.email,
        provider: settings.provider,
        imapHost: settings.imapHost,
        imapPort: settings.imapPort,
        smtpHost: settings.smtpHost,
        smtpPort: settings.smtpPort,
        password: settings.password || undefined,
      });
      setSavedAccounts(res.accounts);
      if (settings.password) setSettings((s) => ({ ...s, password: "" }));
      showToast(`Saved ${settings.email}`);
    } catch (err) {
      showToast(String(err instanceof Error ? err.message : err));
    }
  };

  const deleteSavedAccount = async (id: string) => {
    const res = await apiSavedAccountDelete(id);
    setSavedAccounts(res.accounts);
    setSettings((s) => ({
      ...s,
      accounts: s.accounts.filter((a) => a.email !== id),
    }));
    showToast(`Removed ${id}`);
  };

  const cycleStatus = (id: string) => {
    const order: TaskStatus[] = ["todo", "doing", "done"];
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, status: order[(order.indexOf(t.status) + 1) % 3] }
          : t
      )
    );
  };

  const togglePinTask = (id: string) =>
    setTasks((prev) => {
      const next = prev.map((t) =>
        t.id === id ? { ...t, pinned: !t.pinned } : t
      );
      // pinned first, otherwise keep the order the user arranged
      return [...next].sort(
        (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
      );
    });

  const deleteTask = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    // release the source email so it can be turned into a task again
    if (task?.sourceEmailId)
      setEmails((prev) =>
        prev.map((e) =>
          e.id === task.sourceEmailId ? { ...e, taskId: undefined } : e
        )
      );
    showToast("Task deleted");
  };

  const toggleChecklist = (taskId: string, itemId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              checklist: t.checklist.map((c) =>
                c.id === itemId ? { ...c, done: !c.done } : c
              ),
            }
          : t
      )
    );
  };

  const highlightTask = (taskId: string) => {
    setMobileTab("tasks");
    setHighlightTaskId(taskId);
    setTimeout(() => setHighlightTaskId(null), 2000);
  };

  const openSourceEmail = (emailId: string) => {
    setMobileTab("mail");
    openEmail(emailId);
  };

  const patchEmail = (id: string, patch: Partial<Email>) =>
    setEmails((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const archiveEmail = (id: string) => {
    liveAction(emails.find((e) => e.id === id), "archive");
    patchEmail(id, { folder: "archive" });
    if (selectedEmailId === id) setSelectedEmailId(null);
    showToast("Archived");
  };

  const deleteEmail = (id: string) => {
    liveAction(emails.find((e) => e.id === id), "trash");
    patchEmail(id, { folder: "trash" });
    if (selectedEmailId === id) setSelectedEmailId(null);
    showToast("Moved to trash");
  };

  const snoozeEmail = (id: string, until: string) => {
    liveAction(emails.find((e) => e.id === id), "snooze");
    patchEmail(id, { folder: "snoozed", snoozedUntil: until });
    if (selectedEmailId === id) setSelectedEmailId(null);
    showToast(`Snoozed until ${until}`);
  };

  const restoreEmail = (id: string) => {
    liveAction(emails.find((e) => e.id === id), "inbox");
    patchEmail(id, { folder: "inbox", snoozedUntil: undefined });
    showToast("Back in inbox");
  };

  const meAsSender = (accountEmail: string) => ({
    name: settings.name,
    email: accountEmail,
    initials:
      settings.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("") || "?",
    hue: "bg-(--color-clay-soft) text-(--color-clay)",
  });

  const saveDraft = async (
    to: string,
    subject: string,
    body: string,
    fromAccount?: string
  ) => {
    const account = fromAccount ?? liveAccounts[0];
    const draft: Email = {
      id: nextId("e"),
      accountId: live ? account : undefined,
      from: meAsSender(account ?? settings.email),
      to,
      subject: subject || "(no subject)",
      preview: body.slice(0, 90),
      body: body.split("\n").filter(Boolean),
      time: nowTime(),
      read: true,
      folder: "drafts",
    };
    setEmails((prev) => [draft, ...prev]);
    showToast("Draft saved");
    if (live) {
      try {
        const uid = await apiSaveDraft({ to, subject, text: body, account });
        if (uid) patchEmail(draft.id, { uid });
      } catch (err) {
        showToast(String(err instanceof Error ? err.message : err));
      }
    }
  };

  /** Page back through the mailbox as the list scrolls. */
  const loadMore = async (folder: Folder) => {
    if (!live || loadingMore || exhausted.has(folder)) return;
    setLoadingMore(true);
    try {
      const offset = emails.filter((e) => e.folder === folder).length;
      const older = await apiMessages(folder, settings.timezone, "all", offset);
      if (older.length === 0) {
        setExhausted((prev) => new Set(prev).add(folder));
      } else {
        setEmails((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          return [...prev, ...older.filter((e) => !seen.has(e.id))];
        });
      }
    } catch (err) {
      showToast(String(err instanceof Error ? err.message : err));
    } finally {
      setLoadingMore(false);
    }
  };

  const renameAccount = async (account: SavedAccountInfo, label: string) => {
    try {
      const res = await apiSavedAccountLabel(account, label);
      setSavedAccounts(res.accounts);
    } catch (err) {
      showToast(String(err instanceof Error ? err.message : err));
    }
  };

  const refreshFolder = async (folder: Folder) => {
    if (!live) return;
    setRefreshing(true);
    try {
      const msgs = await apiMessages(folder, settings.timezone);
      setEmails((prev) => [...prev.filter((e) => e.folder !== folder), ...msgs]);
    } catch (err) {
      showToast(String(err instanceof Error ? err.message : err));
    } finally {
      setRefreshing(false);
    }
  };

  /** Hold an outgoing message briefly so it can be pulled back. */
  const holdSend = (label: string, draft: RestoreDraft, run: () => void) => {
    // a second send while one is held flushes the first immediately
    flushPendingSend();
    const timer = setTimeout(() => {
      run();
      pendingSendRef.current = null;
      setPendingSend(null);
    }, SEND_DELAY_MS);
    pendingSendRef.current = { run, timer };
    setPendingSend({ label, draft });
  };

  const flushPendingSend = () => {
    const p = pendingSendRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingSendRef.current = null;
    setPendingSend(null);
    p.run();
  };

  const undoSend = () => {
    const p = pendingSendRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingSendRef.current = null;
    setRestoreDraft(pendingSend?.draft ?? null);
    setPendingSend(null);
    showToast("Send undone — your message is back");
  };

  const sendReply = (email: Email, text: string) => {
    holdSend(`Replying to ${email.from.name}`, { kind: "reply", text }, () =>
      dispatchReply(email, text)
    );
  };

  const dispatchReply = (email: Email, text: string) => {
    const withSig = settings.signature
      ? `${text}\n\n${settings.signature}`
      : text;
    // reply from the account the email arrived in
    const fromAccount = email.accountId ?? liveAccounts[0] ?? settings.email;
    if (live) {
      apiSend({
        to: email.from.email,
        subject: `Re: ${email.subject}`,
        text: withSig,
        account: fromAccount,
      }).catch((err) => showToast(String(err.message ?? err)));
    }
    patchEmail(email.id, { replied: true });
    const sent: Email = {
      id: nextId("e"),
      accountId: email.accountId,
      from: meAsSender(fromAccount),
      to: email.from.email,
      subject: `Re: ${email.subject}`,
      preview: text.slice(0, 90),
      body: text.split("\n").filter(Boolean),
      time: nowTime(),
      read: true,
      folder: "sent",
    };
    setEmails((prev) => [sent, ...prev]);
    showToast(`Reply sent to ${email.from.name}`);
  };

  const sendNewEmail = (
    to: string,
    subject: string,
    body: string,
    fromAccount?: string,
    attachments?: OutgoingAttachment[]
  ) => {
    holdSend(
      `Sending to ${to}`,
      { kind: "compose", to, subject, body, fromAccount },
      () => dispatchNewEmail(to, subject, body, fromAccount, attachments)
    );
  };

  const dispatchNewEmail = (
    to: string,
    subject: string,
    body: string,
    fromAccount?: string,
    attachments?: OutgoingAttachment[]
  ) => {
    const withSig = settings.signature
      ? `${body}\n\n${settings.signature}`
      : body;
    const account = fromAccount ?? liveAccounts[0] ?? settings.email;
    if (live) {
      apiSend({ to, subject, text: withSig, account, attachments }).catch((err) =>
        showToast(String(err.message ?? err))
      );
    }
    const sent: Email = {
      id: nextId("e"),
      accountId: live ? account : undefined,
      from: meAsSender(account),
      to,
      subject: subject || "(no subject)",
      preview: body.slice(0, 90),
      body: body.split("\n").filter(Boolean),
      time: nowTime(),
      read: true,
      folder: "sent",
      attachments: attachments?.map((a) => ({
        name: a.filename,
        size: `${Math.max(1, Math.round(a.size / 1024))} KB`,
      })),
    };
    setEmails((prev) => [sent, ...prev]);
    showToast(`Sent to ${to}`);
  };

  const shareEmailToThread = (email: Email) => {
    setPendingAttachment({ type: "email", refId: email.id });
    if (!activeThreadId && threads.length > 0) setActiveThreadId(threads[0].id);
    setMobileTab("chat");
    setRightTab("threads");
    showToast("✉ Email attached — pick a thread and send");
  };

  const discussTask = (task: Task) => {
    setPendingAttachment({ type: "task", refId: task.id });
    if (!activeThreadId && threads.length > 0) setActiveThreadId(threads[0].id);
    setMobileTab("chat");
    setRightTab("threads");
    showToast("✦ Task attached — send it to the thread");
  };


  const sendAiMessage = (text: string, override?: Attachment) => {
    const attachment = override ?? pendingAttachment;
    const msg: AiMessage = {
      id: nextId("am"),
      role: "user",
      text,
      time: nowTime(),
      attachment: attachment ?? undefined,
    };
    setAiMessages((prev) => [...prev, msg]);
    setPendingAttachment(null);
    setAiThinking(true);

    // what the user is looking at, so Claude answers about this inbox
    const focus =
      attachment?.type === "email"
        ? emails.find((e) => e.id === attachment.refId)
        : undefined;
    const focusTask =
      attachment?.type === "task"
        ? tasks.find((t) => t.id === attachment.refId)
        : undefined;
    const prompt = focus
      ? `${text}\n\n(About this email — from ${focus.from.name}, subject "${focus.subject}")`
      : focusTask
        ? `${text}\n\n(About this task — "${focusTask.title}")`
        : text;

    const turns = [
      ...aiMessages.map((m) => ({
        role: m.role === "ai" ? ("assistant" as const) : ("user" as const),
        text: m.text,
      })),
      { role: "user" as const, text: prompt },
    ];

    apiAsk({
      turns,
      context: {
        now: new Date().toString(),
        accounts: liveAccounts,
        emails: emails.slice(0, 60).map((e) => ({
          from: `${e.from.name} <${e.from.email}>`,
          subject: e.subject,
          preview: e.preview,
          folder: e.folder,
          read: e.read,
          time: e.time,
        })),
        tasks: tasks.map((t) => ({
          title: t.title,
          status: t.status,
          priority: t.priority,
          due: t.due,
          checklist: t.checklist.map((c) => ({ label: c.label, done: c.done })),
        })),
        threads: threads.map((t) => ({
          name: t.name,
          members: t.members,
          lastMessage: t.messages[t.messages.length - 1]?.text,
        })),
      },
    })
      .then((answer) =>
        setAiMessages((prev) => [
          ...prev,
          { id: nextId("am"), role: "ai", text: answer, time: nowTime() },
        ])
      )
      .catch((err) =>
        setAiMessages((prev) => [
          ...prev,
          {
            id: nextId("am"),
            role: "ai",
            text: String(err instanceof Error ? err.message : err),
            time: nowTime(),
          },
        ])
      )
      .finally(() => {
        setAiThinking(false);
        setAiUnread(true);
      });
  };

  const openAiTab = () => {
    setRightTab("ai");
    setMobileTab("chat");
    setAiUnread(false);
  };

  const sendEmailToAi = (email: Email) => {
    openAiTab();
    showToast("✦ Taken to AI thread");
    sendAiMessage("Take a look at this for me.", { type: "email", refId: email.id });
  };

  const sendTaskToAi = (task: Task) => {
    openAiTab();
    showToast("✦ Taken to AI thread");
    sendAiMessage("Where does this stand?", { type: "task", refId: task.id });
  };

  const sendMessage = (text: string) => {
    if (!activeThreadId) return;
    const threadId = activeThreadId;
    const msg: Message = {
      id: nextId("m"),
      author: "me",
      text,
      time: nowTime(),
      attachment: pendingAttachment ?? undefined,
    };
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId ? { ...t, messages: [...t.messages, msg] } : t
      )
    );
    setPendingAttachment(null);
  };

  const unreadCount = emails.filter(
    (e) => e.folder === "inbox" && !e.read
  ).length;

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 pb-2 pt-4">
        <div className="flex items-center gap-3.5">
          <div className="flex items-end gap-[3px]">
            <span className="h-4 w-[3px] rounded-sm bg-(--color-clay)" />
            <span className="h-3 w-[3px] rounded-sm bg-white/60" />
            <span className="h-2 w-[3px] rounded-sm bg-white/25" />
          </div>
          <h1 className="font-display text-xl font-light uppercase tracking-[0.5em] text-white">
            Tria
          </h1>
          <span className="hidden font-display text-[10px] font-light uppercase tracking-[0.26em] text-white/35 md:block">
            Mail · Smart Tasks · Threads
          </span>
        </div>
        <div className="flex items-center gap-2">
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-(--color-sage)/40 bg-(--color-sage)/15 px-3 py-1 font-display text-[10px] font-medium uppercase tracking-[0.2em] text-(--color-sage)">
              <span className="h-1.5 w-1.5 rounded-full bg-(--color-sage)" />
              Live
            </span>
          )}
          <span className="hidden rounded-full border border-white/15 bg-white/5 px-3 py-1 font-display text-[10px] font-normal uppercase tracking-[0.2em] text-white/70 sm:block">
            {settings.name}
          </span>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="rounded-full border border-white/15 bg-white/5 p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <GearIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Three panes */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-2.5 pt-2 lg:grid lg:grid-cols-3 lg:gap-4 lg:p-4 lg:pt-2">
        <div
          className={`min-h-0 flex-1 ${
            mobileTab === "mail" ? "flex flex-col" : "hidden"
          } lg:flex lg:flex-col`}
        >
        <MailPane
          emails={emails}
          accounts={liveAccounts}
          selectedId={selectedEmailId}
          onSelect={openEmail}
          onBack={() => setSelectedEmailId(null)}
          onMakeTask={startTaskFromEmail}
          onShareToThread={shareEmailToThread}
          onViewTask={highlightTask}
          onSendToAi={sendEmailToAi}
          onArchive={archiveEmail}
          onDelete={deleteEmail}
          onSnooze={snoozeEmail}
          onRestore={restoreEmail}
          onReply={sendReply}
          onComposeSend={sendNewEmail}
          onToggleStar={toggleStar}
          onMarkUnread={markUnread}
          onFolderChange={(f) => {
            setMailFolder(f);
            loadFolder(f);
          }}
          accountLabels={Object.fromEntries(
            savedAccounts.filter((a) => a.label).map((a) => [a.email, a.label!])
          )}
          onSaveDraft={saveDraft}
          onRefresh={refreshFolder}
          refreshing={refreshing}
          restoreDraft={restoreDraft}
          onDraftRestored={() => setRestoreDraft(null)}
          onLoadMore={loadMore}
          loadingMore={loadingMore}
          noMoreMail={exhausted.has(mailFolder)}
          snoozeOptions={[
            settings.snoozeTimes.laterToday,
            settings.snoozeTimes.tomorrow,
            settings.snoozeTimes.nextWeek,
          ]}
        />
        </div>
        <div
          className={`min-h-0 flex-1 ${
            mobileTab === "tasks" ? "flex flex-col" : "hidden"
          } lg:flex lg:flex-col`}
        >
        <TaskPane
          tasks={tasks}
          emails={emails}
          highlightId={highlightTaskId}
          onCycleStatus={cycleStatus}
          onToggleChecklist={toggleChecklist}
          onOpenSource={openSourceEmail}
          onDiscuss={discussTask}
          onAskAi={sendTaskToAi}
          onReorder={reorderTasks}
          onDropEmail={dropEmailToTasks}
          onTogglePin={togglePinTask}
          onDelete={deleteTask}
          onBrainDump={addBrainDumpTasks}
        />
        </div>

        {/* Right column: Conversation ↔ AI */}
        <section
          className={`pane min-h-0 flex-1 flex-col rounded-xl lg:h-full ${
            mobileTab === "chat" ? "flex" : "hidden"
          } lg:flex`}
        >
          <PaneHeader>
            <div className="flex w-full gap-1.5">
              <button
                onClick={() => setRightTab("threads")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 font-display text-[12px] font-normal uppercase tracking-[0.22em] transition-colors ${
                  rightTab === "threads"
                    ? "bg-white text-(--color-ink) shadow-sm"
                    : "border border-white/10 text-white/55 hover:bg-white/10 hover:text-white"
                }`}
              >
                <ChatIcon className="h-3.5 w-3.5" /> Conversation
              </button>
              <button
                onClick={openAiTab}
                className={`relative flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 font-display text-[12px] font-normal uppercase tracking-[0.22em] transition-colors ${
                  rightTab === "ai"
                    ? "bg-(--color-clay) text-white shadow-sm"
                    : "border border-white/10 text-white/55 hover:bg-white/10 hover:text-white"
                }`}
              >
                <SparkIcon className="h-3.5 w-3.5" /> AI
                {aiUnread && rightTab !== "ai" && (
                  <span className="absolute right-2.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-(--color-clay)" />
                )}
              </button>
            </div>
          </PaneHeader>
          <div className="min-h-0 flex-1">
            {rightTab === "threads" ? (
              <ChatPane
                threads={threads}
                emails={emails}
                tasks={tasks}
                activeThreadId={activeThreadId}
                pendingAttachment={pendingAttachment}
                typingIn={typingIn}
                onOpenThread={setActiveThreadId}
                onBack={() => setActiveThreadId(null)}
                onSend={sendMessage}
                onSetPending={setPendingAttachment}
                onTyping={broadcastTyping}
              />
            ) : (
              <AiPane
                messages={aiMessages}
                emails={emails}
                tasks={tasks}
                thinking={aiThinking}
                pendingAttachment={pendingAttachment}
                onSend={sendAiMessage}
                onSetPending={setPendingAttachment}
              />
            )}
          </div>
        </section>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        className="flex shrink-0 items-stretch border-t border-white/10 bg-(--color-bar) lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {(
          [
            ["mail", "Mail", <MailIcon key="i" className="h-[18px] w-[18px]" />],
            ["tasks", "Tasks", <SparkIcon key="i" className="h-[18px] w-[18px]" />],
            ["chat", "Threads", <ChatIcon key="i" className="h-[18px] w-[18px]" />],
          ] as const
        ).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setMobileTab(key)}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors ${
              mobileTab === key ? "text-(--color-clay)" : "text-white/45"
            }`}
          >
            {icon}
            <span className="font-display text-[9px] font-medium uppercase tracking-[0.18em]">
              {label}
            </span>
            {key === "mail" && unreadCount > 0 && (
              <span className="absolute right-[calc(50%-20px)] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--color-clay) px-1 text-[9px] font-bold text-white">
                {unreadCount}
              </span>
            )}
            {key === "chat" && aiUnread && (
              <span className="absolute right-[calc(50%-18px)] top-2 h-2 w-2 rounded-full bg-(--color-clay)" />
            )}
          </button>
        ))}
      </nav>

      {/* Undo send */}
      {pendingSend && (
        <UndoSendBar
          label={pendingSend.label}
          seconds={SEND_DELAY_MS / 1000}
          onUndo={undoSend}
          onSendNow={flushPendingSend}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="toast-in fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-(--color-clay) px-4 py-2 text-[13px] font-semibold text-white shadow-xl lg:bottom-6">
          {toast}
        </div>
      )}

      {/* Smart Attach prompt */}
      {attachPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setAttachPrompt(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rise-in w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl"
          >
            <p className="mb-1 flex items-center gap-2 font-display text-[11px] font-medium uppercase tracking-[0.2em] text-(--color-clay)">
              <ClipIcon className="h-3.5 w-3.5" /> Smart Attach
            </p>
            <p className="mb-3 text-sm font-semibold">
              This email has {attachPrompt.attachments?.length} attachment
              {(attachPrompt.attachments?.length ?? 0) > 1 ? "s" : ""}.
              Include them in the task?
            </p>
            <div className="mb-4 space-y-1">
              {attachPrompt.attachments?.map((a) => (
                <p
                  key={a.name}
                  className="flex items-center gap-2 text-xs text-(--color-ink-soft)"
                >
                  <ClipIcon className="h-3 w-3 text-(--color-ink-faint)" />
                  {a.name}
                  {a.size && (
                    <span className="text-(--color-ink-faint)">{a.size}</span>
                  )}
                </p>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  makeTask(attachPrompt, true);
                  setAttachPrompt(null);
                }}
                className="flex-1 rounded-lg bg-(--color-clay) px-3 py-2 text-[13px] font-semibold text-white transition-transform hover:scale-[1.02]"
              >
                Include attachments
              </button>
              <button
                onClick={() => {
                  makeTask(attachPrompt, false);
                  setAttachPrompt(null);
                }}
                className="flex-1 rounded-lg border hairline px-3 py-2 text-[13px] font-semibold text-(--color-ink-soft) transition-colors hover:border-(--color-ink-faint)"
              >
                Task only
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings */}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          savedAccounts={savedAccounts}
          connectedAccounts={liveAccounts}
          connecting={connecting}
          connectError={connectError}
          onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
          onConnect={connectAccount}
          onConnectSaved={connectSavedAccount}
          onDisconnect={disconnectAccount}
          onSaveAccount={saveAccountToServer}
          onDeleteSavedAccount={deleteSavedAccount}
          onRenameAccount={renameAccount}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
