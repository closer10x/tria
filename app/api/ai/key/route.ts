import { NextRequest, NextResponse } from "next/server";
import { clearAiKey, saveAiKey, storedAiProviders } from "@/lib/server/aiKeys";
import { KEY_PREFIX, LlmProvider, normalizeKey, verifyKey } from "@/lib/server/llm";

/**
 * Set the AI provider key from inside the app.
 *
 * The alternative is an environment variable, which can only be changed in
 * the host's dashboard and only takes effect on the next build — so a wrong
 * value costs a redeploy to discover and another to fix. A key posted here is
 * authenticated against the provider BEFORE it is stored, so the answer is
 * immediate and a key that would not work never lands.
 *
 * The key is never sent back out: GET reports only which providers have one.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PROVIDERS: LlmProvider[] = ["anthropic", "openrouter"];

const isProvider = (v: unknown): v is LlmProvider =>
  typeof v === "string" && PROVIDERS.includes(v as LlmProvider);

export async function GET() {
  const stored = await storedAiProviders();
  return NextResponse.json({
    ok: true,
    stored,
    env: PROVIDERS.filter((p) =>
      normalizeKey(
        process.env[p === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY"]
      )
    ),
  });
}

export async function POST(req: NextRequest) {
  const { provider, key } = (await req.json()) as {
    provider?: string;
    key?: string;
  };
  if (!isProvider(provider))
    return NextResponse.json(
      { ok: false, error: "Pick a provider." },
      { status: 400 }
    );

  // same normalising the env path gets: a key pasted with quotes, a "Bearer "
  // prefix or an invisible character is repaired rather than rejected
  const clean = normalizeKey(key, provider);
  if (!clean)
    return NextResponse.json(
      { ok: false, error: "Paste a key first." },
      { status: 400 }
    );
  if (!clean.startsWith(KEY_PREFIX[provider]))
    return NextResponse.json(
      {
        ok: false,
        error: `That doesn't look like an ${
          provider === "anthropic" ? "Anthropic" : "OpenRouter"
        } key — they start with ${KEY_PREFIX[provider]}`,
      },
      { status: 400 }
    );

  const check = await verifyKey(provider, clean);
  if (!check.ok)
    return NextResponse.json(
      { ok: false, error: check.error },
      { status: check.status === 401 ? 401 : 502 }
    );

  try {
    await saveAiKey(provider, clean);
  } catch (e) {
    console.error("saving the provider key failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Couldn't save the key." },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, stored: await storedAiProviders() });
}

export async function DELETE(req: NextRequest) {
  const { provider } = (await req.json().catch(() => ({}))) as {
    provider?: string;
  };
  if (!isProvider(provider))
    return NextResponse.json(
      { ok: false, error: "Pick a provider." },
      { status: 400 }
    );
  try {
    await clearAiKey(provider);
  } catch (e) {
    console.error("removing the provider key failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Couldn't remove the key." },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, stored: await storedAiProviders() });
}
