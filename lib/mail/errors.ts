import { Provider } from "@/lib/types";

/**
 * IMAP/SMTP failures surface as unhelpful generic messages ("Command failed"),
 * with the real reason on other fields. Turn them into something actionable.
 */

type MailError = {
  message?: string;
  authenticationFailed?: boolean;
  responseText?: string;
  serverResponseCode?: string;
  code?: string;
};

const appPasswordHelp: Partial<Record<Provider, string>> = {
  gmail:
    "Gmail rejected the login. Use a 16-character app password, not your Google account password — Google Account → Security → 2-Step Verification → App passwords.",
  yahoo:
    "Yahoo rejected the login. Use an app password — Account Security → Generate app password.",
  icloud:
    "iCloud rejected the login. Use an app-specific password from appleid.apple.com.",
  outlook:
    "Outlook.com rejected the login. If 2FA is on, use an app password instead of your account password.",
  m365:
    "Microsoft 365 rejected the login. Usually IMAP or Authenticated SMTP is switched off for the mailbox — enable both at admin.microsoft.com → Users → Active users → the mailbox → Mail → Manage email apps. If the account has MFA on, Microsoft blocks password logins outright and it needs OAuth sign-in instead.",
  godaddy:
    "GoDaddy rejected the login. Double-check the password — if your mail runs on Microsoft 365, pick the Outlook preset instead.",
};

export function mailErrorMessage(e: unknown, provider?: Provider): string {
  const err = (e ?? {}) as MailError;
  const generic = !err.message || /^command failed$/i.test(err.message);

  if (err.authenticationFailed || err.serverResponseCode === "AUTHENTICATIONFAILED") {
    return (
      (provider && appPasswordHelp[provider]) ??
      "The mail server rejected that email and password. If your provider uses 2-factor auth, you need an app password rather than your normal one."
    );
  }

  switch (err.code) {
    case "ENOTFOUND":
      return "Couldn't find that mail server — check the IMAP host spelling.";
    case "ECONNREFUSED":
      return "The mail server refused the connection — check the host and port.";
    case "ETIMEDOUT":
    case "ARSC_TIMEOUT":
      return "The mail server didn't respond. Check the host and port, or try again.";
    case "CERT_HAS_EXPIRED":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "The mail server's security certificate didn't validate for that host.";
  }

  if (generic && err.responseText) return err.responseText;
  return err.message || "Connection failed";
}
