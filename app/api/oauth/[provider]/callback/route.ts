import { NextRequest, NextResponse } from "next/server";
import { completeSignIn, isOAuthProvider, STATE_COOKIE } from "@/lib/server/oauth";
import { COOKIE, sessions } from "@/lib/mail/store";
import { loadCreds } from "@/lib/server/creds";

/** Provider redirects back here with ?code — exchange it and open a session. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const origin = req.nextUrl.origin;
  const fail = (msg: string) =>
    NextResponse.redirect(`${origin}/?oauth_error=${encodeURIComponent(msg)}`);

  if (!isOAuthProvider(provider)) return fail("Unknown sign-in provider.");

  const denied = req.nextUrl.searchParams.get("error_description");
  if (denied) return fail(denied);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) return fail("Sign-in was cancelled.");

  const cookie = req.cookies.get(STATE_COOKIE)?.value ?? "";
  const [cookieProvider, cookieState, verifier] = cookie.split(":");
  if (cookieProvider !== provider || cookieState !== state || !verifier)
    return fail("Sign-in could not be verified — please try again.");

  const result = await completeSignIn(provider, code, origin, verifier);
  if ("error" in result) return fail(result.error);

  // open a live session for the account we just linked
  const account = (await loadCreds()).accounts.find((a) => a.id === result.email);
  const res = NextResponse.redirect(
    `${origin}/?oauth_connected=${encodeURIComponent(result.email)}`
  );
  if (account) {
    let token = req.cookies.get(COOKIE)?.value;
    let open = token ? sessions.get(token) : undefined;
    if (!token || !open) {
      token = crypto.randomUUID();
      open = new Map();
      sessions.set(token, open);
    }
    open.set(account.email, {
      user: account.email,
      pass: "",
      imapHost: account.imapHost,
      imapPort: account.imapPort,
      smtpHost: account.smtpHost,
      smtpPort: account.smtpPort,
      oauthAccountId: account.id,
    });
    res.cookies.set(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }
  res.cookies.delete(STATE_COOKIE);
  return res;
}
