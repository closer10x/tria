import type { Metadata, Viewport } from "next";
import { Inter, Jost } from "next/font/google";
import "./globals.css";
import ServiceWorker from "@/components/ServiceWorker";

/**
 * Fonts are self-hosted rather than fetched from fonts.googleapis.com.
 * The stylesheet link was render-blocking on a third-party origin — two
 * preconnects and a round trip before the first paint — and with no network
 * it never arrived, so an offline start fell back to system fonts. Next
 * inlines the face declarations and serves the files from our own origin,
 * which the service worker then caches like any other static asset.
 */
const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-jost",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tria — Mail · Tasks · Threads",
  description:
    "One surface for email, smart tasks, and conversations — everything connected.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Tria",
    // the chrome is dark at every theme, so the status bar blends into it
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#10141a",
  // installed to the home screen the app owns the whole window, notch included
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${jost.variable} ${inter.variable}`}
    >
      <head>
        {/* apply the saved theme before first paint — no light flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem("tria-theme")||"dark"}catch(e){}`,
          }}
        />
      </head>
      <body className="paper-bg">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
