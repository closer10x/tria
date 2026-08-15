import { NextRequest, NextResponse } from "next/server";
import { COOKIE } from "@/lib/mail/store";
import { resolveAccount } from "@/lib/mail/resolve";
import { OutgoingMail } from "@/lib/mail/deliver";
import {
  cancelScheduled,
  listScheduled,
  scheduleMail,
  toPublic,
} from "@/lib/server/scheduled";

/** Queue a message to be sent later. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const { account, sendAt, ...msg } = (await req.json()) as OutgoingMail & {
    account?: string;
    sendAt: string;
  };
  const cfg = await resolveAccount(token, account);
  if (!cfg)
    return NextResponse.json({ ok: false, error: "Not connected" }, { status: 401 });
  if (!msg.to || !msg.text)
    return NextResponse.json({ ok: false, error: "Missing to/text" }, { status: 400 });
  const when = new Date(sendAt);
  if (Number.isNaN(when.getTime()))
    return NextResponse.json({ ok: false, error: "Bad send time" }, { status: 400 });
  if (when.getTime() < Date.now() - 60_000)
    return NextResponse.json(
      { ok: false, error: "That time is in the past." },
      { status: 400 }
    );
  try {
    const item = await scheduleMail({
      id: `sch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      account: cfg.user,
      payload: msg,
      sendAt: when,
    });
    return NextResponse.json({ ok: true, scheduled: toPublic(item) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Couldn't schedule" },
      { status: 500 }
    );
  }
}

/** Everything still waiting (or failed) to go out. */
export async function GET() {
  try {
    const items = await listScheduled();
    return NextResponse.json({ ok: true, scheduled: items.map(toPublic) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Couldn't load" },
      { status: 500 }
    );
  }
}

/** Cancel one (?id=…) before it sends. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id)
    return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  try {
    const cancelled = await cancelScheduled(id);
    return NextResponse.json({
      ok: true,
      cancelled,
      ...(cancelled ? {} : { error: "Already sent — too late to cancel." }),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Couldn't cancel" },
      { status: 500 }
    );
  }
}
