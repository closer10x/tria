import { NextRequest, NextResponse } from "next/server";
import { COOKIE, getAccount, getAccounts } from "@/lib/mail/store";
import { listMessages, Role, WireEmail } from "@/lib/mail/imap";
import { mailErrorMessage } from "@/lib/mail/errors";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const role = (req.nextUrl.searchParams.get("role") ?? "inbox") as Role;
  const tz = req.nextUrl.searchParams.get("tz") ?? undefined;
  const account = req.nextUrl.searchParams.get("account");
  try {
    let messages: WireEmail[];
    if (account && account !== "all") {
      const cfg = getAccount(token, account);
      if (!cfg)
        return NextResponse.json({ ok: false, error: "Not connected" }, { status: 401 });
      messages = await listMessages(cfg, role, tz);
    } else {
      // unified view — fetch every connected account in parallel and merge
      const accounts = getAccounts(token);
      if (!accounts || accounts.size === 0)
        return NextResponse.json({ ok: false, error: "Not connected" }, { status: 401 });
      const lists = await Promise.all(
        Array.from(accounts.values()).map((cfg) => listMessages(cfg, role, tz))
      );
      messages = lists
        .flat()
        .sort((a, b) => (b.sortDate ?? 0) - (a.sortDate ?? 0));
    }
    return NextResponse.json({ ok: true, messages });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: mailErrorMessage(e) },
      { status: 500 }
    );
  }
}
