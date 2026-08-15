import { NextRequest, NextResponse } from "next/server";
import { simpleParser } from "mailparser";
import { COOKIE } from "@/lib/mail/store";
import { resolveAccount } from "@/lib/mail/resolve";
import { isRole, resolveRole, Role, withImap } from "@/lib/mail/imap";
import { mailErrorMessage } from "@/lib/mail/errors";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const cfg = await resolveAccount(token, req.nextUrl.searchParams.get("account"));
  if (!cfg)
    return NextResponse.json({ ok: false, error: "Not connected" }, { status: 401 });
  const roleParam = req.nextUrl.searchParams.get("role") ?? "inbox";
  if (!isRole(roleParam))
    return NextResponse.json({ ok: false, error: "Unknown folder" }, { status: 400 });
  const role: Role = roleParam;
  const uid = Number(req.nextUrl.searchParams.get("uid"));
  if (!uid)
    return NextResponse.json({ ok: false, error: "Missing uid" }, { status: 400 });
  try {
    const result = await withImap(cfg, async (client) => {
      const path = await resolveRole(client, role);
      // uids are per-folder: reading INBOX instead would return a different
      // message entirely
      if (!path) throw new Error(`This account has no ${role} folder.`);
      const lock = await client.getMailboxLock(path);
      try {
        const dl = await client.download(String(uid), undefined, { uid: true });
        const parsed = await simpleParser(dl.content);
        const text = (parsed.text ?? "").trim();
        const body = text
          .split(/\n{2,}/)
          .map((p) => p.replace(/\n/g, " ").trim())
          .filter(Boolean)
          .slice(0, 40);
        // opening a message marks it read
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        return {
          body: body.length ? body : ["(no text content)"],
          messageId: parsed.messageId,
          references: parsed.references,
        };
      } finally {
        lock.release();
      }
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: mailErrorMessage(e) },
      { status: 500 }
    );
  }
}
