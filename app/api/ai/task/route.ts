import { NextRequest, NextResponse } from "next/server";
import {
  briefLlmError,
  llmChat,
  llmProvider,
  LlmRefusal,
  NO_PROVIDER_MSG,
} from "@/lib/server/llm";
import {
  SMART_TASK_SCHEMA,
  SMART_TASK_SYSTEM,
  type SmartTaskDraft,
} from "./prompt";
export type { SmartTaskDraft };

/**
 * Turn an email into a smart task by reading it: one checklist item per thing
 * actually being asked for, so "pictures of my car and pictures of the
 * interior" becomes two steps rather than a generic "reply to sender".
 */

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await llmProvider())) {
    console.error(NO_PROVIDER_MSG);
    return NextResponse.json(
      { ok: false, error: briefLlmError({ status: 503 }) },
      { status: 503 }
    );
  }

  const { from, subject, body, now } = (await req.json()) as {
    from?: string;
    subject?: string;
    body?: string;
    now?: string;
  };

  try {
    const text = await llmChat({
      maxTokens: 1024,
      schema: SMART_TASK_SCHEMA,
      system: SMART_TASK_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${now ? `Today is ${now}.\n\n` : ""}From: ${from ?? "unknown"}\nSubject: ${subject ?? "(no subject)"}\n\n${body ?? ""}`,
        },
      ],
    });

    const draft = JSON.parse(text) as SmartTaskDraft;
    // weaker providers can return shape-adjacent JSON — reject it here
    if (typeof draft?.title !== "string" || !Array.isArray(draft.checklist))
      throw new Error("The model returned an unusable task.");
    return NextResponse.json({ ok: true, task: draft });
  } catch (e) {
    if (e instanceof LlmRefusal)
      return NextResponse.json(
        { ok: false, error: "Claude declined to summarise that email." },
        { status: 422 }
      );
    // full diagnosis to the log, one line to the screen
    console.error("smart task failed", e);
    return NextResponse.json(
      { ok: false, error: briefLlmError(e) },
      { status: (e as { status?: number }).status ?? 500 }
    );
  }
}
