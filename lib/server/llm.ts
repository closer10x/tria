import Anthropic from "@anthropic-ai/sdk";
import { loadAiKeys } from "@/lib/server/aiKeys";

/**
 * One door to the LLM for every /api/ai route.
 * Provider order: ANTHROPIC_API_KEY (native Claude API, structured output)
 * → OPENROUTER_API_KEY (OpenAI-compatible chat completions). Both are tried:
 * a key that a provider rejects moves on to the next provider rather than
 * taking every AI feature down. The routes stay provider-agnostic and keep
 * their response shapes.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/**
 * Responsiveness first. Measured against this account: Haiku answers a short
 * prompt in ~0.8s, while nemotron-free takes ~10s — and because a slow model
 * still *succeeds*, the chain would stop there and every AI call in the app
 * paid that 10s. At these prompt sizes Haiku is a fraction of a cent, so it
 * leads and the free tiers sit behind it as the no-cost fallback if it is
 * rate-limited or the account runs out of credit.
 * OPENROUTER_MODEL prepends an explicit choice to the front of the chain.
 */
const MODEL_CHAIN = [
  "anthropic/claude-haiku-4.5",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "openrouter/free",
];

function modelChain(): string[] {
  const override = process.env.OPENROUTER_MODEL;
  return override
    ? [override, ...MODEL_CHAIN.filter((m) => m !== override)]
    : [...MODEL_CHAIN];
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type LlmRequest = {
  system: string;
  messages: ChatTurn[];
  maxTokens: number;
  /** JSON schema for structured output; the reply text is the JSON document. */
  schema?: Record<string, unknown>;
};

export class LlmRefusal extends Error {}

export type LlmProvider = "anthropic" | "openrouter";

/**
 * Read an API key the way a dashboard paste actually delivers it.
 *
 * A key that is right but pasted wrong fails exactly like a wrong key, and
 * the damage is invisible in the Vercel UI. Measured against Node's fetch:
 *  - surrounding quotes, kept from a .env line or a JSON snippet, are sent
 *    verbatim — `Bearer "sk-or-v1-…"` — and the provider answers 401
 *  - a leading "Bearer " copied out of a curl example gives `Bearer Bearer …`,
 *    also 401
 *  - a newline *inside* the value (a wrapped paste) doesn't even reach the
 *    provider: Headers throws "is an invalid header value" first
 *  - leading and trailing whitespace is stripped by fetch itself, so it never
 *    causes a 401 — but a value of " " still reads as a configured provider,
 *    which routes every AI call at a key that isn't there
 * No provider key contains whitespace or quotes, so normalising here is safe
 * and turns each of those into a working deploy instead of a 401 nobody can
 * see the cause of.
 */
export function normalizeKey(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let key = raw.trim();
  if (key.length > 1 && /^(["'])[\s\S]*\1$/.test(key)) key = key.slice(1, -1);
  key = key.replace(/^Bearer\s+/i, "");
  // Keep printable ASCII only. Provider keys are [A-Za-z0-9-_], so this is
  // lossless for a real key and removes the characters a paste out of a
  // browser or a chat window carries invisibly: a zero-width space (U+200B,
  // which JS \s does NOT match), a BOM, a non-breaking space, a smart quote.
  // One of those in the value is why a provider can answer "Missing
  // Authentication header" for a key that looks perfect in the dashboard.
  key = key.replace(/[^\x21-\x7e]/g, "");
  // a value of "" or " " is a placeholder, not a configured provider
  return key || null;
}

/** What a provider's keys look like, for a format check that names no secret. */
export const KEY_PREFIX: Record<LlmProvider, string> = {
  anthropic: "sk-ant-",
  openrouter: "sk-or-",
};

const ENV_NAME: Record<LlmProvider, "ANTHROPIC_API_KEY" | "OPENROUTER_API_KEY"> = {
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export type ResolvedKey = {
  key: string;
  /** Where it came from, so the UI can say which one is actually in play. */
  source: "stored" | "env";
};

export type ResolvedKeys = Partial<Record<LlmProvider, ResolvedKey>>;

/**
 * The key each provider will actually be called with.
 *
 * A key stored in the app wins over the environment variable. That order is
 * the point of the store: when the deployed env var is wrong, the fix has to
 * be reachable without a redeploy, and a value someone just entered and had
 * verified is newer evidence than one baked into the build.
 *
 * A store that cannot be read falls through to the env vars rather than
 * taking the AI down with it.
 */
export async function resolveKeys(): Promise<ResolvedKeys> {
  let stored: Partial<Record<LlmProvider, string>> = {};
  try {
    stored = await loadAiKeys();
  } catch (e) {
    console.error("llm: stored provider keys unreadable, using env", e);
  }
  const out: ResolvedKeys = {};
  for (const provider of ["anthropic", "openrouter"] as LlmProvider[]) {
    const fromStore = normalizeKey(stored[provider]);
    if (fromStore) {
      out[provider] = { key: fromStore, source: "stored" };
      continue;
    }
    const fromEnv = normalizeKey(process.env[ENV_NAME[provider]]);
    if (fromEnv) out[provider] = { key: fromEnv, source: "env" };
  }
  return out;
}

/** Providers with a usable key, in preference order. */
export async function llmProviders(): Promise<LlmProvider[]> {
  const keys = await resolveKeys();
  return (["anthropic", "openrouter"] as LlmProvider[]).filter((p) => keys[p]);
}

export async function llmProvider(): Promise<LlmProvider | null> {
  return (await llmProviders())[0] ?? null;
}

/** Error message for 503s when no provider is configured. */
export const NO_PROVIDER_MSG =
  "No AI provider is configured — set ANTHROPIC_API_KEY or OPENROUTER_API_KEY on the server and redeploy.";

/**
 * One line, for the toast the person actually sees.
 *
 * The provider messages are written for whoever fixes the deployment and run
 * to several sentences of environment-variable instructions — as a toast over
 * the mail reader they bury the app under text meant for a terminal. The full
 * version still reaches the runtime log and /api/ai/health, which is where
 * that audience is looking.
 */
export function briefLlmError(e: unknown): string {
  const status = (e as { status?: number }).status;
  if (status === 401) return "AI is unavailable — the provider rejected its API key.";
  if (status === 402) return "AI is unavailable — the provider account is out of credit.";
  if (status === 429) return "AI is busy — try again in a moment.";
  if (status === 503) return "AI isn't set up on the server yet.";
  return "The AI request didn't go through.";
}

async function chatAnthropic(req: LlmRequest, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: req.maxTokens,
    ...(req.schema
      ? {
          output_config: {
            effort: "low",
            format: { type: "json_schema", schema: req.schema },
          },
        }
      : {
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
        }),
    system: req.system,
    messages: req.messages,
  });
  if (response.stop_reason === "refusal") throw new LlmRefusal();
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** ```json fences some models wrap around structured replies. */
function stripFences(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : text.trim();
}

function orFetch(payload: Record<string, unknown>, apiKey: string): Promise<Response> {
  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://tria-rho.vercel.app",
      "X-Title": "Tria",
    },
    body: JSON.stringify(payload),
  });
}

async function attemptOpenRouter(
  model: string,
  req: LlmRequest,
  apiKey: string
): Promise<string> {
  const system = req.schema
    ? `${req.system}\n\nRespond with ONLY a JSON document matching this JSON Schema — no prose, no code fences:\n${JSON.stringify(req.schema)}`
    : req.system;
  const body = {
    model,
    max_tokens: req.maxTokens,
    messages: [
      { role: "system", content: system },
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    // structured output where the provider supports it; the schema is also
    // in the system prompt so unsupporting providers still comply
    ...(req.schema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: { name: "result", strict: true, schema: req.schema },
          },
        }
      : {}),
  };
  let res = await orFetch(body, apiKey);
  // some models reject response_format outright — retry on prompt alone
  if (!res.ok && req.schema && res.status >= 400 && res.status < 500) {
    const errText = await res.text().catch(() => "");
    if (/response_format|json_schema|structured/i.test(errText)) {
      const { response_format: _rf, ...withoutFormat } = body as Record<string, unknown>;
      res = await orFetch(withoutFormat, apiKey);
    } else {
      throw Object.assign(new Error(openRouterError(res.status, errText)), {
        status: res.status,
      });
    }
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw Object.assign(new Error(openRouterError(res.status, errText)), {
      status: res.status,
    });
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "content_filter") throw new LlmRefusal();
  const text = choice?.message?.content?.trim() ?? "";
  // A 200 with no content is still a failure — some free models spend the
  // whole budget on a reasoning prefix and stop (finish_reason "length")
  // without emitting anything. Fall through to the next model rather than
  // handing the caller an empty answer.
  if (!text)
    throw Object.assign(new Error(`${model} returned an empty completion.`), {
      status: 502,
    });
  return req.schema ? stripFences(text) : text;
}

/** Statuses worth trying the next model in the chain for. */
const FALLTHROUGH_STATUSES = new Set([402, 404, 408, 429, 500, 502, 503, 504]);

async function chatOpenRouter(req: LlmRequest, apiKey: string): Promise<string> {
  let lastErr: unknown;
  for (const model of modelChain()) {
    try {
      return await attemptOpenRouter(model, req, apiKey);
    } catch (e) {
      if (e instanceof LlmRefusal) throw e;
      const status = (e as { status?: number }).status;
      // a bad key (401) fails everywhere — don't burn the chain on it
      if (status && !FALLTHROUGH_STATUSES.has(status)) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

function openRouterError(status: number, detail: string): string {
  let msg = "";
  try {
    msg = (JSON.parse(detail) as { error?: { message?: string } }).error?.message ?? "";
  } catch {
    msg = detail.slice(0, 200);
  }
  // OpenRouter's own words separate the two cases that look identical from
  // here: "No auth credentials found" (nothing usable reached them) vs
  // "User not found"/"Invalid API key" (a real key that has been revoked or
  // belongs to another account). Keep it — it is what makes the next 401
  // fixable from the log instead of by guessing.
  if (status === 401)
    return `OpenRouter rejected the API key${msg ? ` — ${msg}` : ""}. Issue a new key at https://openrouter.ai/keys, set OPENROUTER_API_KEY for the Production environment, and redeploy (env changes only reach a new build).`;
  if (status === 402) return "OpenRouter account is out of credits.";
  if (status === 429) return "Rate limited by OpenRouter — try again in a moment.";
  if (status === 404 || /model/i.test(msg))
    return `OpenRouter: ${msg || "model not found"} — set OPENROUTER_MODEL to a valid model id.`;
  return `OpenRouter error (${status}): ${msg || "request failed"}`;
}

export type KeyCheck = {
  provider: LlmProvider;
  configured: boolean;
  /** The provider accepted the key. Null when there is no key to check. */
  ok: boolean | null;
  /** The value carries the provider's key prefix — a wrong var, a pasted
   *  fragment or a placeholder fails this without revealing anything: every
   *  key of a given provider starts with the same public prefix. */
  looksLikeKey?: boolean;
  /** The raw env value needed cleaning (quotes, "Bearer ", invisible
   *  characters). True here with ok false means the value is damaged enough
   *  that re-pasting it is the fix. */
  cleaned?: boolean;
  /** Whether the key in play was entered in the app or baked into the build. */
  source?: "stored" | "env";
  status?: number;
  error?: string;
};

/** Describe a key without disclosing any of it. */
function describeKey(provider: LlmProvider, resolved: ResolvedKey): Pick<KeyCheck, "looksLikeKey" | "cleaned" | "source"> {
  const envName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY";
  return {
    looksLikeKey: resolved.key.startsWith(KEY_PREFIX[provider]),
    // only meaningful for an env value; a stored key was normalised on entry
    cleaned:
      resolved.source === "env" && (process.env[envName] ?? "") !== resolved.key,
    source: resolved.source,
  };
}

/**
 * Does this key authenticate? Free, auth-only, buys no completion.
 *
 * Used both by the health check and by the route that saves a key, so a key
 * that would not work cannot be stored in the first place.
 */
export async function verifyKey(
  provider: LlmProvider,
  key: string
): Promise<{ ok: true } | { ok: false; status?: number; error: string }> {
  if (provider === "anthropic") {
    try {
      await new Anthropic({ apiKey: key }).models.list({ limit: 1 });
      return { ok: true };
    } catch (e) {
      const err = e as { status?: number; message?: string };
      return {
        ok: false,
        status: err.status,
        error:
          err.status === 401
            ? "Anthropic rejected this key."
            : (err.message ?? "Anthropic key check failed."),
      };
    }
  }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return { ok: true };
    return {
      ok: false,
      status: res.status,
      error: openRouterError(res.status, await res.text().catch(() => "")),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "OpenRouter key check failed.",
    };
  }
}

/**
 * Ask each provider whether the key it would actually be called with works.
 *
 * Safe to call after every deploy: both checks are free auth-only endpoints,
 * no completion is bought. It deliberately reports nothing about the key
 * itself — not its value, length, or edge characters, only whether the
 * provider accepts it. (A previous health endpoint leaked secret shape and
 * had to be pulled; this one is the same idea without the leak.)
 */
export async function checkKeys(): Promise<KeyCheck[]> {
  const resolved = await resolveKeys();
  const checks: KeyCheck[] = [];

  for (const provider of ["anthropic", "openrouter"] as LlmProvider[]) {
    const entry = resolved[provider];
    if (!entry) {
      checks.push({ provider, configured: false, ok: null });
      continue;
    }
    const shape = describeKey(provider, entry);
    const result = await verifyKey(provider, entry.key);
    checks.push(
      result.ok
        ? { provider, configured: true, ok: true, ...shape }
        : {
            provider,
            configured: true,
            ok: false,
            ...shape,
            status: result.status,
            error: result.error,
          }
    );
  }

  return checks;
}

/**
 * Run one chat completion against whichever provider is configured.
 * Throws LlmRefusal when the model declines, or an Error (with .status
 * when known) on transport/provider failures.
 *
 * Both configured providers are tried, in preference order. A key one
 * provider rejects used to take every AI feature down even when the other
 * key was good, because the provider was picked once by presence alone and
 * never revisited.
 */
export async function llmChat(req: LlmRequest): Promise<string> {
  const keys = await resolveKeys();
  const providers = (["anthropic", "openrouter"] as LlmProvider[]).filter(
    (p) => keys[p]
  );
  if (!providers.length)
    throw Object.assign(new Error(NO_PROVIDER_MSG), { status: 503 });

  let lastErr: unknown;
  for (const provider of providers) {
    const apiKey = keys[provider]!.key;
    try {
      return provider === "anthropic"
        ? await chatAnthropic(req, apiKey)
        : await chatOpenRouter(req, apiKey);
    } catch (e) {
      // a refusal is an answer, not an outage — asking the other provider
      // the same question would only burn a second call
      if (e instanceof LlmRefusal) throw e;
      console.error(`llm: ${provider} failed`, e);
      lastErr = e;
    }
  }
  throw lastErr;
}
