import { NextRequest, NextResponse } from "next/server";
import { COOKIE } from "@/lib/mail/store";
import { resolveAllAccounts } from "@/lib/mail/resolve";
import { resolveRole, withImap } from "@/lib/mail/imap";
import { mailErrorMessage } from "@/lib/mail/errors";

/**
 * People you've actually written to, for compose autocomplete: aggregates
 * recipient envelopes from the Sent folder of every connected account.
 * Ranked by how often and how recently you've emailed them.
 */

export const maxDuration = 60;

export type Contact = {
  email: string;
  name: string;
  count: number;
  /** ms epoch of the most recent send */
  lastUsed: number;
};

/** How many recent sent messages to scan per account. */
const SCAN_LIMIT = 300;

// Per-instance cache: scanning Sent over IMAP is slow, and the ranking barely
// moves between composes. Serverless instances each warm their own copy.
const g = globalThis as unknown as {
  __triaContacts?: Map<string, { at: number; contacts: Contact[] }>;
};
if (!g.__triaContacts) g.__triaContacts = new Map();
const CACHE_MS = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const accounts = await resolveAllAccounts(token);
  if (accounts.length === 0)
    return NextResponse.json({ ok: true, contacts: [] });

  const cacheKey = accounts
    .map((a) => a.user)
    .sort()
    .join("|");
  const hit = g.__triaContacts!.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS)
    return NextResponse.json({ ok: true, contacts: hit.contacts });

  try {
    const byEmail = new Map<string, Contact>();
    const own = new Set(accounts.map((a) => a.user.toLowerCase()));

    await Promise.all(
      accounts.map((cfg) =>
        withImap(cfg, async (client) => {
          const sent = await resolveRole(client, "sent");
          const lock = await client.getMailboxLock(sent);
          try {
            const total = client.mailbox ? client.mailbox.exists : 0;
            if (!total) return;
            const from = Math.max(1, total - SCAN_LIMIT + 1);
            for await (const msg of client.fetch(`${from}:*`, {
              envelope: true,
            })) {
              const when = msg.envelope?.date?.getTime() ?? 0;
              const rcpts = [
                ...(msg.envelope?.to ?? []),
                ...(msg.envelope?.cc ?? []),
              ];
              for (const r of rcpts) {
                const email = r.address?.toLowerCase();
                if (!email || own.has(email)) continue;
                const cur = byEmail.get(email);
                if (cur) {
                  cur.count += 1;
                  if (when > cur.lastUsed) {
                    cur.lastUsed = when;
                    if (r.name) cur.name = r.name;
                  }
                } else {
                  byEmail.set(email, {
                    email,
                    name: r.name ?? "",
                    count: 1,
                    lastUsed: when,
                  });
                }
              }
            }
          } finally {
            lock.release();
          }
        }).catch(() => {
          // one account failing (expired token, host down) shouldn't
          // blank the suggestions from the others
        })
      )
    );

    const contacts = [...byEmail.values()]
      .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
      .slice(0, 200);
    g.__triaContacts!.set(cacheKey, { at: Date.now(), contacts });
    return NextResponse.json({ ok: true, contacts });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: mailErrorMessage(e) },
      { status: 500 }
    );
  }
}
