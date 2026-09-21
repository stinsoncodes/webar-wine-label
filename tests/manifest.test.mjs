// Does wines.js describe what is actually on disk?
//
// This is the test that matters most, because the ids in wines.js are baked into
// printed QR codes: a bottle whose label points at a missing clip cannot be fixed
// by reprinting. Every failure here is something a viewer would see as a broken
// page. Run before every deploy: node --test "tests/*.test.mjs"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LABELS, CHARACTERS, DEFAULT_MATCH, DEFAULT_TRACKING }
  from '../webar-wine-label/wines.js'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'webar-wine-label')
const labelDir = id => join(APP, 'assets', 'labels', id)
const charDir = id => join(APP, 'assets', 'characters', id)

const labelIds = Object.keys(LABELS)
const charIds = Object.keys(CHARACTERS)

// --- tiny readers, so the suite needs no dependencies -----------------------

function jpegSize (path) {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(statSync(path).size)
    readSync(fd, buf, 0, buf.length, 0)
    let i = 2
    while (i < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue }
      const m = buf[i + 1]
      if (m >= 0xC0 && m <= 0xC3) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
      }
      if (m === 0xD8 || m === 0xD9 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  } finally { closeSync(fd) }
  throw new Error(`no SOF marker in ${path}`)
}

// Top-level MP4 box names in order, plus whether a 'soun' handler appears.
function mp4Facts (path) {
  const size = statSync(path).size
  const fd = openSync(path, 'r')
  try {
    const order = []
    let off = 0
    while (off < size && order.length < 12) {
      const hdr = Buffer.alloc(16)
      if (readSync(fd, hdr, 0, 16, off) < 8) break
      let boxSize = hdr.readUInt32BE(0)
      const type = hdr.toString('latin1', 4, 8)
      if (boxSize === 1) boxSize = Number(hdr.readBigUInt64BE(8))
      if (boxSize === 0) break
      order.push(type)
      off += boxSize
    }
    // The moov box holds the track handlers; it is small and sits up front in a
    // faststart file, so scanning the first 2 MB for 'soun' is enough.
    const head = Buffer.alloc(Math.min(size, 2 * 1024 * 1024))
    readSync(fd, head, 0, head.length, 0)
    return { order, hasAudio: head.includes(Buffer.from('soun')) }
  } finally { closeSync(fd) }
}

const nonEmpty = p => {
  assert.ok(existsSync(p), `missing ${p}`)
  assert.ok(statSync(p).size > 0, `empty ${p}`)
}

// --- ids --------------------------------------------------------------------

test('ids are URL- and filename-safe, and survive a QR round trip', () => {
  // The picker builds hrefs with encodeURIComponent and the ids are also
  // directory names; anything that changes shape either way is a trap.
  for (const id of new Set([...labelIds, ...charIds])) {
    assert.match(id, /^[a-z0-9][a-z0-9-]*$/, `id "${id}" is not lowercase-safe`)
    assert.equal(encodeURIComponent(id), id, `id "${id}" needs URL escaping`)
  }
})

test('every label has a character of the same id', () => {
  // A label's default character is itself: ?wine=<id> with no ?as= resolves to
  // CHARACTERS[<id>]. Without one, a scanned QR code dead-ends on "no clip yet".
  for (const id of labelIds) {
    assert.ok(CHARACTERS[id], `LABELS.${id} has no CHARACTERS.${id}`)
  }
})

// --- labels -----------------------------------------------------------------

test('every label ships its three asset files', () => {
  for (const id of labelIds) {
    nonEmpty(join(labelDir(id), 'targets.mind'))
    nonEmpty(join(labelDir(id), 'label.jpg'))          // ?still=1
    nonEmpty(join(labelDir(id), 'label-display.jpg'))  // ?watch=1
  }
})

test('target.w/h matches the compiled image, so nothing is stretched', () => {
  // MindAR normalises a target to 1 unit wide, so this ratio alone sets the label
  // plane's aspect. label.jpg is the same warp at the same size as the image
  // compiled into targets.mind, so it is the available witness.
  for (const id of labelIds) {
    const { w, h } = jpegSize(join(labelDir(id), 'label.jpg'))
    assert.equal(w, LABELS[id].target.w, `${id}: target.w should be ${w}`)
    assert.equal(h, LABELS[id].target.h, `${id}: target.h should be ${h}`)
  }
})

test('the display still is geometrically identical to the target still', () => {
  // They are one warp at two sizes. If they drift, the video panel no longer
  // lines up with the label behind it in watch mode.
  for (const id of labelIds) {
    const t = jpegSize(join(labelDir(id), 'label.jpg'))
    const d = jpegSize(join(labelDir(id), 'label-display.jpg'))
    const drift = Math.abs((d.w / d.h) / (t.w / t.h) - 1)
    assert.ok(drift < 0.005, `${id}: display aspect differs by ${(drift * 100).toFixed(2)}%`)
    assert.ok(d.w > t.w, `${id}: label-display.jpg should be the larger copy`)
  }
})

test('labels carry the measurements the curve is derived from', () => {
  for (const id of labelIds) {
    const l = LABELS[id]
    assert.ok(l.name, `${id}: no display name`)
    if (l.curve === undefined) {
      assert.ok(l.target.chordMm > 0, `${id}: needs chordMm or an explicit curve`)
      assert.ok(l.bottle?.diameterMm > 0, `${id}: needs bottle.diameterMm`)
      assert.ok(l.target.chordMm <= l.bottle.diameterMm,
        `${id}: chordMm ${l.target.chordMm} exceeds the bottle`)
    }
  }
})

// --- characters -------------------------------------------------------------

test('every character clip named in the manifest exists', () => {
  for (const id of charIds) {
    const v = CHARACTERS[id].video
    assert.ok(CHARACTERS[id].name, `${id}: no display name`)
    if (!v) continue                      // deliberate: renders as "no clip yet"
    nonEmpty(join(charDir(id), v.file))
  }
})

test('one clip per character directory', () => {
  // A superseded take still ships to the CDN, and two files in a directory invite
  // the wrong one being wired up later. Git keeps the old take if it is needed.
  for (const id of charIds) {
    if (!CHARACTERS[id].video) continue
    const mp4s = readdirSync(charDir(id)).filter(f => f.toLowerCase().endsWith('.mp4'))
    assert.deepEqual(mp4s, [CHARACTERS[id].video.file],
      `${id}: expected only ${CHARACTERS[id].video.file}`)
  }
})

test('no orphan character directories', () => {
  const dir = join(APP, 'assets', 'characters')
  for (const d of readdirSync(dir)) {
    if (!statSync(join(dir, d)).isDirectory()) continue
    assert.ok(CHARACTERS[d], `assets/characters/${d}/ has no CHARACTERS entry`)
  }
})

test('clips are faststart and carry audio', () => {
  for (const id of charIds) {
    if (!CHARACTERS[id].video) continue
    const { order, hasAudio } = mp4Facts(join(charDir(id), CHARACTERS[id].video.file))
    // moov after mdat means the browser must fetch the whole file before
    // loadedmetadata, and start() gives up after 12 seconds.
    const moov = order.indexOf('moov'), mdat = order.indexOf('mdat')
    assert.ok(moov !== -1, `${id}: no moov box`)
    assert.ok(moov < mdat || mdat === -1,
      `${id}: not faststart (${order.join(' ')}) — run ffmpeg -movflags +faststart`)
    // Watch mode's gate promises "Sound on".
    assert.ok(hasAudio, `${id}: no audio track`)
  }
})

test('crop stays inside the frame and place has a width', () => {
  for (const id of charIds) {
    const v = CHARACTERS[id].video
    if (!v) continue
    const c = { x: 0, y: 0, w: 1, h: 1, ...(v.crop || {}) }
    for (const [k, n] of Object.entries(c)) {
      assert.ok(n >= 0 && n <= 1, `${id}: crop.${k} = ${n} is outside 0..1`)
    }
    assert.ok(c.w > 0 && c.h > 0, `${id}: crop has no area`)
    assert.ok(c.x + c.w <= 1.0001, `${id}: crop runs off the right edge`)
    assert.ok(c.y + c.h <= 1.0001, `${id}: crop runs off the bottom edge`)
    // place.w above 1 pushes the panel past the label onto the glass.
    const w = v.place?.w ?? 1
    assert.ok(w > 0 && w <= 1, `${id}: place.w = ${w} must be within the label`)
  }
})

test('feather widths are non-negative and under half the panel', () => {
  const check = (who, f) => {
    if (f === undefined) return
    const vals = typeof f === 'number' ? [f] : Object.values(f)
    for (const n of vals) {
      assert.equal(typeof n, 'number', `${who}: non-numeric feather`)
      assert.ok(n >= 0 && n < 0.5, `${who}: feather ${n} outside 0..0.5`)
    }
  }
  for (const id of labelIds) check(`LABELS.${id}`, LABELS[id].feather)
  for (const id of charIds) check(`CHARACTERS.${id}`, CHARACTERS[id].video?.feather)
})

// --- shared defaults --------------------------------------------------------

test('the exposure matcher cannot be configured into a no-op or a runaway', () => {
  const m = DEFAULT_MATCH
  assert.ok(m.min > 0 && m.min <= 1, `min ${m.min}`)
  assert.ok(m.max >= 1, `max ${m.max}`)
  assert.ok(m.min < m.max, 'min must be below max')
  assert.ok(m.color >= 0 && m.color <= 1, `color ${m.color}`)
  assert.ok(m.smoothing > 0 && m.smoothing <= 1, `smoothing ${m.smoothing}`)
  assert.ok(m.intervalMs >= 16, `intervalMs ${m.intervalMs} would sample every frame`)
  assert.ok(m.sampleFrac > 0 && m.sampleFrac <= 1, `sampleFrac ${m.sampleFrac}`)
})

test('tracking defaults are all present and numeric', () => {
  for (const k of ['filterMinCF', 'filterBeta', 'missTolerance', 'warmupTolerance']) {
    assert.equal(typeof DEFAULT_TRACKING[k], 'number', `DEFAULT_TRACKING.${k}`)
  }
})

// --- the privacy rule the file states about itself --------------------------

test('no surnames or employer names leak into the served manifest', () => {
  // wines.js is served verbatim to anyone who opens the site, and says so at the
  // top: first names only. A two-word name is the shape that rule forbids.
  for (const id of [...labelIds, ...charIds]) {
    const name = (LABELS[id] || CHARACTERS[id]).name
    assert.ok(!/\s/.test(name), `"${name}" looks like more than a first name`)
  }
})
