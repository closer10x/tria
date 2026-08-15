import { NextRequest, NextResponse } from "next/server";
import { COOKIE, getAccounts, sessions } from "@/lib/mail/store";
import { resolveAccountIds } from "@/lib/mail/resolve";
import { loadCreds, saveCreds } from "@/lib/server/creds";

/** List connected accounts — from this instance's session or the credential store. */
export async function GET(req: NextRequest) {
  const accounts = await resolveAccountIds(req.cookies.get(COOKIE)?.value);
  return NextResponse.json({ ok: true, accounts });
}

/** Disconnect one account (?account=…) or all of them. */
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const accounts = getAccounts(token);
  const account = req.nextUrl.searchParams.get("account");
  if (accounts) {
    if (account) accounts.delete(account);
    else accounts.clear();
    if (accounts.size === 0 && token) sessions.delete(token);
  }
  // a deliberate disconnect also opts the account out of auto-restore
  try {
    const creds = await loadCreds();
    const remaining = account
      ? creds.connectedAccountIds.filter((x) => x !== account)
      : [];
    if (remaining.length !== creds.connectedAccountIds.length) {
      creds.connectedAccountIds = remaining;
      await saveCreds(creds);
    }
  } catch {
    // non-fatal: session disconnect still succeeded
  }
  return NextResponse.json({ ok: true, accounts: Array.from(accounts?.keys() ?? []) });
}
