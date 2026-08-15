import { Folder, MailAction, OutgoingAttachment } from "./types";

/**
 * Work the user did while the network was gone, kept on the device until it
 * can actually reach the server.
 *
 * Without this, an archive or a send made offline is applied to local state,
 * fails its request, and is lost the moment the tab reloads — while the UI
 * has already told the user it worked. Queued items survive a reload and are
 * replayed in the order they were made once the connection is confirmed.
 */

const KEY = "tria-outbox-v1";
/**
 * localStorage is a few MB and shared with the mail cache, so a big
 * attachment can't be parked here. Sends over this are rejected at queue time
 * with an honest error rather than silently dropped later.
 */
const MAX_ITEM_BYTES = 512 * 1024;

export type QueuedAction = {
  kind: "action";
  id: string;
  at: number;
  folder: Folder;
  uid: number;
  account?: string;
  action: MailAction;
};

export type QueuedSend = {
  kind: "send";
  id: string;
  at: number;
  /** The optimistic Sent-folder copy, so the UI can clear its "Queued" mark. */
  emailId: string;
  payload: {
    to: string;
    subject: string;
    text: string;
    inReplyTo?: string;
    references?: string[];
    account?: string;
    attachments?: OutgoingAttachment[];
  };
};

export type OutboxItem = QueuedAction | QueuedSend;

function read(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: OutboxItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage is full or blocked. Dropping the queue would lose the user's
    // work silently, so keep whatever is already persisted and let the
    // caller's enqueue report the failure.
  }
}

export const loadOutbox = (): OutboxItem[] => read();

export const outboxSize = (): number => read().length;

/**
 * Append an item. Returns false when it could not be stored — the caller is
 * expected to tell the user rather than pretend the work is safe.
 */
export function enqueue(item: OutboxItem): boolean {
  const encoded = JSON.stringify(item);
  if (encoded.length > MAX_ITEM_BYTES) return false;
  const next = [...read(), item];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    return read().length === next.length;
  } catch {
    return false;
  }
}

export function removeFromOutbox(id: string) {
  write(read().filter((i) => i.id !== id));
}

export function clearOutbox() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export type FlushResult = {
  sent: number;
  failed: number;
  /** Local ids of Sent-folder copies that have now really been sent. */
  deliveredEmailIds: string[];
};

/**
 * Replay the queue oldest-first.
 *
 * Items are removed only once their request has actually succeeded. A failure
 * stops the run and leaves the rest queued: order matters (an archive after a
 * move would target the wrong folder) and a still-flaky network would
 * otherwise burn through the whole queue turning every item into a failure.
 */
export async function flushOutbox(handlers: {
  runAction: (item: QueuedAction) => Promise<void>;
  runSend: (item: QueuedSend) => Promise<void>;
}): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, failed: 0, deliveredEmailIds: [] };
  for (const item of read()) {
    try {
      if (item.kind === "action") await handlers.runAction(item);
      else {
        await handlers.runSend(item);
        result.deliveredEmailIds.push(item.emailId);
      }
      removeFromOutbox(item.id);
      result.sent++;
    } catch {
      result.failed++;
      break;
    }
  }
  return result;
}
