import { NextRequest, NextResponse } from "next/server";
import { COOKIE, MailConfig, sessions } from "@/lib/mail/store";
import { withImap } from "@/lib/mail/imap";
import { credAad, cryptoReady, decrypt, encrypt } from "@/lib/server/crypto";
import { loadCreds, saveCreds } from "@/lib/server/creds";
import { Provider } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<MailConfig> & {
    accountId?: string;
    provider?: Provider;
  };
  const creds = await loadCreds();
  const stored = cryptoReady
    ? creds.accounts.find((a) => a.id === (body.accountId ?? body.user))
    : undefined;

  let cfg: MailConfig | null = null;
  if (body.user && body.pass && body.imapHost) {
    cfg = {
      user: body.user,
      pass: body.pass,
      imapHost: body.imapHost,
      imapPort: body.imapPort ?? 993,
      smtpHost: body.smtpHost ?? body.imapHost.replace(/^imap/, "smtp"),
      smtpPort: body.smtpPort ?? 465,
    };
  } else if (stored?.passwordEnc) {
    // No password in the request — use the saved (encrypted) login. The
    // ciphertext is bound to email + hosts, so a tampered row fails closed.
    try {
      cfg = {
        user: stored.email,
        pass: decrypt(
          stored.passwordEnc,
          credAad(stored.email, stored.imapHost, stored.smtpHost)
        ),
        imapHost: stored.imapHost,
        imapPort: stored.imapPort,
        smtpHost: stored.smtpHost,
        smtpPort: stored.smtpPort,
      };
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Saved login can't be used with this account's current servers — re-enter the app password.",
        },
        { status: 401 }
      );
    }
  }
  if (!cfg) {
    return NextResponse.json(
      {
        ok: false,
        error: stored
          ? "No saved password for this account — enter the app password once to save it."
          : "Missing email, password, or IMAP host.",
      },
      { status: 400 }
    );
  }
  try {
    await withImap(cfg, async () => true);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "IMAP connection failed" },
      { status: 401 }
    );
  }
  // Success — persist the login (encrypted) so it survives restarts.
  if (cryptoReady) {
    const id = cfg.user;
    const existing = creds.accounts.find((a) => a.id === id);
    creds.accounts = [
      ...creds.accounts.filter((a) => a.id !== id),
      {
        id,
        email: id,
        provider: body.provider ?? existing?.provider ?? "custom",
        imapHost: cfg.imapHost,
        imapPort: cfg.imapPort,
        smtpHost: cfg.smtpHost,
        smtpPort: cfg.smtpPort,
        passwordEnc: encrypt(
          cfg.pass,
          credAad(id, cfg.imapHost, cfg.smtpHost)
        ),
      },
    ];
    if (!creds.connectedAccountIds.includes(id)) {
      creds.connectedAccountIds = [...creds.connectedAccountIds, id];
    }
    await saveCreds(creds);
  }

  // add to the existing session (multi-account) or start a new one
  let token = req.cookies.get(COOKIE)?.value;
  let accounts = token ? sessions.get(token) : undefined;
  if (!token || !accounts) {
    token = crypto.randomUUID();
    accounts = new Map();
    sessions.set(token, accounts);
  }
  accounts.set(cfg.user, cfg);
  const res = NextResponse.json({
    ok: true,
    accounts: Array.from(accounts.keys()),
  });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
