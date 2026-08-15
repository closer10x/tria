export type MailConfig = {
  user: string;
  /** Empty for OAuth accounts — see oauthAccountId. */
  pass: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /**
   * Set for token-backed accounts. Access tokens expire, so the session holds
   * only the account id and a fresh token is resolved per connection.
   */
  oauthAccountId?: string;
};

// One session token (cookie) → many connected accounts, keyed by email address.
const g = globalThis as unknown as {
  __triaMailSessions?: Map<string, Map<string, MailConfig>>;
};
if (!g.__triaMailSessions) g.__triaMailSessions = new Map();

export const sessions: Map<string, Map<string, MailConfig>> =
  g.__triaMailSessions;

export const COOKIE = "tria_mail";

export function getAccounts(token: string | undefined): Map<string, MailConfig> | undefined {
  return token ? sessions.get(token) : undefined;
}

/** Resolve one account's config; falls back to the only account when unambiguous. */
export function getAccount(
  token: string | undefined,
  account: string | null | undefined
): MailConfig | undefined {
  const accounts = getAccounts(token);
  if (!accounts || accounts.size === 0) return undefined;
  if (account) return accounts.get(account);
  if (accounts.size === 1) return accounts.values().next().value;
  return undefined;
}
