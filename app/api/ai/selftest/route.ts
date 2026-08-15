import { NextResponse } from "next/server";
import { resolveAllAccounts } from "@/lib/mail/resolve";
import { listMessages } from "@/lib/mail/imap";
import { llmChat, llmProvider, resolveKeys } from "@/lib/server/llm";
import { SMART_TASK_SCHEMA, SMART_TASK_SYSTEM } from "@/app/api/ai/task/prompt";

/**
 * TEMPORARY. Runs the smart-task extraction against the newest real message
 * in the connected mailbox, end to end, and reports what came back.
 *
 * /api/ai/health proves only that the provider accepts the key — it buys no
 * completion. This is the missing half: a real email, the real prompt and
 * schema, a real answer. It exists because the deployment cannot be driven
 * from the outside (POST routes need the UI, previews are behind SSO), and
 * it comes straight back out once it has answered.
 *
 * It echoes no message body — subject, sender and a length, plus the task the
 * model produced from them.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const started = Date.now();
  try {
    const keys = await resolveKeys();
    const provider = await llmProvider();
    if (!provider)
      return NextResponse.json({ ok: false, step: "keys", error: "no provider configured" }, { status: 503 });

    const accounts = await resolveAllAccounts(undefined);
    if (!accounts.length)
      return NextResponse.json({ ok: false, step: "mail", error: "no connected account" }, { status: 503 });

    const [newest] = await listMessages(accounts[0], "inbox", "UTC", 1, 0);
    if (!newest)
      return NextResponse.json({ ok: false, step: "mail", error: "inbox is empty" }, { status: 503 });

    const body = (newest.body ?? []).join("\n");
    const fetchedAt = Date.now();

    const text = await llmChat({
      maxTokens: 1024,
      schema: SMART_TASK_SCHEMA,
      system: SMART_TASK_SYSTEM,
      messages: [
        {
          role: "user",
          content: `From: ${newest.from.email}\nSubject: ${newest.subject}\n\n${body}`,
        },
      ],
    });

    return NextResponse.json({
      ok: true,
      provider,
      keySource: keys[provider]?.source,
      email: {
        account: accounts[0].user,
        from: newest.from.email,
        subject: newest.subject,
        bodyChars: body.length,
      },
      ms: { mail: fetchedAt - started, ai: Date.now() - fetchedAt },
      task: JSON.parse(text),
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json(
      { ok: false, step: "ai", status: err.status, error: err.message ?? String(e) },
      { status: 500 }
    );
  }
}
