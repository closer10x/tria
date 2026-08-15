"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AiPane from "@/components/AiPane";
import ChatPane from "@/components/ChatPane";
import MailPane from "@/components/MailPane";
import SettingsModal from "@/components/SettingsModal";
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
  apiSavedAccounts,
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
import { mockReplies, seedEmails, seedTasks, seedThreads } from "@/lib/data";
import {
  AiMessage,
  Attachment,
  Email,
  Folder,
  Message,
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
  accounts: [
    { id: "acc1", email: "jon.garcia.a@gmail.com", provider: "gmail" },
  ],
  imapHost: "imap.gmail.com",
  imapPort: 993,
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  password: "",
  timezone: "America/New_York",
  timeFormat: "12h",
  snoozeTimes: {
    laterToday: "Today, 6 PM",
    tomorrow: "Tomorrow, 8 AM",
    nextWeek: "Mon, 8 AM",
  },
};

// ids must stay unique across page reloads now that state persists in Supabase
const nextId = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const nowTime = () =>
  new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Mocked "smart" extraction — later this becomes an LLM call. */
function buildSmartTask(email: Email): Task {
  const lower = (email.subject + " " + email.body.join(" ")).toLowerCase();
  const urgent = /friday|today|eod|asap|urgent|tomorrow/.test(lower);
  const checklist =
    email.id === "e1"
      ? [
          { id: nextId("c"), label: "Approve hero variant (A or B)", done: false },
          { id: nextId("c"), label: "Confirm pricing table copy", done: false },
          { id: nextId("c"), label: "Send cleared customer logos", done: false },
        ]
      : email.id === "e2"
        ? [
            { id: nextId("c"), label: "Check cash-flow impact of net-45", done: false },
            { id: nextId("c"), label: "Reply to Derek with decision", done: false },
          ]
        : email.id === "e5"
          ? [
              { id: nextId("c"), label: "Confirm availability for Oct 12", done: false },
              { id: nextId("c"), label: "Send bio + headshot", done: false },
            ]
          : [{ id: nextId("c"), label: "Reply to " + email.from.name, done: false }];

  return {
    id: nextId("t"),
    title:
      email.id === "e1"
        ? "Review Q3 launch assets for Maya"
        : email.id === "e2"
          ? "Decide on net-45 terms for Northpine"
          : email.id === "e5"
            ? "Respond to Founder Forum invite"
            : `Follow up: ${email.subject}`,
    note: email.preview,
    sourceEmailId: email.id,
    priority: urgent ? "high" : "medium",
    due: urgent ? "Fri, Aug 15" : undefined,
    status: "todo",
    checklist,
    createdAt: "Just now",
    justCreated: true,
  };
}

export default function Home() {
  const [emails, setEmails] = useState<Email[]>(seedEmails);
  const [tasks, setTasks] = useState<Task[]>(seedTasks);
  const [threads, setThreads] = useState<Thread[]>(seedThreads);

  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"threads" | "ai">("threads");
  const [mobileTab, setMobileTab] = useState<"mail" | "tasks" | "chat">("mail");
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([
    {
      id: "ai0",
      role: "ai",
      text: "Morning, Jon. I'm watching your mail, tasks, and threads. Send me any email or task — or ask me anything.",
      time: "9:00 AM",
    },
  ]);
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

  useEffect(() => {
    if (!synced) return;
    const t = setTimeout(() => syncThreads(threads), 500);
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
  // emails of the accounts connected live this session; empty = demo data
  const [liveAccounts, setLiveAccounts] = useState<string[]>([]);
  const live = liveAccounts.length > 0;
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [attachPrompt, setAttachPrompt] = useState<Email | null>(null);
  // accounts persisted in Supabase (passwords encrypted server-side)
  const [savedAccounts, setSavedAccounts] = useState<SavedAccountInfo[]>([]);

  // Restore live mail on load: first from the in-memory session (cookie survives
  // reloads), otherwise reconnect saved logins that were live last time.
  useEffect(() => {
    (async () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      let accs = await apiAccounts();
      const saved = await apiSavedAccounts().catch(() => null);
      if (saved) setSavedAccounts(saved.accounts);
      if (accs.length === 0 && saved) {
        const restorable = saved.connectedAccountIds.filter((id) =>
          saved.accounts.some((a) => a.id === id && a.hasPassword)
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

  const makeTask = (email: Email, includeAttachments = false) => {
    const task = buildSmartTask(email);
    if (includeAttachments && email.attachments)
      task.attachments = email.attachments;
    setTasks((prev) => [task, ...prev]);
    setEmails((prev) =>
      prev.map((e) => (e.id === email.id ? { ...e, taskId: task.id } : e))
    );
    showToast(
      includeAttachments
        ? "✦ Smart task created — attachments included"
        : "✦ Smart task created from email"
    );
    setTimeout(
      () =>
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, justCreated: false } : t))
        ),
      2500
    );
  };

  const dropEmailToTasks = (emailId: string) => {
    const email = emails.find((e) => e.id === emailId);
    if (!email) return;
    if (email.taskId) {
      highlightTask(email.taskId);
      showToast("This email already has a smart task");
      return;
    }
    if (email.attachments?.length) {
      setAttachPrompt(email); // Smart Attach: ask about attachments
    } else {
      makeTask(email);
    }
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

  const disconnectAccount = async (account?: string) => {
    const remaining = await apiDisconnect(account);
    setLiveAccounts(remaining);
    setSelectedEmailId(null);
    if (remaining.length === 0) {
      setEmails(seedEmails);
      showToast("Back to demo data");
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

  const sendReply = (email: Email, text: string) => {
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
    fromAccount?: string
  ) => {
    const withSig = settings.signature
      ? `${body}\n\n${settings.signature}`
      : body;
    const account = fromAccount ?? liveAccounts[0] ?? settings.email;
    if (live) {
      apiSend({ to, subject, text: withSig, account }).catch((err) =>
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
    };
    setEmails((prev) => [sent, ...prev]);
    showToast(`Sent to ${to}`);
  };

  const shareEmailToThread = (email: Email) => {
    setPendingAttachment({ type: "email", refId: email.id });
    if (!activeThreadId) setActiveThreadId(threads[0].id);
    setMobileTab("chat");
    setRightTab("threads");
    showToast("✉ Email attached — pick a thread and send");
  };

  const discussTask = (task: Task) => {
    setPendingAttachment({ type: "task", refId: task.id });
    if (!activeThreadId) setActiveThreadId(threads[0].id);
    setMobileTab("chat");
    setRightTab("threads");
    showToast("✦ Task attached — send it to the thread");
  };

  /** Mock AI brain — answers from live app state. Later this becomes a real Claude call. */
  const aiBrain = (text: string, attachment: Attachment | null): string => {
    if (attachment?.type === "email") {
      const e = emails.find((x) => x.id === attachment.refId);
      if (e) {
        const linked = e.taskId
          ? "You already have a smart task for this one."
          : "There's no task on this yet — say the word and I'll build one with a checklist.";
        return `Here's the gist of ${e.from.name}'s email:\n${e.preview}\n${linked}\nI can also draft your reply, or drop a summary into one of your threads.`;
      }
    }
    if (attachment?.type === "task") {
      const t = tasks.find((x) => x.id === attachment.refId);
      if (t) {
        const nextStep = t.checklist.find((c) => !c.done)?.label;
        const src = t.sourceEmailId
          ? emails.find((e) => e.id === t.sourceEmailId)
          : undefined;
        return `Looking at "${t.title}" — ${
          t.checklist.filter((c) => c.done).length
        }/${t.checklist.length} steps done${t.due ? `, due ${t.due}` : ""}.\n${
          nextStep ? `Next best move: "${nextStep}".` : "All steps are done — you can close this out."
        }${src ? `\nWant me to draft the message to ${src.from.name}?` : ""}`;
      }
    }
    const q = text.toLowerCase();
    if (/due|week|today|plate|deadline/.test(q)) {
      const open = tasks.filter((t) => t.status !== "done" && t.due);
      if (open.length === 0) return "Nothing with a hard deadline right now. You're clear.";
      return (
        "Here's what has a deadline:\n" +
        open.map((t) => `✦ ${t.title} — due ${t.due}`).join("\n") +
        "\nWant me to prioritize them for you?"
      );
    }
    if (/unread|inbox|mail|summar/.test(q)) {
      const unread = emails.filter((e) => !e.read);
      if (unread.length === 0) return "Inbox is clear — nothing unread.";
      return (
        `${unread.length} unread:\n` +
        unread.map((e) => `✉ ${e.from.name} — ${e.subject}`).join("\n") +
        "\nSend me either one and I'll break it down."
      );
    }
    if (/draft|reply|respond|write/.test(q)) {
      return `Here's a draft for Maya:\n"Maya — reviewed everything. Going with variant B, pricing copy is approved, and logos are on the way by Thursday. Great work."\nWant me to tighten it, or move it to your Launch crew thread?`;
    }
    return "Got it. Hand me any email or task with the + button, or ask about your inbox, deadlines, or drafts — everything in Tria is in my context.";
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
    setTimeout(() => setAiThinking(true), 400);
    setTimeout(() => {
      setAiThinking(false);
      setAiMessages((prev) => [
        ...prev,
        {
          id: nextId("am"),
          role: "ai",
          text: aiBrain(text, attachment),
          time: nowTime(),
        },
      ]);
      setAiUnread(true);
    }, 1900);
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

    // simulate a teammate replying
    setTimeout(() => setTypingIn(threadId), 700);
    setTimeout(() => {
      setTypingIn(null);
      const replies = mockReplies[threadId] ?? ["Sounds good!"];
      const reply: Message = {
        id: nextId("m"),
        author:
          threads.find((t) => t.id === threadId)?.members.find(
            (m) => m !== "You"
          ) ?? "Teammate",
        text: replies[Math.floor(Math.random() * replies.length)],
        time: nowTime(),
      };
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId ? { ...t, messages: [...t.messages, reply] } : t
        )
      );
    }, 2300);
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
          onMakeTask={makeTask}
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
          onFolderChange={loadFolder}
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
          onDisconnect={disconnectAccount}
          onSaveAccount={saveAccountToServer}
          onDeleteSavedAccount={deleteSavedAccount}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
