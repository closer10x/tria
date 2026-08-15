import { NextRequest, NextResponse } from "next/server";
import { COOKIE } from "@/lib/mail/store";
import { resolveAccount } from "@/lib/mail/resolve";
import { mailErrorMessage } from "@/lib/mail/errors";
import { GraphConsentError } from "@/lib/mail/graph";
import { deliverMail, OutgoingMail } from "@/lib/mail/deliver";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const { account, ...msg } = (await req.json()) as OutgoingMail & {
    account?: string;
  };
  const cfg = await resolveAccount(token, account);
  if (!cfg)
    return NextResponse.json({ ok: false, error: "Not connected" }, { status: 401 });
  if (!msg.to || !msg.text)
    return NextResponse.json({ ok: false, error: "Missing to/text" }, { status: 400 });
  try {
    const { via } = await deliverMail(cfg, msg);
    return NextResponse.json({ ok: true, via });
  } catch (e) {
    // log the raw failure so production sends are diagnosable from the logs
    console.error("send failed", {
      account: cfg.user,
      smtp: `${cfg.smtpHost}:${cfg.smtpPort}`,
      response: (e as { response?: string }).response,
      message: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      {
        ok: false,
        // a consent failure already carries the instruction to fix it
        error: e instanceof GraphConsentError ? e.message : mailErrorMessage(e),
      },
      { status: 500 }
    );
  }
}
