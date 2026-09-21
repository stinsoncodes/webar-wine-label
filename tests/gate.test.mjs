// The code gate, both halves.
//
// middleware.js is a plain ES module over Web APIs (Request, Response,
// crypto.subtle), so its real logic runs here under Node. What this CANNOT check
// is whether Vercel actually invokes it — that only shows on a deployment.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LABELS } from '../webar-wine-label/wines.js'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'webar-wine-label')
const SRC = readFileSync(join(APP, 'middleware.js'), 'utf8')
const APP_JS = readFileSync(join(APP, 'app.js'), 'utf8')

const CODE = '26'
const load = async () => (await import('../webar-wine-label/middleware.js')).default
const get = (path, cookie) => new Request('https://example.com' + path,
  cookie ? { headers: { cookie } } : undefined)
const post = (path, body, cookie) => new Request('https://example.com' + path, {
  method: 'POST',
  body,
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
})

// --- the safety valve -------------------------------------------------------

test('with GATE_CODE unset the middleware does nothing at all', async () => {
  delete process.env.GATE_CODE
  const mw = await load()
  for (const p of ['/', '/?wine=loren', '/?watch=1']) {
    assert.equal(await mw(get(p)), undefined, `${p} should pass straight through`)
  }
})

// --- what is gated and what is not ------------------------------------------

test('the bare root and the picker need the code', async () => {
  process.env.GATE_CODE = CODE
  const mw = await load()
  for (const p of ['/', '/?watch=1', '/?tune=1', '/?wine=', '/?wine=nope', '/?as=loren']) {
    const res = await mw(get(p))
    assert.ok(res, `${p} should be gated`)
    assert.equal(res.status, 401, p)
    const html = await res.text()
    assert.match(html, /Enter the code/, p)
    // The screen must give away neither the manifest nor what the site is.
    assert.doesNotMatch(html, /jacqui|jayshree|Talking Wine|19 Crimes/i, p)
    // Token-boundary, or a CSS length like "260px" reads as a leak.
    assert.doesNotMatch(html, new RegExp(`\\b${CODE}\\b`), `${p} must not leak the code`)
  }
})

test('a printed QR and a sent watch link pass untouched', async () => {
  process.env.GATE_CODE = CODE
  const mw = await load()
  for (const id of Object.keys(LABELS)) {
    assert.equal(await mw(get(`/?wine=${id}`)), undefined, id)
    assert.equal(await mw(get(`/?wine=${id}&watch=1`)), undefined, id)
    assert.equal(await mw(get(`/?wine=${id}&as=seth&watch=1`)), undefined, id)
    assert.equal(await mw(get(`/?wine=${id}&preview=1&tune=1`)), undefined, id)
  }
})

test('only the page is matched, never the assets', () => {
  // A cookie-gated asset would break any webview that blocks cookies, and a
  // legitimate QR scan arrives with no cookie and needs them immediately.
  const m = SRC.match(/matcher:\s*(.+)/)
  assert.ok(m, 'no matcher configured')
  assert.equal(m[1].replace(/[',]/g, '').trim(), '/')
})

// --- answering it -----------------------------------------------------------

test('the right code sets a cookie and redirects back', async () => {
  process.env.GATE_CODE = CODE
  const mw = await load()
  const res = await mw(post('/?watch=1', 'code=' + CODE))
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/?watch=1', 'should return to where they were')
  const setCookie = res.headers.get('set-cookie')
  assert.match(setCookie, /^wl_pass=[0-9a-f]{24};/)
  assert.match(setCookie, /SameSite=Lax/)
  assert.match(setCookie, /Max-Age=31536000/)
  assert.doesNotMatch(setCookie, new RegExp('=' + CODE + ';'), 'cookie must not be the code')
})

test('surrounding whitespace is forgiven', async () => {
  process.env.GATE_CODE = CODE
  const mw = await load()
  const res = await mw(post('/', 'code=' + encodeURIComponent('  26 ')))
  assert.equal(res.status, 303)
})

test('a wrong code says so and sets nothing', async () => {
  process.env.GATE_CODE = CODE
  const mw = await load()
  for (const body of ['code=25', 'code=', 'code=262', '', 'nonsense']) {
    const res = await mw(post('/', body))
    assert.equal(res.status, 401, body)
    assert.equal(res.headers.get('set-cookie'), null, body)
    assert.match(await res.text(), /not it/, body)
  }
})

test('the cookie it issues is accepted, and a forged one is not', async () => {
  process.env.GATE_CODE = CODE
  const mw = await load()
  const issued = (await mw(post('/', 'code=' + CODE)))
    .headers.get('set-cookie').split(';')[0]
  assert.equal(await mw(get('/', issued)), undefined, 'its own cookie should pass')
  // Guessable values must not: this is the half that can actually verify.
  for (const forged of ['wl_pass=1', 'wl_pass=true', 'wl_pass=26', 'wl_pass=']) {
    const res = await mw(get('/', forged))
    assert.ok(res && res.status === 401, forged)
  }
})

test('a changed code invalidates cookies issued under the old one', async () => {
  process.env.GATE_CODE = CODE
  const mw = await load()
  const old = (await mw(post('/', 'code=' + CODE))).headers.get('set-cookie').split(';')[0]
  process.env.GATE_CODE = '4711'
  const res = await mw(get('/', old))
  assert.ok(res && res.status === 401, 'an old cookie should stop working')
  assert.equal(await mw(get('/', (await mw(post('/', 'code=4711')))
    .headers.get('set-cookie').split(';')[0])), undefined)
  process.env.GATE_CODE = CODE
})

test('the gate response is never cached or indexed', async () => {
  process.env.GATE_CODE = CODE
  const mw = await load()
  const res = await mw(get('/'))
  assert.match(res.headers.get('cache-control'), /no-store/)
  assert.match(res.headers.get('x-robots-tag'), /noindex/)
  assert.match(res.headers.get('content-type'), /text\/html/)
})

// --- the printed bottles must still open ------------------------------------

test('every printed QR code opens without the code', async () => {
  // The thirteen QR codes in source/qr/ are going onto glass. If a change to the
  // gate rule ever stopped one of them opening, no reprint could fix the bottles
  // already out. So the artwork itself is the fixture: parse the URL each SVG
  // says it encodes and put it through the real middleware.
  process.env.GATE_CODE = CODE
  const mw = await load()
  const dir = join(APP, '..', 'source', 'qr', 'svg')
  const files = readdirSync(dir).filter(f => f.endsWith('.svg'))
  assert.equal(files.length, Object.keys(LABELS).length,
    `${files.length} QR codes for ${Object.keys(LABELS).length} labels`)

  for (const f of files) {
    const svg = readFileSync(join(dir, f), 'utf8')
    const m = svg.match(/https?:\/\/[^\s"'<]+/)
    assert.ok(m, `${f}: no encoded URL found in the SVG`)
    const url = new URL(m[0])
    const wine = url.searchParams.get('wine')
    assert.ok(LABELS[wine], `${f} encodes wine=${wine}, which is not a label`)
    assert.equal(f, `qr-${wine}.svg`, `${f} encodes someone else's id`)
    // The bottle holder has no code to type, so this must pass untouched.
    assert.equal(await mw(get(url.pathname + url.search)), undefined,
      `${f} would be stopped by the code gate`)
  }
})

// --- the two halves must agree ----------------------------------------------

test('middleware and wines.js hold the same ids', () => {
  // The literal list in middleware.js exists so the edge runtime need not import
  // the manifest. If a label is added to wines.js and not here, its printed QR
  // code would hit the code screen — unfixable after printing.
  const block = SRC.match(/const IDS = \[([\s\S]*?)\]/)
  assert.ok(block, 'no IDS list found in middleware.js')
  const ids = [...block[1].matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1])
  assert.deepEqual(ids.slice().sort(), Object.keys(LABELS).slice().sort())
})

test('both halves gate on the same rule, and agree on the cookie name', () => {
  // app.js gates when there is no valid label; middleware when ?wine= is not a
  // known id. Same condition, expressed in each runtime's terms.
  assert.match(APP_JS, /if \(!label && !hasPass\(\)\)/)
  assert.match(APP_JS, /const PASS_COOKIE = 'wl_pass'/)
  assert.match(SRC, /const COOKIE = 'wl_pass'/)
})

test('the in-page half carries the code, and only that half', () => {
  // Stated plainly rather than discovered later: app.js is served to everyone, so
  // its copy of the code is readable. middleware.js must never inline it.
  assert.match(APP_JS, new RegExp(`const CODE = '${CODE}'`))
  assert.doesNotMatch(SRC, new RegExp(`['"]${CODE}['"]`),
    'middleware.js must read the code from the environment, never inline it')
  assert.match(SRC, /process\.env\.GATE_CODE/)
})
