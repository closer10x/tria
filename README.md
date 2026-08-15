# TRIA — Mail · Smart Tasks · Threads · AI

A three-column command center: full email client (left), smart tasks auto-built
from emails (middle), and human threads + AI assistant (right). Next.js 15,
React 19, Tailwind v4. SpaceX-inspired design, mobile-optimized.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 — starts with demo data.

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

## Deploy

```bash
npx vercel
```

Notes for production: mail account sessions are held in server memory (restart =
reconnect); credentials are intentionally not stored in the database.
The AI assistant and AI search are currently smart local mocks — wire them to
the Claude API at the seams marked "later this becomes a real Claude call".

## Supabase

Tasks, threads, AI chat, and settings persist to Supabase (project `TRIA`).
Copy `.env.example` to `.env.local` and fill in the keys (already done locally).
On first run with an empty database the demo seeds are written; after that,
every change syncs (debounced) and reloads hydrate from the database.
Tables: `tasks`, `threads`, `ai_messages`, `app_settings` — RLS is enabled with
open policies for now (single-user app); tighten when auth lands. The mail
password is never persisted. When deploying, add `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` to Vercel env vars.

## Structure

- `app/page.tsx` — state + orchestration
- `components/` — MailPane, TaskPane, ChatPane, AiPane, SettingsModal
- `lib/data.ts` — demo data
- `lib/mail/` + `app/api/mail/` — IMAP/SMTP backend
