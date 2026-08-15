"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that caches the app shell (public/sw.js).
 *
 * Registration waits for load so it never competes with the first paint for
 * bandwidth, and a waiting worker is told to take over straight away — the
 * alternative is a new deploy sitting behind every open tab until the user
 * happens to close them all.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    // a dev build's chunks are not content-hashed the way a production build's
    // are, so caching them serves stale code across edits
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          if (reg.waiting) reg.waiting.postMessage("skip-waiting");
          reg.addEventListener("updatefound", () => {
            const next = reg.installing;
            if (!next) return;
            next.addEventListener("statechange", () => {
              if (next.state === "installed" && navigator.serviceWorker.controller)
                next.postMessage("skip-waiting");
            });
          });
        })
        .catch(() => {
          // an unregistrable worker (private mode, unsupported browser) costs
          // the offline shell, not the app
        });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
