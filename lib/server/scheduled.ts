import { db, hasServiceKey } from "@/lib/server/db";
import { OutgoingMail } from "@/lib/mail/deliver";

/**
 * Scheduled sends. Rows live in `scheduled_mail` (RLS on, no anon policies —
 * bodies and attachments are private), so every access here needs the service
 * role. Delivery happens in /api/mail/scheduled/run, driven by Vercel cron.
 */

export type ScheduledStatus = "pending" | "sending" | "sent" | "failed" | "cancelled";

export type ScheduledMail = {
  id: string;
  account: string;
  payload: OutgoingMail;
  sendAt: string; // ISO
  status: ScheduledStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  sentAt?: string;
};

type Row = {
  id: string;
  account: string;
  payload: OutgoingMail;
  send_at: string;
  status: ScheduledStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

const rowToItem = (r: Row): ScheduledMail => ({
  id: r.id,
  account: r.account,
  payload: r.payload,
  sendAt: r.send_at,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error ?? undefined,
  createdAt: r.created_at,
  sentAt: r.sent_at ?? undefined,
});

/** Public shape for the client — attachments stripped (they can be MBs). */
export function toPublic(m: ScheduledMail) {
  const { attachments, ...rest } = m.payload;
  return {
    ...m,
    payload: { ...rest, attachmentCount: attachments?.length ?? 0 },
  };
}

function requireStore() {
  if (!db || !hasServiceKey)
    throw new Error(
      "Scheduled send needs SUPABASE_SERVICE_ROLE_KEY on the server (see .env.example)."
    );
}

export async function scheduleMail(input: {
  id: string;
  account: string;
  payload: OutgoingMail;
  sendAt: Date;
}): Promise<ScheduledMail> {
  requireStore();
  const { data, error } = await db!
    .from("scheduled_mail")
    .insert({
      id: input.id,
      account: input.account,
      payload: input.payload,
      send_at: input.sendAt.toISOString(),
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw new Error(`Couldn't schedule: ${error.message}`);
  return rowToItem(data as Row);
}

export async function listScheduled(): Promise<ScheduledMail[]> {
  requireStore();
  const { data, error } = await db!
    .from("scheduled_mail")
    .select("*")
    .in("status", ["pending", "sending", "failed"])
    .order("send_at");
  if (error) throw new Error(`Couldn't load scheduled mail: ${error.message}`);
  return (data as Row[]).map(rowToItem);
}

/** Cancel a pending send. Returns false if it already went out. */
export async function cancelScheduled(id: string): Promise<boolean> {
  requireStore();
  const { data, error } = await db!
    .from("scheduled_mail")
    .update({ status: "cancelled" })
    .eq("id", id)
    .in("status", ["pending", "failed"])
    .select("id");
  if (error) throw new Error(`Couldn't cancel: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Atomically claim due rows for delivery: flips pending→sending so a second
 * cron tick (or a second serverless instance) can't send the same message.
 */
export async function claimDue(limit = 20): Promise<ScheduledMail[]> {
  requireStore();
  const { data, error } = await db!.rpc("claim_due_scheduled_mail", { p_limit: limit });
  if (error) throw new Error(`Couldn't claim due mail: ${error.message}`);
  return ((data ?? []) as Row[]).map(rowToItem);
}

export async function markSent(id: string) {
  requireStore();
  await db!
    .from("scheduled_mail")
    .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
    .eq("id", id);
}

/** Retry later (back to pending) up to 3 attempts, then park as failed. */
export async function markFailed(id: string, attempts: number, message: string) {
  requireStore();
  const giveUp = attempts >= 3;
  await db!
    .from("scheduled_mail")
    .update({
      status: giveUp ? "failed" : "pending",
      last_error: message.slice(0, 500),
      // push the retry out a few minutes so a transient SMTP blip clears
      ...(giveUp ? {} : { send_at: new Date(Date.now() + 5 * 60_000).toISOString() }),
    })
    .eq("id", id);
}
