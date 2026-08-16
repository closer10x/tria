import { NextRequest, NextResponse } from "next/server";
import { UNLOCK_COOKIE, armed, verifyToken } from "@/lib/server/appAuth";

/**
 * One gate in front of everything, rather than a check inside each route.
 *
 * The exemptions are deliberately short. /api/unlock has to be reachable to
 * get a cookie in the first place, and the OAuth callback has to be reachable
 * because the provider redirects the browser back to it — that route is
 * already bound to a one-time code plus the PKCE verifier in a state cookie,
 * so it is not an open door.
 */

const OPEN_PATHS = [
  "/api/unlock",
  "/api/oauth", // provider redirects back here; PKCE + state cookie guard it
];

export const config = {
  // everything except Next's own assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export async function middleware(req: NextRequest) {
  if (!armed()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)))
    return NextResponse.next();

  if (await verifyToken(req.cookies.get(UNLOCK_COOKIE)?.value))
    return NextResponse.next();

  // an API caller gets a status it can act on; a browser gets the lock screen
  if (pathname.startsWith("/api/"))
    return NextResponse.json(
      { ok: false, error: "Locked — unlock Tria in the browser first." },
      { status: 401 }
    );

  return new NextResponse(LOCK_SCREEN, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const LOCK_SCREEN = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tria — locked</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100dvh; display:grid; place-items:center;
         background:#10141b; color:#e7eaf0;
         font:400 15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif }
  form { width:min(22rem,calc(100vw - 2rem)); text-align:center }
  h1 { font-size:13px; font-weight:400; letter-spacing:.32em; text-transform:uppercase;
       color:#a7b0be; margin:0 0 1.25rem }
  input { width:100%; box-sizing:border-box; padding:.7rem .9rem; font-size:15px;
          color:#e7eaf0; background:#1d232d; border:1px solid #2c343f;
          border-radius:.6rem; outline:none }
  input:focus { border-color:#c96f4a }
  button { width:100%; margin-top:.6rem; padding:.7rem; font-size:14px; font-weight:600;
           color:#fff; background:#c96f4a; border:0; border-radius:.6rem; cursor:pointer }
  p { min-height:1.2em; margin:.75rem 0 0; font-size:13px; color:#f0787e }
</style>
<form id="f">
  <h1>Tria</h1>
  <input id="p" type="password" placeholder="Password" autofocus autocomplete="current-password">
  <button type="submit">Unlock</button>
  <p id="e"></p>
</form>
<script>
  const f=document.getElementById('f'),p=document.getElementById('p'),e=document.getElementById('e');
  f.onsubmit=async(ev)=>{
    ev.preventDefault(); e.textContent='';
    const r=await fetch('/api/unlock',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password:p.value})});
    if(r.ok) location.reload();
    else { e.textContent='Wrong password.'; p.select(); }
  };
</script>`;
