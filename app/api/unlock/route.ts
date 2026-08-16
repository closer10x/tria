import { NextRequest, NextResponse } from "next/server";
import {
  UNLOCK_COOKIE,
  appPassword,
  armed,
  cookieOptions,
  issueToken,
} from "@/lib/server/appAuth";

/**
 * Trade the shared password for an unlock cookie. Deliberately the only route
 * the middleware lets through unauthenticated, so it stays small enough to
 * read in one go.
 */

export const dynamic = "force-dynamic";

/** Is the gate armed? Lets the client tell "locked" from "not configured". */
export async function GET() {
  return NextResponse.json({ ok: true, armed: armed() });
}

export async function POST(req: NextRequest) {
  if (!armed())
    return NextResponse.json(
      { ok: false, error: "No password is set on the server." },
      { status: 503 }
    );

  const { password } = (await req.json().catch(() => ({}))) as {
    password?: string;
  };
  const expected = appPassword();
  const given = (password ?? "").trim();

  // length-independent comparison; the lengths themselves are compared first
  // only because they are not secret
  let diff = given.length === expected.length ? 0 : 1;
  for (let i = 0; i < Math.max(given.length, expected.length); i++)
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0)
    return NextResponse.json({ ok: false }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(UNLOCK_COOKIE, await issueToken(), cookieOptions);
  return res;
}

/** Lock again — used by a "sign out" affordance and for testing. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(UNLOCK_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}
