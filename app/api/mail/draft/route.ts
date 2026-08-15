import { NextRequest, NextResponse } from "next/server";
import MailComposer from "nodemailer/lib/mail-composer";
import { COOKIE } from "@/lib/mail/store";
import { resolveAccount } from "@/lib/mail/resolve";
import { resolveRole, withImap } from "@/lib/mail/imap";
import { mailErrorMessage } from "@/lib/mail/errors";

/** Save a draft into the account's real Drafts mailbox (IMAP APPEND). */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const { to, subject, text, account, replaceUid } = (await req.json()) as {
    to?: string;
    subject?: string;
    text?: string;
    account?: string;
    /** uid of the previous version of this draft, replaced on save */
    replaceUid?: number;
  };
  const cfg = await resolveAccount(token, account);
  if (!cfg)
    return NextResponse.json({ ok: false, error: "Not connected" }, { status: 401 });

  try {
    const raw = await new MailComposer({
      from: cfg.user,
      to: to || undefined,
      subject: subject || "",
      text: text || "",
    })
      .compile()
      .build();

    const uid = await withImap(cfg, async (client) => {
      const drafts = await resolveRole(client, "drafts");
      // drop the superseded copy so saving twice doesn't pile up drafts
      if (replaceUid) {
        const lock = await client.getMailboxLock(drafts);
        try {
          await client.messageDelete(String(replaceUid), { uid: true });
        } catch {
          // the old copy may already be gone — not fatal
        } finally {
          lock.release();
        }
      }
      const res = await client.append(drafts, raw, ["\\Draft", "\\Seen"]);
      return res && typeof res === "object" && "uid" in res
        ? (res.uid as number | undefined)
        : undefined;
    });

    return NextResponse.json({ ok: true, uid });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: mailErrorMessage(e) },
      { status: 500 }
    );
  }
}
