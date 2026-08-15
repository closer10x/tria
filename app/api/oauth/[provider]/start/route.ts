import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthUrl,
  isOAuthProvider,
  oauthConfigured,
  providers,
  STATE_COOKIE,
} from "@/lib/server/oauth";

/** Kicks off sign-in: redirects the browser to the provider's consent screen. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const origin = req.nextUrl.origin;
  const fail = (msg: string) =>
    NextResponse.redirect(`${origin}/?oauth_error=${encodeURIComponent(msg)}`);

  if (!isOAuthProvider(provider)) return fail("Unknown sign-in provider.");
  if (!oauthConfigured(provider))
    return fail(
      `${providers[provider].label} sign-in isn't configured on the server yet — add its client ID and secret.`
    );

  const state = crypto.randomUUID();
  const res = NextResponse.redirect(buildAuthUrl(provider, origin, state));
  // round-tripped and compared in the callback to block forged redirects
  res.cookies.set(STATE_COOKIE, `${provider}:${state}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
