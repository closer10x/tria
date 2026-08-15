import { NextRequest, NextResponse } from "next/server";
import { simpleParser } from "mailparser";
import { COOKIE, getAccount } from "@/lib/mail/store";
import { resolveRole, Role, withImap } from "@/lib/mail/imap";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const cfg = getAccount(token, req.nextUrl.searchParams.get("account"));
  if (!cfg)
    return NextResponse.json({ ok: false, error: "Not connected" }, { status: 401 });
  const role = (req.nextUrl.searchParams.get("role") ?? "inbox") as Role;
  const uid = Number(req.nextUrl.searchParams.get("uid"));
  if (!uid)
    return NextResponse.json({ ok: false, error: "Missing uid" }, { status: 400 });
  try {
    const result = await withImap(cfg, async (client) => {
      const path = await resolveRole(client, role);
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
      { ok: false, error: e instanceof Error ? e.message : "Fetch failed" },
      { status: 500 }
    );
  }
}
