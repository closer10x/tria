export type Sender = {
  name: string;
  email: string;
  initials: string;
  hue: string; // tailwind-ish bg class token
};

export type Folder =
  | "inbox"
  | "snoozed"
  | "drafts"
  | "sent"
  | "archive"
  | "trash";

export type FileRef = {
  name: string;
  size?: string;
  /** IMAP body part id + type, set for attachments on live mail so they can be opened */
  part?: string;
  contentType?: string;
};

/** A file picked in the composer, base64-encoded for the send API. */
export type OutgoingAttachment = {
  filename: string;
  contentType?: string;
  size: number;
  data: string;
};

export type Email = {
  id: string;
  uid?: number; // set when the email comes from a live IMAP account
  accountId?: string; // which connected account this message belongs to
  from: Sender;
  to?: string;
  /** every To/Cc address on the message — what Reply All needs */
  toAll?: string[];
  cc?: string[];
  subject: string;
  preview: string;
  body: string[];
  time: string;
  read: boolean;
  folder: Folder;
  starred?: boolean;
  snoozedUntil?: string;
  replied?: boolean;
  tag?: string;
  taskId?: string; // linked smart task
  attachments?: FileRef[];
  /** Sanitized HTML of the message for the reader; body[] stays the text form. */
  html?: string;
  /** RFC message id, read with the body — a reply quotes it so clients thread. */
  messageId?: string;
  /** The thread this message is part of, carried into replies. */
  references?: string[];
  /** Written offline and waiting in the outbox rather than actually sent. */
  queued?: boolean;
};

/** Every mailbox mutation the client can ask for. */
export type MailAction =
  | "read"
  | "unread"
  | "star"
  | "unstar"
  | "archive"
  | "trash"
  | "inbox"
  | "snooze";

export type Provider =
  | "gmail"
  | "outlook"
  | "m365"
  | "godaddy"
  | "yahoo"
  | "icloud"
  | "custom";

export type SavedAccount = { id: string; email: string; provider: Provider };

export type Settings = {
  name: string;
  email: string;
  signature: string;
  /** Optional rich signature. When set, sent mail carries an HTML part whose
   *  signature is this markup; `signature` stays the plain-text fallback. */
  signatureHtml?: string;
  provider: Provider;
  accounts: SavedAccount[];
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  password: string;
  timezone: string;
  timeFormat: "12h" | "24h";
  /** Pane appearance; optional so settings saved before it existed still load. */
  theme?: "light" | "dark";
  snoozeTimes: { laterToday: string; tomorrow: string; nextWeek: string };
};

export type ChecklistItem = { id: string; label: string; done: boolean };

/** A note left on a task — logged with who wrote it and when. */
export type TaskNote = { id: string; author: string; text: string; at: string };

export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "high" | "medium" | "low";

export type Task = {
  id: string;
  title: string;
  note?: string;
  sourceEmailId?: string;
  priority: TaskPriority;
  due?: string;
  status: TaskStatus;
  checklist: ChecklistItem[];
  createdAt: string;
  justCreated?: boolean;
  /** Pinned tasks sort above the rest. */
  pinned?: boolean;
  attachments?: FileRef[];
  /** Running log of user-written notes, newest last. */
  notes?: TaskNote[];
};

export type Attachment =
  | { type: "email"; refId: string }
  | { type: "task"; refId: string }
  | { type: "file"; files: FileRef[] };

export type Message = {
  id: string;
  author: string; // "me" or a name
  text: string;
  time: string;
  attachment?: Attachment;
};

export type Thread = {
  id: string;
  name: string;
  members: string[];
  emoji: string;
  messages: Message[];
  /** Archived threads collapse out of the main list but keep their history. */
  archived?: boolean;
};

export type AiMessage = {
  id: string;
  role: "user" | "ai";
  text: string;
  time: string;
  attachment?: Attachment;
};
