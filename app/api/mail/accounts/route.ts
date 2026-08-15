import { NextRequest, NextResponse } from "next/server";
import { COOKIE, getAccounts, sessions } from "@/lib/mail/store";

/** List the session's connected accounts. */
export async function GET(req: NextRequest) {
  const accounts = getAccounts(req.cookies.get(COOKIE)?.value);
  return NextResponse.json({ ok: true, accounts: Array.from(accounts?.keys() ?? []) });
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
  return NextResponse.json({ ok: true, accounts: Array.from(accounts?.keys() ?? []) });
}
