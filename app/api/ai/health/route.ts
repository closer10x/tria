import { NextResponse } from "next/server";
import { checkKeys, llmProvider } from "@/lib/server/llm";

/**
 * Does the deployed AI key actually work?
 *
 * The failure this exists for is silent: a key is pasted into Vercel, the
 * build goes green, and the only sign it was rejected is a 500 from an AI
 * feature and a line in the runtime log. This answers it directly, against
 * the environment the functions really run in.
 *
 *   curl https://<deployment>/api/ai/health
 *
 * Free auth-only calls to each provider — no completion is bought — and the
 * response carries nothing about the key but whether it authenticates.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const checks = await checkKeys();
  const ok = checks.some((c) => c.ok);
  return NextResponse.json(
    {
      ok,
      /** The provider AI requests go to first. */
      provider: await llmProvider(),
      providers: checks,
      hint: ok
        ? undefined
        : "Paste a working key in Settings → AI provider — it is verified before it is saved and takes effect immediately, with no redeploy. (The ANTHROPIC_API_KEY / OPENROUTER_API_KEY environment variables still work, but only reach a new build.)",
    },
    // 200 when at least one provider answers; 503 when the AI is down, so a
    // uptime check can watch this URL without parsing the body
    { status: ok ? 200 : 503 }
  );
}
