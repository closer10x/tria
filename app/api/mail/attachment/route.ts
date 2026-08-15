import { NextRequest, NextResponse } from "next/server";
import { COOKIE } from "@/lib/mail/store";
import { resolveAccount } from "@/lib/mail/resolve";
import { resolveRole, Role, withImap } from "@/lib/mail/imap";

/** Stream one attachment out of a message so the browser can display it. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const role = (q.get("role") ?? "inbox") as Role;
  const uid = Number(q.get("uid"));
  const part = q.get("part");
  const account = q.get("account");
  const cfg = await resolveAccount(req.cookies.get(COOKIE)?.value, account);
  if (!cfg) return new NextResponse("Not connected", { status: 401 });
  if (!uid || !part) return new NextResponse("Missing uid or part", { status: 400 });

  try {
    const file = await withImap(cfg, async (client) => {
      const path = await resolveRole(client, role);
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        const dl = await client.download(String(uid), part, { uid: true });
        if (!dl?.content) return null;
        const chunks: Buffer[] = [];
        for await (const chunk of dl.content) chunks.push(chunk as Buffer);
        return {
          body: Buffer.concat(chunks),
          type: dl.meta?.contentType ?? "application/octet-stream",
          name: dl.meta?.filename ?? "attachment",
        };
      } finally {
        lock.release();
      }
    });
    if (!file) return new NextResponse("Attachment not found", { status: 404 });

    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.type,
        // inline so images and PDFs render in the viewer rather than downloading
        "Content-Disposition": `inline; filename="${file.name.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return new NextResponse(
      e instanceof Error ? e.message : "Could not fetch attachment",
      { status: 500 }
    );
  }
}
