import { NextRequest, NextResponse } from "next/server";
import { COOKIE, getAccounts, sessions } from "@/lib/mail/store";
import { resolveAccountIds } from "@/lib/mail/resolve";
import { setConnected } from "@/lib/server/creds";

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
  // A deliberate disconnect also opts the account out of auto-restore.
  // setConnected touches only the one id, so a concurrent writer on this
  // shared row can't be reverted by a stale whole-document save.
  try {
    const ids = account ? [account] : await resolveAccountIds(token);
    for (const id of ids) await setConnected(id, false);
  } catch {
    // non-fatal: session disconnect still succeeded
  }
  // Report what is still connected from the credential store, not from this
  // instance's session map. The map lives in globalThis, so a cold serverless
  // instance has an empty one — returning that told the client every account
  // had gone, and it cleared the whole mailbox for a single disconnect.
  return NextResponse.json({ ok: true, accounts: await resolveAccountIds(token) });
}
