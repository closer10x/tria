import type { MetadataRoute } from "next";

/**
 * Installable app metadata. With this plus the service worker, Tria can be
 * added to a phone's home screen and opens without browser chrome — which is
 * what makes the three-pane layout usable on a small screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tria — Mail · Tasks · Threads",
    short_name: "Tria",
    description:
      "One surface for email, smart tasks, and conversations — everything connected.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    // matches the header/nav bars, so the system chrome continues the app
    background_color: "#10141a",
    theme_color: "#10141a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
