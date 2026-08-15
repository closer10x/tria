import { NextResponse } from "next/server";

/**
 * TEMPORARY diagnostic: asks Microsoft to authenticate this app's client
 * credentials, which is the only way to prove the deployed secret is the
 * secret VALUE and not the secret ID. Returns the outcome only — never the
 * credential itself. Remove once sign-in is confirmed working.
 */
export async function GET() {
  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    return NextResponse.json({
      secretPresent: Boolean(clientSecret),
      verdict: "Client ID or secret is not set in this deployment.",
    });

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const res = await fetch(
    "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    }
  );
  const data = (await res.json()) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  };
  const desc = data.error_description ?? data.error ?? "";
  const code = desc.split(":")[0] || null;

  // shape hints only — enough to spot a truncated or mangled paste, never the value
  const shape = {
    length: clientSecret.length,
    looksLikeSecretId: uuid.test(clientSecret),
    hasWhitespace: /\s/.test(clientSecret),
    hasMaskingChars: /[*•…]/.test(clientSecret) || clientSecret.includes("..."),
    startsWith: clientSecret.slice(0, 3),
    endsWith: clientSecret.slice(-2),
    typicalLength: clientSecret.length >= 34 && clientSecret.length <= 48,
  };

  return NextResponse.json({
    clientId, // public identifier — confirms which registration is in use
    shape,
    secretAccepted: Boolean(data.access_token),
    code,
    verdict: data.access_token
      ? "Secret is valid — client authenticated."
      : /AADSTS7000215/.test(desc)
        ? shape.looksLikeSecretId
          ? "Wrong field: this is the secret ID, not the secret value."
          : shape.hasWhitespace || shape.hasMaskingChars || !shape.typicalLength
            ? "Secret looks truncated or mangled — copy the full Value with the copy button."
            : "Microsoft rejects this secret. It is likely expired, deleted, or belongs to a different app registration than the client ID above."
        : /AADSTS7000218/.test(desc)
          ? "No secret reached the server."
          : `Client auth got past the secret check (${code}).`,
  });
}
