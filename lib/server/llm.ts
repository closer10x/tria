import Anthropic from "@anthropic-ai/sdk";

/**
 * One door to the LLM for every /api/ai route.
 * Provider order: ANTHROPIC_API_KEY (native Claude API, structured output)
 * → OPENROUTER_API_KEY (OpenAI-compatible chat completions). The routes
 * stay provider-agnostic and keep their response shapes.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/**
 * Free models first: the strongest free model on the catalog, then
 * OpenRouter's auto-router across free capacity, then the cheapest capable
 * paid Claude as the safety net (free tiers rate-limit and models churn).
 * OPENROUTER_MODEL prepends an explicit choice to the front of the chain.
 */
const MODEL_CHAIN = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "openrouter/free",
  "anthropic/claude-haiku-4.5",
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

export function llmProvider(): "anthropic" | "openrouter" | null {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return null;
}

/** Error message for 503s when no provider is configured. */
export const NO_PROVIDER_MSG =
  "No AI provider is configured — set ANTHROPIC_API_KEY or OPENROUTER_API_KEY on the server and redeploy.";

async function chatAnthropic(req: LlmRequest): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
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

function orFetch(payload: Record<string, unknown>): Promise<Response> {
  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://tria-rho.vercel.app",
      "X-Title": "Tria",
    },
    body: JSON.stringify(payload),
  });
}

async function attemptOpenRouter(model: string, req: LlmRequest): Promise<string> {
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
  let res = await orFetch(body);
  // some models reject response_format outright — retry on prompt alone
  if (!res.ok && req.schema && res.status >= 400 && res.status < 500) {
    const errText = await res.text().catch(() => "");
    if (/response_format|json_schema|structured/i.test(errText)) {
      const { response_format: _rf, ...withoutFormat } = body as Record<string, unknown>;
      res = await orFetch(withoutFormat);
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

async function chatOpenRouter(req: LlmRequest): Promise<string> {
  let lastErr: unknown;
  for (const model of modelChain()) {
    try {
      return await attemptOpenRouter(model, req);
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
  if (status === 401) return "OpenRouter rejected the API key — check OPENROUTER_API_KEY.";
  if (status === 402) return "OpenRouter account is out of credits.";
  if (status === 429) return "Rate limited by OpenRouter — try again in a moment.";
  if (status === 404 || /model/i.test(msg))
    return `OpenRouter: ${msg || "model not found"} — set OPENROUTER_MODEL to a valid model id.`;
  return `OpenRouter error (${status}): ${msg || "request failed"}`;
}

/**
 * Run one chat completion against whichever provider is configured.
 * Throws LlmRefusal when the model declines, or an Error (with .status
 * when known) on transport/provider failures.
 */
export async function llmChat(req: LlmRequest): Promise<string> {
  const provider = llmProvider();
  if (provider === "anthropic") return chatAnthropic(req);
  if (provider === "openrouter") return chatOpenRouter(req);
  throw Object.assign(new Error(NO_PROVIDER_MSG), { status: 503 });
}
