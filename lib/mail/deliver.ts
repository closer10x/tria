import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { MailConfig } from "./store";
import { resolveRole, withImap } from "./imap";
import { GraphConsentError, sendViaGraph } from "./graph";

/**
 * The one delivery path for outgoing mail — used by the immediate send route
 * and by the scheduled-send runner, so both behave identically (Graph-first
 * for M365 OAuth accounts, SMTP otherwise, then a courtesy Sent copy).
 */

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
  /** any file type, base64-encoded */
  attachments?: { filename: string; contentType?: string; data: string }[];
};

export async function deliverMail(
  cfg: MailConfig,
  msg: OutgoingMail
): Promise<{ via: "graph" | "smtp" }> {
  const mail = {
    from: cfg.user,
    to: msg.to,
    subject: msg.subject || "(no subject)",
    text: msg.text,
    inReplyTo: msg.inReplyTo,
    references: msg.references,
    attachments: msg.attachments?.map((a) => ({
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
      return { via: "graph" };
    } catch (e) {
      if (e instanceof GraphConsentError) throw e;
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
        accessToken: await (await import("@/lib/server/oauth")).getAccessToken(
          cfg.oauthAccountId
        ),
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
      // no Sent folder — skip the courtesy copy rather than dropping it into the inbox
      if (sent) await client.append(sent, raw, ["\\Seen"]);
    });
  } catch {
    // non-fatal
  }
  return { via: "smtp" };
}
