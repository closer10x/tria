import { NextRequest, NextResponse } from "next/server";
import { COOKIE } from "@/lib/mail/store";
import { resolveAccount } from "@/lib/mail/resolve";
import { isRole, resolveRole, Role, withImap } from "@/lib/mail/imap";

/** Filename-extension → MIME, for the common types a browser can render. Many
 *  IMAP servers label parts "application/octet-stream", which the browser then
 *  downloads instead of showing — so a .pdf never opened in the viewer. */
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  txt: "text/plain",
};

function resolveContentType(metaType: string | undefined, name: string): string {
  const t = (metaType ?? "").toLowerCase();
  // trust a specific type; override only the generic/empty ones
  if (t && t !== "application/octet-stream" && t !== "application/binary") return t;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? metaType ?? "application/octet-stream";
}

/** Stream one attachment out of a message so the browser can display it. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const roleParam = q.get("role") ?? "inbox";
  if (!isRole(roleParam)) return new NextResponse("Unknown folder", { status: 400 });
  const role: Role = roleParam;
  const uid = Number(q.get("uid"));
  const part = q.get("part");
  const account = q.get("account");
  const cfg = await resolveAccount(req.cookies.get(COOKIE)?.value, account);
  if (!cfg) return new NextResponse("Not connected", { status: 401 });
  if (!uid || !part) return new NextResponse("Missing uid or part", { status: 400 });

  try {
    const file = await withImap(cfg, async (client) => {
      const path = await resolveRole(client, role);
      // reading the wrong folder would download a different message with the
      // same uid, so fail rather than fall back
      if (!path) return null;
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
        "Content-Type": resolveContentType(file.type, file.name),
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
