import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { COOKIE } from "@/lib/mail/store";
import { resolveAccount } from "@/lib/mail/resolve";
import { resolveRole, withImap } from "@/lib/mail/imap";
import { mailErrorMessage } from "@/lib/mail/errors";
import { GraphConsentError, sendViaGraph } from "@/lib/mail/graph";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const { to, subject, text, inReplyTo, references, account, attachments } =
    (await req.json()) as {
      to: string;
      subject: string;
      text: string;
      inReplyTo?: string;
      references?: string[];
      account?: string;
      /** any file type, base64-encoded by the browser */
      attachments?: { filename: string; contentType?: string; data: string }[];
    };
  const cfg = await resolveAccount(token, account);
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
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        content: a.data,
        encoding: "base64" as const,
      })),
    };
    const raw = await new MailComposer(mail).compile().build();

    // Microsoft OAuth accounts go through Graph first: a tenant with SMTP AUTH
    // disabled rejects every SMTP login regardless of credential, and Graph is
    // unaffected. SMTP stays as the fallback for tenants that still allow it.
    if (cfg.oauthAccountId && /office365\.com$/i.test(cfg.smtpHost)) {
      try {
        await sendViaGraph(cfg.oauthAccountId, raw);
        // Graph files its own copy in Sent Items — appending would duplicate it
        return NextResponse.json({ ok: true, via: "graph" });
      } catch (e) {
        if (e instanceof GraphConsentError) throw e;
        // anything else (a Graph outage, an oversized message): try SMTP
        console.error("graph send failed, falling back to smtp", {
          account: cfg.user,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const auth = cfg.oauthAccountId
      ? {
          type: "OAuth2" as const,
          user: cfg.user,
          accessToken: await (
            await import("@/lib/server/oauth")
          ).getAccessToken(cfg.oauthAccountId),
        }
      : { user: cfg.user, pass: cfg.pass };
    const transport = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpPort === 465,
      requireTLS: cfg.smtpPort !== 465,
      auth,
    });
    await transport.sendMail(mail);
    // append a copy to Sent (Gmail does this automatically; harmless if duplicated)
    try {
      await withImap(cfg, async (client) => {
        const sent = await resolveRole(client, "sent");
        // no Sent folder — skip the courtesy copy rather than dropping it
        // into the inbox
        if (sent) await client.append(sent, raw, ["\\Seen"]);
      });
    } catch {
      // non-fatal
    }
    return NextResponse.json({ ok: true, via: "smtp" });
  } catch (e) {
    // log the raw failure so production sends are diagnosable from the logs
    console.error("send failed", {
      account: cfg.user,
      smtp: `${cfg.smtpHost}:${cfg.smtpPort}`,
      response: (e as { response?: string }).response,
      message: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      {
        ok: false,
        // a consent failure already carries the instruction to fix it
        error: e instanceof GraphConsentError ? e.message : mailErrorMessage(e),
      },
      { status: 500 }
    );
  }
}
