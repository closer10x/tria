import { Parser } from "htmlparser2";

/**
 * Turn a raw email into something safe and readable for the reader pane.
 *
 * - HTML part → sanitized HTML: a strict tag/attribute allowlist, no scripts,
 *   styles, forms, or event handlers; https images load with no referrer
 *   (http:/cid: ones fall back to alt text); elements the sender hides
 *   (preheader filler, mso blocks) stay hidden; links open in a new
 *   tab with rel=noopener; tables/widths that force horizontal scroll on a
 *   phone are stripped.
 * - Text part → HTML: paragraphs, and the URL/tel/mailto wrappers plaintext
 *   mail carries (`Foo<https://…>`, `713-590-6494<tel:…>`) collapse into real
 *   links instead of showing as code.
 */

const ALLOWED_TAGS = new Set([
  "a", "b", "strong", "i", "em", "u", "s", "br", "p", "div", "span",
  "ul", "ol", "li", "blockquote", "pre", "code", "h1", "h2", "h3", "h4",
  "h5", "h6", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "hr",
  "img", "sup", "sub", "small", "font", "center",
]);
// tags whose ENTIRE subtree is dropped, not just the tag
const DROP_SUBTREE = new Set(["script", "style", "head", "title", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "svg", "math", "noscript", "template"]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "width", "height"]),
  td: new Set(["colspan", "rowspan", "align", "valign", "bgcolor"]),
  th: new Set(["colspan", "rowspan", "align", "valign", "bgcolor"]),
  table: new Set(["cellpadding", "cellspacing", "align", "bgcolor"]),
  // (no `width` on table/td/th — a pinned 600px column is exactly what shoves
  //  a phone reader sideways; the reader CSS makes tables fluid instead)
  font: new Set(["color", "face", "size"]),
};
/**
 * Inline style survives only for these properties — enough for the sender's
 * layout (colours, alignment, spacing, type) with nothing that can escape the
 * pane (position, fixed sizes, transforms) or fetch anything (url()).
 */
const SAFE_STYLE_PROPS = new Set([
  "color", "background-color", "background", "font-family", "font-size",
  "font-weight", "font-style", "text-align", "text-decoration", "line-height",
  "letter-spacing", "text-transform", "vertical-align", "padding",
  "padding-top", "padding-right", "padding-bottom", "padding-left", "margin",
  "margin-top", "margin-right", "margin-bottom", "margin-left", "border",
  "border-top", "border-right", "border-bottom", "border-left",
  "border-radius", "border-collapse", "border-spacing", "display",
  "white-space", "word-break", "opacity", "max-width",
  // deliberately absent: width, min-width, height, position, float, transform
]);
function safeStyle(style: string): string {
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (!SAFE_STYLE_PROPS.has(prop)) continue;
    // no external fetches, no expressions, no escaping via display
    if (/url\s*\(|expression|javascript|@import|behavior/i.test(val)) continue;
    if (prop === "display" && !/^(block|inline|inline-block|none|table|table-cell|table-row)$/i.test(val)) continue;
    if (prop === "background" && /url|gradient/i.test(val)) continue;
    // never let one email set a fixed width wider than a phone
    if (prop === "max-width") {
      const px = parseInt(val, 10);
      if (Number.isNaN(px) || px > 100) continue;
    }
    kept.push(`${prop}:${val.replace(/"/g, "'")}`);
  }
  return kept.join(";");
}
const VOID = new Set(["br", "img", "hr"]);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^(https?:|mailto:|tel:)/i.test(h)) return h;
  return null;
}

/** Whitelist-sanitize an HTML email body. Never trust the result less than this. */
export function sanitizeEmailHtml(html: string, opts: { allowRemoteImages?: boolean } = { allowRemoteImages: true }): string {
  const out: string[] = [];
  let dropDepth = 0; // >0 while inside a DROP_SUBTREE element
  const openStack: string[] = [];

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const tag = name.toLowerCase();
        if (dropDepth > 0 || DROP_SUBTREE.has(tag)) {
          if (DROP_SUBTREE.has(tag) || dropDepth > 0) dropDepth++;
          return;
        }
        // honour the sender's own hiding — preheader filler ("͏ ­ ͏ ­ …"),
        // hidden tracking blocks — otherwise stripping style makes it visible
        const style = (attribs.style ?? "").toLowerCase();
        if (
          /display\s*:\s*none/.test(style) ||
          /visibility\s*:\s*hidden/.test(style) ||
          /max-height\s*:\s*0(px)?\s*(;|$)/.test(style) ||
          /mso-hide\s*:\s*all/.test(style) ||
          attribs.hidden !== undefined
        ) {
          dropDepth++;
          return;
        }
        if (!ALLOWED_TAGS.has(tag)) {
          // unknown/disallowed tag: keep its text, drop the wrapper
          return;
        }
        const allowed = ALLOWED_ATTRS[tag];
        const attrs: string[] = [];
        if (allowed) {
          for (const [k, v] of Object.entries(attribs)) {
            const key = k.toLowerCase();
            if (!allowed.has(key)) continue;
            if (key === "href") {
              const safe = safeHref(v);
              if (!safe) continue;
              attrs.push(`href="${esc(safe)}"`);
            } else if (key === "src") {
              const s = v.trim();
              if (s.startsWith("data:image/") || (opts.allowRemoteImages && /^https:/i.test(s)))
                attrs.push(`src="${esc(s)}"`);
              else continue; // http:/cid: images can't render here → alt text
            } else if (key === "width" || key === "height") {
              // cap absolute sizes so nothing forces a horizontal scroll
              const n = parseInt(v, 10);
              if (!Number.isNaN(n)) attrs.push(`${key}="${Math.min(n, 600)}"`);
            } else {
              attrs.push(`${key}="${esc(v)}"`);
            }
          }
        }
        if (style) {
          const kept = safeStyle(style);
          if (kept) attrs.push(`style="${esc(kept)}"`);
        }
        if (tag === "a") attrs.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
        // never send the reader's referrer to image hosts; decode off-thread
        if (tag === "img") attrs.push('referrerpolicy="no-referrer"', 'loading="lazy"', 'decoding="async"');
        out.push(`<${tag}${attrs.length ? " " + attrs.join(" ") : ""}${VOID.has(tag) ? "" : ">"}`);
        if (VOID.has(tag)) out.push(" />");
        else openStack.push(tag);
      },
      ontext(text) {
        if (dropDepth > 0) return;
        out.push(esc(text));
      },
      onclosetag(name) {
        const tag = name.toLowerCase();
        if (dropDepth > 0) {
          dropDepth--;
          return;
        }
        if (!ALLOWED_TAGS.has(tag) || VOID.has(tag)) return;
        // only close what we opened (malformed mail is the norm)
        const idx = openStack.lastIndexOf(tag);
        if (idx === -1) return;
        while (openStack.length > idx) out.push(`</${openStack.pop()}>`);
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true }
  );
  parser.write(html);
  parser.end();
  while (openStack.length) out.push(`</${openStack.pop()}>`);
  return out.join("");
}

/**
 * Plaintext mail → readable HTML. Handles the angle-bracket link wrappers that
 * mail clients (and Proofpoint/Safe Links rewriters) leave in text parts.
 */
export function textToEmailHtml(text: string): string {
  const paras = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const link = (href: string, label: string) =>
    `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${esc(label)}</a>`;
  // Tokenise the RAW text so URL characters (&, =) aren't mangled by escaping;
  // each piece is escaped as it's emitted.
  const linkify = (raw: string): string => {
    const out: string[] = [];
    let i = 0;
    // pattern order matters: "Label<url>" first, then orphan "<url>", then bare url
    const re =
      /(\[[^\]\n]{1,120}\]|[^\s<>\[\]]{1,120})\s*<((?:https?:\/\/|mailto:|tel:)[^>\s]+)>|<((?:https?:\/\/)[^>\s]+)>|(^|[\s(])((?:https?:\/\/)[^\s<>()"']+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      out.push(esc(raw.slice(i, m.index)));
      if (m[2]) {
        // "[Foo Logo]<https://…>" — a bracketed image alt is noise, drop the label
        const label = m[1].replace(/^\[.*\]$/, "").trim();
        out.push(label ? link(m[2], label) : link(m[2], shortUrl(m[2])));
      } else if (m[3]) {
        out.push(link(m[3], shortUrl(m[3])));
      } else {
        out.push(esc(m[4]), link(m[5], shortUrl(m[5])));
      }
      i = m.index + m[0].length;
    }
    out.push(esc(raw.slice(i)));
    return out.join("").replace(/\n/g, "<br />");
  };
  return paras.map((p) => `<p>${linkify(p)}</p>`).join("");
}

/**
 * Readable label for a URL. Corporate link rewriters (Proofpoint urldefense,
 * Microsoft SafeLinks) bury the real destination in a query param — show that
 * host, since the wrapper host tells the reader nothing.
 */
function shortUrl(url: string): string {
  try {
    let u = new URL(url);
    if (/urldefense\.(proofpoint\.)?com$/i.test(u.hostname)) {
      // v2: ?u=https-3A__www.rmwbh.com_  (escaped: -3A → :, _ → /)
      const raw = u.searchParams.get("u");
      if (raw) {
        const decoded = raw.replace(/-([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))).replace(/_/g, "/");
        try { u = new URL(decoded); } catch {}
      }
    } else if (/safelinks\.protection\.outlook\.com$/i.test(u.hostname)) {
      const raw = u.searchParams.get("url");
      if (raw) try { u = new URL(raw); } catch {}
    }
    const path = u.pathname !== "/" && u.pathname.length < 40 ? u.pathname : "";
    return u.hostname.replace(/^www\./, "") + path;
  } catch {
    return url.length > 60 ? url.slice(0, 57) + "…" : url;
  }
}
