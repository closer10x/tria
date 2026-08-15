# TRIA — Mail · Smart Tasks · Threads · AI

A three-column command center: full email client (left), smart tasks auto-built
from emails (middle), and human threads + AI assistant (right). Next.js 15,
React 19, Tailwind v4. SpaceX-inspired design, mobile-optimized.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Run **one** dev server at a time against this checkout — concurrent `next dev`
processes share `.next/` and corrupt it (real API routes start 404ing). For the
same reason, don't `next build` while a dev server is up; use `npx tsc --noEmit`
to typecheck.

## Connect real email (IMAP/SMTP)

1. Click the gear icon (top right) → **Email Account**
2. Pick your provider — Gmail, Outlook, GoDaddy, Yahoo, iCloud, or Custom
   (IMAP/SMTP hosts fill in automatically)
3. Enter your email + **app password**
   - Gmail: Google Account → Security → 2-Step Verification → App passwords
   - Yahoo: Account Security → Generate app password
   - iCloud: appleid.apple.com → app-specific password
4. **Connect account** — the Mail column switches to your live inbox

Live mode supports: folders (Inbox/Snoozed/Sent/Archive/Trash), read/unread,
star/flag, archive, trash, restore, snooze (moves to a Tria/Snoozed folder),
reply and compose via SMTP with your signature.

**Multiple accounts**: repeat the connect steps for each account. With two or
more connected, the Mail pane gains an account switcher — an **All inboxes**
unified view (merged, newest first, color-coded per account) plus a filtered
view per account. Replies go out from the account the email arrived in;
compose has a **From** picker. Disconnect accounts individually (or all at
once) in Settings → Email Account.

## Offline

The app keeps working when the network doesn't.

- **Your mail, tasks and threads stay on screen.** The last mailbox snapshot
  (`lib/mailCache.ts`) and the last workspace state (`lib/appCache.ts`) live in
  localStorage, so a reload with no connection opens on real content instead of
  an empty app.
- **A banner says so**, rather than one error toast per tap.
- **What you do is kept, not lost.** Archive, star, snooze, trash and sends made
  offline go to an outbox (`lib/outbox.ts`) and are replayed oldest-first once
  the connection is confirmed. A queued message is marked *Queued* in Sent until
  it has really gone.
- Connectivity is tracked in `lib/offline.ts` from both the browser's
  online/offline events and what actually happens to our own requests —
  `navigator.onLine` alone reports "online" on a network with no upstream.

Drafts are the exception: IMAP APPEND has nothing to replay against, so an
offline draft is kept on the device and says as much.

## Deploy

Push to `main` — the Vercel GitHub integration builds and deploys it.

Do **not** `vercel redeploy` or promote an older deployment: a concurrent
newer commit can lose the alias and take the routes down.

> **No authentication.** Anyone who can load the deployment can read and send
> from every connected mailbox — `GET /api/saved-accounts` lists the saved
> accounts and `POST /api/mail/connect` with just `{accountId}` opens a session
> using the stored credentials. Keep the deployment behind Vercel Deployment
> Protection scoped to **All Deployments** (the default
> `all_except_custom_domains` exempts the production alias) until a real login
> lands.

## Supabase

Tasks, threads, AI chat, and settings persist to Supabase (project `TRIA`).
Copy `.env.example` to `.env.local` and fill in the keys.
Tables: `tasks`, `threads`, `ai_messages`, `app_settings` — RLS enabled with
open anon policies (single-user app); tighten when auth lands.

Mail credentials are separate: they live in `credentials`, a row with RLS on
and **no** policies, reachable only with `SUPABASE_SERVICE_ROLE_KEY`. Passwords
and OAuth tokens are AES-256-GCM ciphertext keyed by the server-only
`TRIA_ENC_KEY` and bound to the account's address and hosts, so a tampered row
fails closed. Writers must use the atomic `mergeAccount` / `setConnected`
helpers rather than load-mutate-save — every dev server and production share
this one row.

Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `TRIA_ENC_KEY`, and `ANTHROPIC_API_KEY` for the AI
routes.

## Structure

- `app/page.tsx` — state + orchestration
- `components/` — MailPane, TaskPane, ChatPane, AiPane, SettingsModal
- `lib/mail/` + `app/api/mail/` — IMAP/SMTP backend
- `lib/server/` — credential store, encryption, OAuth, Claude calls
- `lib/offline.ts`, `lib/outbox.ts`, `lib/mailCache.ts`, `lib/appCache.ts` — offline mode
