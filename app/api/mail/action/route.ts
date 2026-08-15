import { NextRequest, NextResponse } from "next/server";
import { COOKIE } from "@/lib/mail/store";
import { resolveAccount } from "@/lib/mail/resolve";
import { resolveRole, Role, withImap } from "@/lib/mail/imap";
import { mailErrorMessage } from "@/lib/mail/errors";
import { MailAction } from "@/lib/types";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const { role, uid, action, account } = (await req.json()) as {
    role: Role;
    uid: number;
    action: MailAction;
    account?: string;
  };
  const cfg = await resolveAccount(token, account);
  if (!cfg)
    return NextResponse.json({ ok: false, error: "Not connected" }, { status: 401 });
  if (!uid || !action)
    return NextResponse.json({ ok: false, error: "Missing uid/action" }, { status: 400 });
  try {
    await withImap(cfg, async (client) => {
      const path = await resolveRole(client, role ?? "inbox");
      if (!path) throw new Error(`This account has no ${role ?? "inbox"} folder.`);
      const lock = await client.getMailboxLock(path);
      try {
        const uidStr = String(uid);
        const opts = { uid: true };
        switch (action) {
          case "read":
            await client.messageFlagsAdd(uidStr, ["\\Seen"], opts);
            break;
          case "unread":
            await client.messageFlagsRemove(uidStr, ["\\Seen"], opts);
            break;
          case "star":
            await client.messageFlagsAdd(uidStr, ["\\Flagged"], opts);
            break;
          case "unstar":
            await client.messageFlagsRemove(uidStr, ["\\Flagged"], opts);
            break;
          case "archive":
          case "trash":
          case "inbox":
          case "snooze": {
            const targetRole: Role =
              action === "snooze" ? "snoozed" : action === "inbox" ? "inbox" : action;
            // create only for snooze — the folder is Tria's to make; the
            // rest must already exist. Never fall back to INBOX: moving a
            // message inbox→inbox and reporting success loses it silently.
            const target = await resolveRole(client, targetRole, {
              create: targetRole === "snoozed",
            });
            if (!target)
              throw new Error(
                targetRole === "snoozed"
                  ? "Couldn't create the Tria/Snoozed folder on this mail server."
                  : `This account has no ${targetRole} folder, so the message wasn't moved.`
              );
            await client.messageMove(uidStr, target, opts);
            break;
          }
        }
      } finally {
        lock.release();
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: mailErrorMessage(e) },
      { status: 500 }
    );
  }
}
