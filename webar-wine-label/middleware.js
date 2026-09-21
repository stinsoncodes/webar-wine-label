// Server-side half of the code gate. Vercel Edge Middleware.
//
// WHAT IT PROTECTS. A printed QR encodes ?wine=<id>, and a watch link you send
// carries one too — those URLs were handed to somebody deliberately, so they pass
// untouched. Everything else, which in practice means the bare root and the
// picker, needs the code. That is the surface a stranger can actually land on,
// and it is also the screen that would otherwise list all thirteen names.
//
// WHAT IT DOES NOT PROTECT. Only the page is gated (see `config.matcher`), never
// /assets. It cannot be otherwise: a legitimate QR scan arrives with no cookie
// and immediately needs app.js, wines.js, a .mind and an mp4, so those have to
// stay reachable. Gating them on a cookie set by the page would also break any
// webview that blocks cookies — a blank screen for someone holding a bottle,
// which is far worse than the exposure. The clips stay fetchable by direct URL;
// robots.txt and X-Robots-Tag remain their only cover, as before.
//
// SAFETY VALVE. With GATE_CODE unset this file does nothing at all, so deploying
// it cannot change how the site behaves. Set GATE_CODE in the Vercel project to
// turn the gate on; unset it to turn the gate off again without a deploy.
//
// The code itself never reaches the browser from here. app.js carries its own
// fallback copy of this screen for the case where middleware does not run, and
// that one does contain the code — see `CODE` there.

export const config = {
  // The page only. Assets, wines.js, app.js and style.css are untouched.
  matcher: '/',
}

// Baked into printed QR codes and never changed, so a literal list is safe and
// saves importing the manifest into the edge runtime. tests/gate.test.mjs asserts
// it still matches LABELS in wines.js.
const IDS = [
  'jacqui', 'james', 'seth', 'kyle', 'scot', 'julie', 'bo',
  'dan', 'jayshree', 'jeff', 'karl', 'duke', 'loren',
]

const COOKIE = 'wl_pass'
const YEAR = 60 * 60 * 24 * 365

// A cookie value that cannot be guessed without knowing the code. Someone who
// does know it is, by definition, meant to be here. Derived rather than random so
// there is no session state to keep at the edge.
async function tokenFor (code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('wl|' + code))
  return [...new Uint8Array(buf)].slice(0, 12)
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

function cookieValue (header, name) {
  for (const part of (header || '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

export default async function middleware (req) {
  const code = process.env.GATE_CODE
  if (!code) return                                    // inert: nothing configured

  const url = new URL(req.url)
  const wine = url.searchParams.get('wine')
  if (wine && IDS.includes(wine)) return               // a bottle, or a sent link

  const token = await tokenFor(code)
  if (cookieValue(req.headers.get('cookie'), COOKIE) === token) return

  if (req.method === 'POST') {
    let sent = ''
    try {
      sent = new URLSearchParams(await req.text()).get('code') || ''
    } catch { /* unreadable body counts as a wrong answer */ }
    if (sent.trim() === code) {
      return new Response(null, {
        status: 303,
        headers: {
          location: url.pathname + url.search,
          'set-cookie': `${COOKIE}=${token}; Path=/; Max-Age=${YEAR}; SameSite=Lax`,
          'cache-control': 'no-store',
        },
      })
    }
    return page(true)
  }

  return page(false)
}

// Deliberately self-contained: no stylesheet, no script, nothing from the app.
// This is what an uninvited visitor sees, so it gives away neither the manifest
// nor what the site is.
function page (wrong) {
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<title>Enter code</title>
<style>
  :root { color-scheme: dark; }
  html { background: #0d0d0f; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column;
         align-items: center; justify-content: center; gap: 18px;
         padding: 32px 24px calc(32px + env(safe-area-inset-bottom));
         color: #f0efec; font: 16px/1.5 -apple-system, system-ui, "Segoe UI", sans-serif;
         -webkit-font-smoothing: antialiased; text-align: center; }
  form { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 260px; }
  input { font: 600 22px/1 inherit; text-align: center; letter-spacing: .18em;
          color: #f0efec; background: #1b1b1f; border: 1px solid #2e2e35;
          border-radius: 12px; padding: 16px; }
  input:focus { outline: 2px solid #b8332f; outline-offset: 2px; }
  button { font: 600 16px/1 inherit; color: #fff; background: #b8332f; border: 0;
           border-radius: 999px; padding: 16px; cursor: pointer; }
  button:active { filter: brightness(.86); }
  p { margin: 0; color: #8d8d96; font-size: 13.5px; }
  p.bad { color: #e2706c; }
</style>
<p>Enter the code to continue.</p>
<form method="POST" action="/">
  <input name="code" inputmode="numeric" autocomplete="off" autofocus
         aria-label="Code" ${wrong ? 'aria-invalid="true"' : ''}>
  <button type="submit">Continue</button>
</form>
${wrong ? '<p class="bad" role="alert">That’s not it.</p>' : ''}
`
  return new Response(html, {
    status: 401,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet',
    },
  })
}
