import { createHash, randomBytes } from "crypto";
import { Provider } from "@/lib/types";
import { credAad, cryptoReady, decrypt, encrypt } from "@/lib/server/crypto";
import {
  loadCreds,
  mergeAccount,
  saveCreds,
  StoredAccount,
} from "@/lib/server/creds";

/**
 * OAuth sign-in for mail accounts (XOAUTH2).
 * Microsoft 365 tenants and Google both block plain-password IMAP/SMTP, so the
 * durable path is an access token. Refresh tokens are stored with the same
 * AES-256-GCM envelope as passwords — they never reach the client.
 */

export type OAuthProvider = "microsoft" | "google";

type ProviderConfig = {
  label: string;
  authUrl: string;
  tokenUrl: string;
  /** Asked for at consent time; may span more than one resource. */
  scopes: string;
  /**
   * Asked for when redeeming a code or a refresh token. A Microsoft access
   * token is issued for exactly one resource, so this must name a single one —
   * and once `scopes` spans two, Microsoft can no longer infer which is meant
   * and rejects the exchange with AADSTS28003. Defaults to `scopes`.
   */
  tokenScopes?: string;
  extraAuthParams: Record<string, string>;
  clientId?: string;
  clientSecret?: string;
  /** Mail settings applied to accounts created through this provider. */
  mail: {
    provider: Provider;
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
  };
};

export const providers: Record<OAuthProvider, ProviderConfig> = {
  microsoft: {
    label: "Microsoft",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [
      "offline_access",
      "openid",
      "email",
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "https://outlook.office.com/SMTP.Send",
      // Graph is a second resource, which Microsoft accepts here for consent
      // even though each token request returns only one resource. Sending
      // needs it whenever the tenant has SMTP AUTH switched off — see
      // lib/mail/graph.ts.
      "https://graph.microsoft.com/Mail.Send",
    ].join(" "),
    // IMAP and SMTP only: the Graph token is fetched separately from the
    // refresh token, by getGraphAccessToken, with its own single resource.
    tokenScopes: [
      "offline_access",
      "openid",
      "email",
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "https://outlook.office.com/SMTP.Send",
    ].join(" "),
    // prompt=consent forces the consent screen on every sign-in. Without it,
    // Microsoft silently reuses an earlier consent — so an account that first
    // connected before Mail.Send was requested never gets asked for it, and
    // sending keeps failing with AADSTS65001 no matter how often you reconnect.
    extraAuthParams: { response_mode: "query", prompt: "consent" },
    clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
    mail: {
      provider: "m365",
      imapHost: "outlook.office365.com",
      imapPort: 993,
      smtpHost: "smtp.office365.com",
      smtpPort: 587,
    },
  },
  google: {
    label: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "https://mail.google.com/"].join(" "),
    // Google only returns a refresh token with these two
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    mail: {
      provider: "gmail",
      imapHost: "imap.gmail.com",
      imapPort: 993,
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
    },
  },
};

export const isOAuthProvider = (v: string): v is OAuthProvider =>
  v === "microsoft" || v === "google";

/** Only a client ID is required — PKCE covers registrations without a secret. */
export const oauthConfigured = (p: OAuthProvider) => Boolean(providers[p].clientId);

export const redirectUri = (origin: string, p: OAuthProvider) =>
  `${origin}/api/oauth/${p}/callback`;

export const STATE_COOKIE = "tria_oauth_state";

/** PKCE verifier/challenge pair (RFC 7636). */
export function makePkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthUrl(
  p: OAuthProvider,
  origin: string,
  state: string,
  codeChallenge: string
): string {
  const cfg = providers[p];
  const params = new URLSearchParams({
    client_id: cfg.clientId!,
    response_type: "code",
    redirect_uri: redirectUri(origin, p),
    scope: cfg.scopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    ...cfg.extraAuthParams,
  });
  return `${cfg.authUrl}?${params}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function postToken(
  p: OAuthProvider,
  body: Record<string, string>
): Promise<TokenResponse> {
  const cfg = providers[p];
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId!,
      // omitted for public-client registrations, where PKCE is the proof
      ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
      ...body,
    }),
  });
  return (await res.json()) as TokenResponse;
}

/** The address the user signed in as, read from the id_token claims. */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")
    ) as { email?: string; preferred_username?: string; upn?: string };
    return payload.email ?? payload.preferred_username ?? payload.upn ?? null;
  } catch {
    return null;
  }
}

const tokenAad = (email: string, p: OAuthProvider) => `${email}|oauth|${p}`;

/**
 * Providers answer a failed exchange with an opaque error code. Translate the
 * setup mistakes into something the person configuring the app can act on.
 */
function signInErrorMessage(p: OAuthProvider, tok: TokenResponse): string {
  const raw = `${tok.error_description ?? ""} ${tok.error ?? ""}`;
  const label = providers[p].label;

  if (p === "google") {
    if (/redirect_uri_mismatch/i.test(raw))
      return "This redirect URI isn't listed on the Google OAuth client. Add /api/oauth/google/callback under Authorised redirect URIs, exactly as the app is served.";
    if (/invalid_client|unauthorized_client/i.test(raw))
      return "Google rejected the client credentials — check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET match the same OAuth client.";
    if (/invalid_grant/i.test(raw))
      return "Google rejected the authorisation code. It may have already been used or expired — try signing in again.";
    if (/admin_policy_enforced/i.test(raw))
      return "A Google Workspace admin policy blocks this app for your account. An admin has to allow it before mail access will work.";
    if (/access_denied/i.test(raw))
      return "Google denied the sign-in. While the app is unverified, only accounts added as Test users on its OAuth consent screen may grant Gmail access.";
    if (/org_internal/i.test(raw))
      return "This OAuth client is limited to a different organisation — set its user type so your account can use it.";
  }

  if (/AADSTS7000218|client_assertion.*client_secret|invalid_client/i.test(raw))
    return `${label} rejected the sign-in because the app registration needs a client secret. Its redirect URI is registered as a "Web" platform, which requires one even with PKCE — create a secret in the app registration and set ${p === "microsoft" ? "MICROSOFT_OAUTH_CLIENT_SECRET" : "GOOGLE_OAUTH_CLIENT_SECRET"}, then redeploy.`;
  if (/AADSTS9002327/i.test(raw))
    return `The app registration lists this redirect URI under "Single-page application". Move it to the "Web" platform — tokens are exchanged on the server.`;
  if (/AADSTS50011|redirect_uri|redirect URI/i.test(raw))
    return `The redirect URI doesn't match the app registration. It must be exactly ${"<your domain>"}/api/oauth/${p}/callback.`;
  if (/AADSTS65001|consent_required|admin_consent/i.test(raw))
    return `${label} needs an administrator to approve this app for your organisation before it can read mail.`;
  if (/AADSTS700016|unauthorized_client|application.*not found/i.test(raw))
    return `${label} doesn't recognise this client ID for your organisation — check the app registration and that it allows accounts from any directory.`;

  return tok.error_description ?? tok.error ?? "Sign-in failed";
}

/** Exchange the callback code and persist the account. Returns its email. */
export async function completeSignIn(
  p: OAuthProvider,
  code: string,
  origin: string,
  codeVerifier: string
): Promise<{ email: string } | { error: string }> {
  if (!cryptoReady) return { error: "TRIA_ENC_KEY is not set on the server." };
  const tok = await postToken(p, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(origin, p),
    code_verifier: codeVerifier,
    scope: providers[p].tokenScopes ?? providers[p].scopes,
  });
  if (tok.error || !tok.access_token)
    return { error: signInErrorMessage(p, tok) };
  if (!tok.refresh_token)
    return {
      error:
        "No refresh token was returned — revoke the app's access and sign in again so it prompts for consent.",
    };

  const email = emailFromIdToken(tok.id_token);
  if (!email) return { error: "Could not read the account address from the sign-in." };

  const mail = providers[p].mail;
  const creds = await loadCreds();
  const existing = creds.accounts.find((a) => a.id === email);
  const account: StoredAccount = {
    ...existing,
    id: email,
    email,
    provider: mail.provider,
    imapHost: mail.imapHost,
    imapPort: mail.imapPort,
    smtpHost: mail.smtpHost,
    smtpPort: mail.smtpPort,
    // a token-backed account never uses the old password
    passwordEnc: undefined,
    authType: "oauth",
    oauthProvider: p,
    refreshTokenEnc: encrypt(tok.refresh_token, tokenAad(email, p)),
    accessTokenEnc: encrypt(tok.access_token, tokenAad(email, p)),
    accessTokenExpiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
  };
  creds.accounts = [...creds.accounts.filter((a) => a.id !== email), account];
  if (!creds.connectedAccountIds.includes(email))
    creds.connectedAccountIds = [...creds.connectedAccountIds, email];
  await saveCreds(creds);
  return { email };
}

/** A usable access token for an OAuth account, refreshing when it has aged out. */
export async function getAccessToken(accountId: string): Promise<string> {
  const creds = await loadCreds();
  const account = creds.accounts.find((a) => a.id === accountId);
  if (!account || account.authType !== "oauth" || !account.oauthProvider)
    throw new Error(`No OAuth account for ${accountId}`);
  const p = account.oauthProvider;
  const aad = tokenAad(account.email, p);

  const fresh =
    account.accessTokenEnc &&
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt - Date.now() > 60_000;
  if (fresh) return decrypt(account.accessTokenEnc!, aad);

  if (!account.refreshTokenEnc)
    throw new Error(`${accountId} needs to sign in again.`);
  const tok = await postToken(p, {
    grant_type: "refresh_token",
    refresh_token: decrypt(account.refreshTokenEnc, aad),
    // name the resource explicitly: without it, a refresh against a
    // multi-resource consent can come back as a Graph token, which IMAP and
    // SMTP would then reject
    scope: providers[p].tokenScopes ?? providers[p].scopes,
  });
  if (tok.error || !tok.access_token)
    throw new Error(
      tok.error_description ?? `${accountId} needs to sign in again.`
    );

  // Merge this one account's tokens in a single statement. Writing the whole
  // document back would revert every account added or changed since the read
  // above — with several dev servers and production sharing one row, that is
  // how a saved account disappears.
  await mergeAccount(accountId, {
    accessTokenEnc: encrypt(tok.access_token, aad),
    accessTokenExpiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
    // providers may hand back a rotated refresh token; keep the old one
    // otherwise rather than merging an undefined over it
    ...(tok.refresh_token
      ? { refreshTokenEnc: encrypt(tok.refresh_token, aad) }
      : {}),
  });
  return tok.access_token;
}

/** What Graph needs to send as the signed-in user. */
export const GRAPH_SEND_SCOPE =
  "offline_access https://graph.microsoft.com/Mail.Send";

/**
 * A Graph access token for the same account, redeemed from the stored refresh
 * token. Microsoft access tokens are audience-scoped, so the outlook.office.com
 * token used for IMAP cannot be replayed against graph.microsoft.com — but a
 * single refresh token can be exchanged for either, as long as the app
 * registration carries the scope and the user has consented to it.
 *
 * This is the way out of a tenant with SMTP AUTH disabled: that switch blocks
 * the SMTP protocol, not the mailbox, and Graph sendMail is unaffected by it.
 */
export async function getGraphAccessToken(accountId: string): Promise<string> {
  const creds = await loadCreds();
  const account = creds.accounts.find((a) => a.id === accountId);
  if (
    !account ||
    account.authType !== "oauth" ||
    account.oauthProvider !== "microsoft"
  )
    throw new Error(`${accountId} is not a Microsoft account.`);
  if (!account.refreshTokenEnc)
    throw new Error(`${accountId} needs to sign in again.`);

  const aad = tokenAad(account.email, "microsoft");
  const tok = await postToken("microsoft", {
    grant_type: "refresh_token",
    refresh_token: decrypt(account.refreshTokenEnc, aad),
    scope: GRAPH_SEND_SCOPE,
  });
  if (tok.error || !tok.access_token)
    throw Object.assign(
      new Error(tok.error_description ?? "Graph rejected the token request."),
      { oauthError: tok.error }
    );

  // Microsoft may rotate the refresh token on any redemption; dropping the new
  // one would strand the account at the next refresh.
  if (tok.refresh_token)
    await mergeAccount(accountId, {
      refreshTokenEnc: encrypt(tok.refresh_token, aad),
    });
  return tok.access_token;
}

/** Re-export so callers building password configs keep one import site. */
export { credAad };
