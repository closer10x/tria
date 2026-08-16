import { NextRequest, NextResponse } from "next/server";
import { COOKIE } from "@/lib/mail/store";
import { resolveAccount, resolveAllAccounts } from "@/lib/mail/resolve";
import { searchMessages, WireEmail } from "@/lib/mail/imap";
import { simpleParser } from "mailparser";
import { resolveRole, withImap } from "@/lib/mail/imap";
import {
  briefLlmError,
  llmChat,
  llmProvider,
  LlmRefusal,
  NO_PROVIDER_MSG,
} from "@/lib/server/llm";

/**
 * "Ask your mail": Claude answers a natural-language question about the
 * user's mailbox by DOING searches, not by guessing. Each round it returns
 * a structured next step — run a search, read one message, or answer — and
 * the route executes it against the real IMAP search (lib/mail/imap.ts) and
 * feeds the results back. Answers cite messages the client can open.
 *
 * Structured output rather than native tool-use so it behaves the same on
 * Anthropic-direct and OpenRouter (see lib/server/llm.ts).
 */

export const maxDuration = 60;

const MAX_ROUNDS = 5;
const MAX_RESULTS_PER_SEARCH = 25;
const MAX_BODY_CHARS = 4000;

const STEP_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["search", "read", "answer"] },
    /** for action=search: an IMAP-backed query in the supported grammar */
    query: { type: "string" },
    /** for action=read: the id of a message returned by a previous search */
    messageId: { type: "string" },
    /** for action=answer: the reply to the user (markdown-lite: plain text, line breaks, dashes) */
    text: { type: "string" },
    /** for action=answer: ids of messages the answer is based on, most relevant first (0-8) */
    citations: { type: "array", items: { type: "string" } },
    /** one short line describing what you're doing, shown while working */
    thought: { type: "string" },
  },
  required: ["action", "thought"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are the search brain inside Tria, a mail app. The user asks a question about their own mailbox; you find the answer by searching it.

You work in rounds. Each round respond with ONE JSON step:
- {"action":"search","query":"…","thought":"…"} — run a search. Query grammar (Gmail-like): free words match subject/sender/body; from:NAME  to:ADDR  subject:WORD  has:attachment  is:unread  is:starred  before:YYYY-MM-DD  after:YYYY-MM-DD  "exact phrase". Combine freely, e.g.  from:sophia has:attachment after:2026-07-01. Free words are OR'd loosely against bodies, so prefer from:/subject: when you know them. Names: search first names or domains, not full display names.
- {"action":"read","messageId":"…","thought":"…"} — read the full body of one message from a previous search when the subject line isn't enough (an amount, a date, a decision).
- {"action":"answer","text":"…","citations":["id",…],"thought":"…"} — answer the user. Cite the message ids your answer rests on (most relevant first, up to 8). Be direct and specific: names, dates, subjects, amounts. If nothing matched after a reasonable search, say so plainly and suggest how to rephrase.

Rules: never invent messages — only cite ids you were shown. Do at most 2-3 searches; broaden or narrow based on what came back. Today's date is given in the first message. Prefer answering over endless searching. Keep answers under ~120 words unless the user asked for a list.`;

type Step = {
  action: "search" | "read" | "answer";
  query?: string;
  messageId?: string;
  text?: string;
  citations?: string[];
  thought?: string;
};

type Cite = {
  id: string;
  uid: number;
  folder: WireEmail["folder"];
  accountId: string;
  subject: string;
  from: string;
  time: string;
};

const summarise = (m: WireEmail) =>
  `id=${m.id} | ${m.time} | ${m.folder} | from: ${m.from.name} <${m.from.email}> | subject: ${m.subject}${m.attachments?.length ? ` | ${m.attachments.length} attachment(s)` : ""}${m.read ? "" : " | unread"}`;

export async function POST(req: NextRequest) {
  if (!(await llmProvider())) {
    console.error(NO_PROVIDER_MSG);
    return NextResponse.json({ ok: false, error: briefLlmError({ status: 503 }) }, { status: 503 });
  }
  const token = req.cookies.get(COOKIE)?.value;
  const { question, account, tz, now } = (await req.json()) as {
    question: string;
    account?: string; // "all" or one address
    tz?: string;
    now?: string;
  };
  if (!question?.trim())
    return NextResponse.json({ ok: false, error: "Ask something." }, { status: 400 });

  const cfgs =
    account && account !== "all"
      ? [await resolveAccount(token, account)].filter(Boolean)
      : await resolveAllAccounts(token);
  if (cfgs.length === 0)
    return NextResponse.json({ ok: false, error: "Not connected" }, { status: 401 });

  const seen = new Map<string, WireEmail>();
  const transcript: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: `${now ? `Today is ${now}.\n` : ""}Question: ${question.trim()}` },
  ];
  const trail: string[] = []; // thoughts, for the UI

  const runSearch = async (q: string): Promise<WireEmail[]> => {
    const lists = await Promise.all(
      cfgs.map((cfg) => searchMessages(cfg!, q, { tz, limitPerFolder: 15 }).catch(() => []))
    );
    const merged = lists
      .flat()
      .sort((a, b) => {
        if (a.match !== b.match) return a.match === "header" ? -1 : 1;
        return (b.sortDate ?? 0) - (a.sortDate ?? 0);
      })
      .slice(0, MAX_RESULTS_PER_SEARCH);
    for (const m of merged) seen.set(m.id, m);
    return merged;
  };

  const readBody = async (m: WireEmail): Promise<string> => {
    const cfg = cfgs.find((c) => c!.user === m.accountId);
    if (!cfg) return "(account not available)";
    return withImap(cfg, async (client) => {
      const path = await resolveRole(client, m.folder);
      if (!path) return "(folder not found)";
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        const dl = await client.download(String(m.uid), undefined, { uid: true });
        const parsed = await simpleParser(dl.content);
        return (parsed.text ?? "").replace(/\s+\n/g, "\n").trim().slice(0, MAX_BODY_CHARS) || "(no text)";
      } finally {
        lock.release();
      }
    }).catch(() => "(couldn't read message)");
  };

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const raw = await llmChat({
        system: SYSTEM,
        messages: transcript,
        maxTokens: 1024,
        schema: STEP_SCHEMA as unknown as Record<string, unknown>,
      });
      let step: Step;
      try {
        step = JSON.parse(raw) as Step;
      } catch {
        // a provider that ignored the schema and just answered in prose
        step = { action: "answer", text: raw, citations: [], thought: "answer" };
      }
      if (step.thought) trail.push(step.thought);
      transcript.push({ role: "assistant", content: JSON.stringify(step) });

      if (step.action === "search" && step.query) {
        const results = await runSearch(step.query);
        transcript.push({
          role: "user",
          content: results.length
            ? `Search "${step.query}" → ${results.length} result(s):\n${results.map(summarise).join("\n")}`
            : `Search "${step.query}" → no results.`,
        });
        continue;
      }
      if (step.action === "read" && step.messageId) {
        const m = seen.get(step.messageId);
        const body = m ? await readBody(m) : "(unknown message id — only read ids from search results)";
        transcript.push({
          role: "user",
          content: `Body of ${step.messageId}:\n${body}`,
        });
        continue;
      }
      // answer (or an unusable step on the last round)
      const citations: Cite[] = (step.citations ?? [])
        .map((id) => seen.get(id))
        .filter((m): m is WireEmail => Boolean(m))
        .slice(0, 8)
        .map((m) => ({
          id: m.id,
          uid: m.uid,
          folder: m.folder,
          accountId: m.accountId,
          subject: m.subject,
          from: m.from.name,
          time: m.time,
        }));
      return NextResponse.json({
        ok: true,
        text: (step.text ?? "").trim() || "I couldn't find anything for that.",
        citations,
        // full message objects so the client can open a citation without refetching the list
        messages: citations.map((c) => seen.get(c.id)),
        trail,
      });
    }
    return NextResponse.json({
      ok: true,
      text: "I searched a few different ways but couldn't pin that down. Try naming the sender or a word from the subject.",
      citations: [],
      messages: [],
      trail,
    });
  } catch (e) {
    if (e instanceof LlmRefusal)
      return NextResponse.json({ ok: true, text: "I can't help with that one.", citations: [], messages: [], trail });
    console.error("ai mail search failed", e);
    const status = (e as { status?: number }).status;
    return NextResponse.json(
      { ok: false, error: briefLlmError(e) },
      { status: status === 401 || status === 429 || status === 503 ? status : 500 }
    );
  }
}
