import { NextRequest, NextResponse } from "next/server";
import { credAad, cryptoReady, encrypt } from "@/lib/server/crypto";
import { loadCreds, saveCreds, StoredAccount, toPublic } from "@/lib/server/creds";
import { Provider } from "@/lib/types";

export async function GET() {
  const creds = await loadCreds();
  return NextResponse.json({
    ok: true,
    accounts: creds.accounts.map(toPublic),
    connectedAccountIds: creds.connectedAccountIds,
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    email?: string;
    provider?: Provider;
    imapHost?: string;
    imapPort?: number;
    smtpHost?: string;
    smtpPort?: number;
    password?: string;
  };
  if (!body.email?.trim() || !body.imapHost?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Email and IMAP host are required." },
      { status: 400 }
    );
  }
  const creds = await loadCreds();
  const id = body.email.trim();
  const existing = creds.accounts.find((a) => a.id === id);
  const imapHost = body.imapHost;
  const smtpHost =
    body.smtpHost ?? existing?.smtpHost ?? body.imapHost.replace(/^imap/, "smtp");
  // ciphertext is bound to email+hosts; a stored password from different
  // hosts can't decrypt anymore, so drop it rather than keep a dead value
  const hostsUnchanged =
    existing?.imapHost === imapHost && existing?.smtpHost === smtpHost;
  const account: StoredAccount = {
    id,
    email: id,
    provider: body.provider ?? existing?.provider ?? "custom",
    imapHost,
    imapPort: body.imapPort ?? existing?.imapPort ?? 993,
    smtpHost,
    smtpPort: body.smtpPort ?? existing?.smtpPort ?? 465,
    passwordEnc:
      body.password && cryptoReady
        ? encrypt(body.password, credAad(id, imapHost, smtpHost))
        : hostsUnchanged
          ? existing?.passwordEnc
          : undefined,
  };
  creds.accounts = [...creds.accounts.filter((a) => a.id !== id), account];
  await saveCreds(creds);
  return NextResponse.json({
    ok: true,
    accounts: creds.accounts.map(toPublic),
    connectedAccountIds: creds.connectedAccountIds,
  });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing account id." }, { status: 400 });
  }
  const creds = await loadCreds();
  creds.accounts = creds.accounts.filter((a) => a.id !== id);
  creds.connectedAccountIds = creds.connectedAccountIds.filter((x) => x !== id);
  await saveCreds(creds);
  return NextResponse.json({
    ok: true,
    accounts: creds.accounts.map(toPublic),
    connectedAccountIds: creds.connectedAccountIds,
  });
}
