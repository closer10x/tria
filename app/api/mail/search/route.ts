import { NextRequest, NextResponse } from "next/server";
import { COOKIE } from "@/lib/mail/store";
import { resolveAccount, resolveAllAccounts } from "@/lib/mail/resolve";
import { isRole, Role, searchMessages, WireEmail } from "@/lib/mail/imap";
import { mailErrorMessage } from "@/lib/mail/errors";

/**
 * Real search: IMAP SEARCH on the server across every folder of every
 * connected account (or one), so results aren't limited to whatever the
 * client happens to have loaded. Grammar: from:/to:/subject:/has:attachment/
 * is:unread/is:starred/before:/after:, "quoted phrases", free words.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ ok: true, messages: [] });
  const tz = req.nextUrl.searchParams.get("tz") ?? undefined;
  const account = req.nextUrl.searchParams.get("account");
  const roleParam = req.nextUrl.searchParams.get("role");
  const role: Role | "all" = roleParam && isRole(roleParam) ? roleParam : "all";
  try {
    let messages: WireEmail[];
    if (account && account !== "all") {
      const cfg = await resolveAccount(token, account);
      if (!cfg)
        return NextResponse.json({ ok: false, error: "Not connected" }, { status: 401 });
      messages = await searchMessages(cfg, q, { role, tz });
    } else {
      const accounts = await resolveAllAccounts(token);
      if (accounts.length === 0)
        return NextResponse.json({ ok: false, error: "Not connected" }, { status: 401 });
      const lists = await Promise.all(
        accounts.map((cfg) => searchMessages(cfg, q, { role, tz }).catch(() => []))
      );
      messages = lists.flat().sort((a, b) => {
        // subject/sender hits before body-only hits, then newest first
        if (a.match !== b.match) return a.match === "header" ? -1 : 1;
        return (b.sortDate ?? 0) - (a.sortDate ?? 0);
      });
    }
    return NextResponse.json({ ok: true, messages });
  } catch (e) {
    return NextResponse.json({ ok: false, error: mailErrorMessage(e) }, { status: 500 });
  }
}
