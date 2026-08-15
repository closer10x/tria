import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { COOKIE, getAccount } from "@/lib/mail/store";
import { resolveRole, withImap } from "@/lib/mail/imap";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const { to, subject, text, inReplyTo, references, account } =
    (await req.json()) as {
      to: string;
      subject: string;
      text: string;
      inReplyTo?: string;
      references?: string[];
      account?: string;
    };
  const cfg = getAccount(token, account);
  if (!cfg)
    return NextResponse.json({ ok: false, error: "Not connected" }, { status: 401 });
  if (!to || !text)
    return NextResponse.json({ ok: false, error: "Missing to/text" }, { status: 400 });
  try {
    const mail = {
      from: cfg.user,
      to,
      subject: subject || "(no subject)",
      text,
      inReplyTo,
      references,
    };
    const transport = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpPort === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    await transport.sendMail(mail);
    // append a copy to Sent (Gmail does this automatically; harmless if duplicated)
    try {
      const raw = await new MailComposer(mail).compile().build();
      await withImap(cfg, async (client) => {
        const sent = await resolveRole(client, "sent");
        await client.append(sent, raw, ["\\Seen"]);
      });
    } catch {
      // non-fatal
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Send failed" },
      { status: 500 }
    );
  }
}
