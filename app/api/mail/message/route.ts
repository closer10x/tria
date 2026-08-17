import { NextRequest, NextResponse } from "next/server";
import { simpleParser } from "mailparser";
import { COOKIE } from "@/lib/mail/store";
import { resolveAccount } from "@/lib/mail/resolve";
import {
  formatTime,
  hueOf,
  initialsOf,
  isRole,
  resolveRole,
  Role,
  withImap,
} from "@/lib/mail/imap";
import { mailErrorMessage } from "@/lib/mail/errors";
import { sanitizeEmailHtml, textToEmailHtml } from "@/lib/mail/render";

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
  const tz = req.nextUrl.searchParams.get("tz") ?? undefined;
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
        // plain paragraphs stay the machine-readable form (search, AI, drafts)
        const body = text
          .split(/\n{2,}/)
          .map((p) => p.replace(/\n/g, " ").trim())
          .filter(Boolean)
          .slice(0, 40);
        // the reader shows the real email: sanitized HTML part when there is
        // one, otherwise the text part with its link wrappers made clickable
        const html =
          typeof parsed.html === "string" && parsed.html.trim()
            ? sanitizeEmailHtml(parsed.html)
            : text
              ? textToEmailHtml(text)
              : "";
        // opening a message marks it read
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        // envelope too, so a caller that only has the id (a task's saved
        // sourceEmailId) can rebuild the whole row without it being in the
        // current mailbox page — see openSourceEmail in app/page.tsx
        const fromAddr = Array.isArray(parsed.from?.value)
          ? parsed.from!.value[0]
          : undefined;
        const fromName = fromAddr?.name || fromAddr?.address || "Unknown";
        return {
          body: body.length ? body : ["(no text content)"],
          html: html || undefined,
          messageId: parsed.messageId,
          references: parsed.references,
          from: {
            name: fromName,
            email: fromAddr?.address ?? "",
            initials: initialsOf(fromName),
            hue: hueOf(fromAddr?.address ?? fromName),
          },
          subject: parsed.subject || "(no subject)",
          time: formatTime(parsed.date ?? undefined, tz),
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
