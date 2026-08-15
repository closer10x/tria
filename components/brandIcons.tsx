import { Provider } from "@/lib/types";

/**
 * Simplified brand marks for the mail providers, drawn inline so the settings
 * dialog makes no network requests. Each keeps its brand colours in both
 * themes, so they are deliberately not currentColor.
 */

type IconProps = { className?: string };

const box = (className?: string) => ({
  viewBox: "0 0 24 24",
  className: className ?? "h-4 w-4",
  "aria-hidden": true,
});

export function GoogleIcon({ className }: IconProps) {
  return (
    <svg {...box(className)} xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.87c2.26-2.09 3.56-5.17 3.56-8.87Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-4v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62h-4a12 12 0 0 0 0 10.76l4-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

/** The Microsoft four-square logo. */
export function MicrosoftIcon({ className }: IconProps) {
  return (
    <svg {...box(className)} xmlns="http://www.w3.org/2000/svg">
      <path fill="#F25022" d="M2 2h9.3v9.3H2z" />
      <path fill="#7FBA00" d="M12.7 2H22v9.3h-9.3z" />
      <path fill="#00A4EF" d="M2 12.7h9.3V22H2z" />
      <path fill="#FFB900" d="M12.7 12.7H22V22h-9.3z" />
    </svg>
  );
}

/** Outlook.com — the blue envelope-in-a-square treatment. */
export function OutlookIcon({ className }: IconProps) {
  return (
    <svg {...box(className)} xmlns="http://www.w3.org/2000/svg">
      <rect x="9" y="4" width="13" height="16" rx="1.5" fill="#0F6CBD" />
      <path d="M10.5 7.5 15.5 11l5-3.5" stroke="#fff" strokeWidth="1.3" fill="none" />
      <rect x="2" y="2" width="12" height="20" rx="2.5" fill="#0364B8" />
      <ellipse cx="8" cy="12" rx="3.4" ry="4.1" fill="#fff" />
      <ellipse cx="8" cy="12" rx="1.6" ry="2.3" fill="#0364B8" />
    </svg>
  );
}

export function YahooIcon({ className }: IconProps) {
  return (
    <svg {...box(className)} xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#5F01D1" />
      <path
        fill="#fff"
        d="M5 7h3.1l2.5 4.3L13.1 7h3L11.9 14v3.4H9.3V14L5 7Z"
      />
      <circle cx="17.4" cy="15.9" r="1.5" fill="#fff" />
    </svg>
  );
}

/** iCloud — Apple's cloud silhouette. */
export function ICloudIcon({ className }: IconProps) {
  return (
    <svg {...box(className)} xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#3D9BE9"
        d="M18.6 18.5H6.7a4.4 4.4 0 0 1-.6-8.75 5.7 5.7 0 0 1 10.7-1.9 3.9 3.9 0 0 1 1.8 10.65Z"
      />
    </svg>
  );
}

/** A monogram reads far better than the silhouette at 16px. */
export function GoDaddyIcon({ className }: IconProps) {
  return (
    <svg {...box(className)} xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#111" />
      <text
        x="12"
        y="16.6"
        textAnchor="middle"
        fill="#1BDBDB"
        fontSize="11"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        GD
      </text>
    </svg>
  );
}

/** Custom / any IMAP server — a neutral server mark. */
export function ImapIcon({ className }: IconProps) {
  return (
    <svg {...box(className)} xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="4" width="18" height="6" rx="1.6" fill="#8C8C92" />
      <rect x="3" y="14" width="18" height="6" rx="1.6" fill="#B4B4BA" />
      <circle cx="6.6" cy="7" r="1" fill="#fff" />
      <circle cx="6.6" cy="17" r="1" fill="#fff" />
    </svg>
  );
}

/** The mark for each password-based provider preset. */
export function ProviderIcon({
  provider,
  className,
}: {
  provider: Provider;
  className?: string;
}) {
  switch (provider) {
    case "gmail":
      return <GoogleIcon className={className} />;
    case "outlook":
      return <OutlookIcon className={className} />;
    case "m365":
      return <MicrosoftIcon className={className} />;
    case "godaddy":
      return <GoDaddyIcon className={className} />;
    case "yahoo":
      return <YahooIcon className={className} />;
    case "icloud":
      return <ICloudIcon className={className} />;
    default:
      return <ImapIcon className={className} />;
  }
}
