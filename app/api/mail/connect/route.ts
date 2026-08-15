import { NextRequest, NextResponse } from "next/server";
import { COOKIE, MailConfig, sessions } from "@/lib/mail/store";
import { withImap } from "@/lib/mail/imap";
import { diagnoseBasicAuth, mailErrorMessage } from "@/lib/mail/errors";
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
  if (stored?.authType === "oauth" && stored.refreshTokenEnc && !body.pass) {
    // token-backed account: no password involved, the token is refreshed on use
    cfg = {
      user: stored.email,
      pass: "",
      imapHost: stored.imapHost,
      imapPort: stored.imapPort,
      smtpHost: stored.smtpHost,
      smtpPort: stored.smtpPort,
      oauthAccountId: stored.id,
    };
  } else if (body.user && body.pass && body.imapHost) {
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
  const provider = body.provider ?? stored?.provider;
  const failed = async (err: unknown) => {
    const authFailed = (err as { authenticationFailed?: boolean }).authenticationFailed;
    // an auth rejection may be tenant policy rather than a bad password
    const precise = authFailed && cfg ? await diagnoseBasicAuth(cfg) : null;
    return NextResponse.json(
      { ok: false, error: precise ?? mailErrorMessage(err, provider) },
      { status: 401 }
    );
  };

  try {
    await withImap(cfg, async () => true);
  } catch (e) {
    // App passwords are shown as "abcd efgh ijkl mnop" and get pasted with the
    // spaces, which the server rejects. Retry once without them before failing.
    const authFailed = (e as { authenticationFailed?: boolean }).authenticationFailed;
    const stripped = cfg.pass.replace(/\s+/g, "");
    if (authFailed && stripped !== cfg.pass && stripped.length > 0) {
      try {
        const retry = { ...cfg, pass: stripped };
        await withImap(retry, async () => true);
        cfg = retry;
      } catch (e2) {
        return failed(e2);
      }
    } else {
      return failed(e);
    }
  }
  // Success — persist the login (encrypted) so it survives restarts. OAuth
  // accounts own their tokens already; only mark them connected.
  if (cryptoReady) {
    const id = cfg.user;
    const existing = creds.accounts.find((a) => a.id === id);
    if (!cfg.oauthAccountId) {
      // when the connection came from a saved account, its own provider wins
      // over whatever preset the form happened to be showing
      const usedStored = !body.pass;
      creds.accounts = [
        ...creds.accounts.filter((a) => a.id !== id),
        {
          id,
          email: id,
          provider: usedStored
            ? existing?.provider ?? body.provider ?? "custom"
            : body.provider ?? existing?.provider ?? "custom",
          authType: "password",
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
    }
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
