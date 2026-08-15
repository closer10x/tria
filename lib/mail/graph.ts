import { getGraphAccessToken } from "@/lib/server/oauth";

/**
 * Sending through Microsoft Graph instead of SMTP.
 *
 * A tenant can turn off SMTP AUTH (Microsoft's default for new tenants since
 * 2020, and irreversible per-tenant policy in some org configurations). That
 * switch rejects every SMTP login with 535 5.7.139 no matter how valid the
 * credential is — an OAuth token that reads mail happily over IMAP still
 * cannot send. Graph's sendMail is a different surface and is unaffected, so
 * it is the durable path for Microsoft accounts; SMTP stays as the fallback
 * for tenants that still allow it.
 */

const GRAPH_SEND_URL = "https://graph.microsoft.com/v1.0/me/sendMail";

/** Graph caps a MIME upload at 4 MB; larger needs a draft + upload session. */
export const GRAPH_MIME_LIMIT = 4 * 1024 * 1024;

export class GraphConsentError extends Error {}

/**
 * Send a prebuilt MIME message as the signed-in user. Graph files the copy in
 * Sent Items itself, so callers must not also append over IMAP.
 */
export async function sendViaGraph(
  oauthAccountId: string,
  mime: Buffer
): Promise<void> {
  let token: string;
  try {
    token = await getGraphAccessToken(oauthAccountId);
  } catch (e) {
    const err = e as { message?: string; oauthError?: string };
    // AADSTS65001: the account has never consented to Mail.Send. Reconnecting
    // grants it, because the scope is now part of the sign-in request.
    if (/AADSTS65001|consent/i.test(err.message ?? ""))
      throw new GraphConsentError(
        "This account hasn't granted permission to send yet. Open Settings, disconnect this account and sign in again — the new sign-in asks for send access."
      );
    throw e;
  }

  if (mime.byteLength > GRAPH_MIME_LIMIT)
    throw new Error(
      `That message is ${(mime.byteLength / 1024 / 1024).toFixed(1)} MB. Graph accepts up to 4 MB — remove or shrink an attachment.`
    );

  const res = await fetch(GRAPH_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: mime.toString("base64"),
  });

  // a successful send is 202 with an empty body
  if (res.status === 202 || res.ok) return;

  const detail = await res.text().catch(() => "");
  let msg = "";
  try {
    msg = (JSON.parse(detail) as { error?: { message?: string } }).error?.message ?? "";
  } catch {
    msg = detail.slice(0, 200);
  }
  if (res.status === 401 || res.status === 403)
    throw new GraphConsentError(
      msg ||
        "Microsoft refused the send permission. Reconnect the account in Settings to grant it."
    );
  throw new Error(`Microsoft Graph refused the message (${res.status})${msg ? `: ${msg}` : ""}`);
}
