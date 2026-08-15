import { NextRequest, NextResponse } from "next/server";
import { resolveAccount } from "@/lib/mail/resolve";
import { deliverMail } from "@/lib/mail/deliver";
import { claimDue, markFailed, markSent } from "@/lib/server/scheduled";

/**
 * Delivery runner for scheduled mail. Vercel cron hits this every minute
 * (see vercel.json). Vercel signs cron requests with CRON_SECRET when that
 * env var is set; anything else calling this without it is rejected, so the
 * public URL can't be used to trigger sends.
 */

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let due;
  try {
    due = await claimDue();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "claim failed" },
      { status: 500 }
    );
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const item of due) {
    try {
      // no cookie here — resolve straight from the stored credentials
      const cfg = await resolveAccount(undefined, item.account);
      if (!cfg) throw new Error(`Account ${item.account} is no longer connected.`);
      await deliverMail(cfg, item.payload);
      await markSent(item.id);
      results.push({ id: item.id, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markFailed(item.id, item.attempts, msg);
      console.error("scheduled send failed", { id: item.id, account: item.account, msg });
      results.push({ id: item.id, ok: false, error: msg });
    }
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
}
