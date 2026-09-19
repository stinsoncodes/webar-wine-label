import { LABELS, CHARACTERS, DEFAULT_MATCH, DEFAULT_TRACKING } from './wines.js'

const $ = id => document.getElementById(id)
const q = new URLSearchParams(location.search)
const num = (k, fallback) => {
  const v = parseFloat(q.get(k))
  return Number.isFinite(v) ? v : fallback
}

// ---------------------------------------------------------------------------
// Video shader: UV crop, per-edge feather, exposure/white-balance gain
//
// crop      — generators pillarbox their output (HeyGen returns 16:9 or 9:16
//             whatever you feed it), so cropping here means a new clip never has
//             to be re-encoded to be usable.
// featherUV — fade widths per edge, in UV, ordered top/right/bottom/left. The
//             edges are not equivalent: the top lands on the printed torn-paper
//             edge and reads fine crisp, while the sides and bottom cut across
//             flat dark tone and need to dissolve.
// gain      — per-channel multiplier driven by the live camera feed, so the clip's
//             baked exposure follows the room instead of fighting it.
// ---------------------------------------------------------------------------
AFRAME.registerShader('label-video', {
  // `is: 'uniform'` is not optional — without it A-Frame treats these as plain
  // component data, the material compiles with an empty uniform set, and the crop
  // and feather silently do nothing.
  schema: {
    src:        { type: 'map',  is: 'uniform' },
    cropOffset: { type: 'vec2', is: 'uniform', default: { x: 0, y: 0 } },
    cropScale:  { type: 'vec2', is: 'uniform', default: { x: 1, y: 1 } },
    featherUV:  { type: 'vec4', is: 'uniform', default: { x: 0, y: 0, z: 0, w: 0 } },
    gain:       { type: 'vec3', is: 'uniform', default: { x: 1, y: 1, z: 1 } },
    unwarp:     { type: 'number', is: 'uniform', default: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D src;
    uniform vec2 cropOffset;
    uniform vec2 cropScale;
    uniform vec4 featherUV;   // top, right, bottom, left
    uniform vec3 gain;
    uniform float unwarp;     // panel half-arc, radians; 0 = texture already projected
    varying vec2 vUv;

    // Distance-to-edge ramp; a width of 0 disables that edge entirely.
    float edge(float d, float w) {
      return w > 0.0 ? smoothstep(0.0, w, d) : 1.0;
    }

    void main() {
      // The panel's x is a PROJECTED coordinate (curved-panel displaces z only),
      // but a clip generated from flat label artwork is linear in ARC length.
      // Convert before sampling, or the picture stretches toward the panel's
      // edges — 5% on a typical crop. This is the exact inverse of the
      // projection tools/warp-targets.py applies to the tracking targets.
      vec2 uv = vUv;
      if (unwarp > 0.0001) {
        uv.x = 0.5 + asin((2.0 * uv.x - 1.0) * sin(unwarp)) / (2.0 * unwarp);
      }
      vec4 c = texture2D(src, cropOffset + uv * cropScale);
      float a = edge(1.0 - vUv.y, featherUV.x)   // top
              * edge(1.0 - vUv.x, featherUV.y)   // right
              * edge(vUv.y,       featherUV.z)   // bottom
              * edge(vUv.x,       featherUV.w);  // left
      gl_FragColor = vec4(c.rgb * gain, c.a * a);
    }
  `,
})

// ---------------------------------------------------------------------------
// Curved panel geometry
//
// The label is wrapped around a cylinder; a flat plane reads as a card taped to
// the bottle. `curve` is the half-arc angle the panel subtends, in degrees.
//
// Only z is displaced, never x. The texture is already the *projected* view of a
// curved label — either photographed off a bottle or pre-warped by
// tools/warp-targets.py — so its horizontal axis is R*sin(theta), which is exactly
// the flat mesh's x. Bending x as well would apply the foreshortening twice and
// squeeze the middle of the face.
// ---------------------------------------------------------------------------
AFRAME.registerGeometry('curved-panel', {
  schema: {
    width:    { default: 1 },
    height:   { default: 1 },
    curve:    { default: 0 },
    segments: { default: 48 },
  },
  init (data) {
    const g = new THREE.PlaneGeometry(data.width, data.height, data.segments, 1)
    const t = THREE.MathUtils.degToRad(data.curve)
    if (t > 0.001) {
      const sinT = Math.sin(t)
      const cosT = Math.cos(t)
      const R = (data.width / 2) / sinT          // chord half-width = R*sin(t)
      const pos = g.attributes.position
      for (let i = 0; i < pos.count; i++) {
        const s = pos.getX(i) / (data.width / 2)               // -1..1
        const c = Math.sqrt(Math.max(0, 1 - s * s * sinT * sinT))
        pos.setZ(i, R * (c - cosT))                            // 0 at edges, bulges at centre
      }
      pos.needsUpdate = true
      g.computeVertexNormals()
    }
    this.geometry = g
  },
})

function panel (width, height, curve) {
  const el = document.createElement('a-entity')
  el.setAttribute('geometry',
    `primitive: curved-panel; width: ${width}; height: ${height}; curve: ${curve}`)
  return el
}

// Half-arc angle, in degrees, that a chord of `chordMm` subtends on a cylinder of
// `diameterMm`. Lets a manifest state the two things that are actually measurable
// about a bottle rather than a magic angle nobody can re-derive later.
function curveFromBottle (chordMm, diameterMm) {
  if (!chordMm || !diameterMm) return 0
  const s = (chordMm / 2) / (diameterMm / 2)
  if (!(s > 0)) return 0
  if (s > 1.001) {
    console.warn(`chordMm ${chordMm} exceeds bottle diameter ${diameterMm}; curve disabled`)
    return 0
  }
  // s == 1 is a label wrapping exactly to the silhouette — real, and 90deg is the
  // right answer. Clamp just below to keep asin and the 1/sin in the geometry finite.
  return Math.asin(Math.min(s, 0.9999)) * 180 / Math.PI
}

// `feather` may be a scalar, {top, side, bottom}, or {top, right, bottom, left}.
// Always returns all four, in label-width units, CSS order.
function normaliseFeather (f) {
  if (typeof f === 'number') return { top: f, right: f, bottom: f, left: f }
  if (!f) return { top: 0, right: 0, bottom: 0, left: 0 }
  const side = f.side ?? 0
  return {
    top:    f.top    ?? 0,
    right:  f.right  ?? side,
    bottom: f.bottom ?? 0,
    left:   f.left   ?? side,
  }
}

const labelDir = id => `assets/labels/${id}`
const charDir  = id => `assets/characters/${id}`

// ---------------------------------------------------------------------------
// Selection
//
// ?wine=<label>  which physical label is being tracked. This is what a QR encodes.
// ?as=<character> whose clip plays, defaulting to the label's own person. The cast
//                 selector rewrites this — it never touches the target.
// ---------------------------------------------------------------------------

const labelIds = Object.keys(LABELS)
const wantedLabel = q.get('wine')
const label = wantedLabel ? LABELS[wantedLabel] : null
const initialChar = q.get('as') && CHARACTERS[q.get('as')] ? q.get('as') : wantedLabel

// Dispatch happens in boot(), called at the very bottom of this module. The video
// element and the scene state below are const/let declarations, so calling start()
// from here would hit their temporal dead zone.
function boot () {
  if (!label) {
    showPicker(wantedLabel ? `No label called “${wantedLabel}”.` : null)
  } else if (q.get('preview') === '1') {
    start()        // no camera, muted video: nothing needs a user gesture
  } else {
    showGate()
  }
}

function showPicker (hint) {
  const list = $('picker-list')
  if (!labelIds.length) {
    fatal('No labels are configured. Add an entry to wines.js.')
    return
  }
  labelIds.forEach(id => {
    const l = LABELS[id]
    const a = document.createElement('a')
    a.className = 'wine'
    a.href = '?wine=' + encodeURIComponent(id) + (q.get('tune') ? '&tune=1' : '')
    a.innerHTML = '<b></b><span></span>'
    a.firstChild.textContent = l.name
    a.lastChild.textContent = l.variant || id
    list.appendChild(a)
  })
  if (hint) { $('picker-hint').textContent = hint; $('picker-hint').hidden = false }
  $('picker').hidden = false
}

function fatal (msg) {
  $('fatal-msg').textContent = msg
  $('fatal').hidden = false
  $('gate').hidden = true
  $('scan').hidden = true
}

// ---------------------------------------------------------------------------
// Tap gate
//
// Two jobs, both requiring a user gesture: unlock audio playback, and put the
// camera permission prompt directly behind a deliberate tap. The scene is not
// attached until the tap for exactly that reason.
// ---------------------------------------------------------------------------

function showGate () {
  const el = $('gate-label')
  el.textContent = label.name
  if (label.variant) {
    const s = document.createElement('span')
    s.textContent = label.variant
    el.appendChild(s)
  }
  // Preload the initial clip while the gate is up. iOS drops the user gesture if
  // you await anything before calling play(), so the tap handler has to be able to
  // play synchronously — which means the source must already be set.
  const char = CHARACTERS[initialChar]
  if (char && char.video) video.src = `./${charDir(initialChar)}/${char.video.file}`

  $('gate').hidden = false
  $('gate-btn').addEventListener('click', start, { once: true })
}

// One video element for the whole session, reused across character switches.
// Audio user-activation lives on the ELEMENT: the tap gate's play() is what earns
// the right to play with sound later. Creating a fresh element per switch would
// throw that away and the cast selector would go silent.
const video = document.createElement('video')
video.id = 'avatar'
video.setAttribute('playsinline', '')
video.setAttribute('webkit-playsinline', '')
video.preload = 'auto'
video.loop = true
video.crossOrigin = 'anonymous'

async function start () {
  $('gate').hidden = true

  const char = CHARACTERS[initialChar]
  if (!char || !char.video) {
    fatal(`No clip for ${char ? char.name : initialChar} yet.`)
    return
  }
  if (!video.src) video.src = `./${charDir(initialChar)}/${char.video.file}`

  // Fire play() synchronously — this is what earns the audio unlock, and the
  // unlock lives on the ELEMENT, so it survives every later src swap and is what
  // keeps the cast selector audible. Do not await it: an element whose source is
  // still loading may not settle, and awaiting first loses the gesture on iOS.
  //
  // Skipped in preview: there is no gesture to preserve and no audio wanted, and
  // the unlock's trailing pause() would race preview's own play() and leave the
  // clip frozen on frame 0 — which looks exactly like the still label rendering
  // with no video at all.
  if (!preview) {
    const p = video.play()
    if (p && p.then) {
      p.then(() => { if (!locked) video.pause() })
       .catch(e => console.warn('audio unlock failed:', e.message))
    }
  }

  if (video.readyState < 1) {
    try {
      await once(video, 'loadedmetadata', 12000)
    } catch {
      fatal(`Couldn't load ${char.video.file}. Check that ${charDir(initialChar)}/ is complete.`)
      return
    }
  }
  buildScene()
}

function once (el, ev, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms)
    const done = () => { clearTimeout(t); cleanup(); res() }
    const fail = () => { clearTimeout(t); cleanup(); rej(new Error('error')) }
    const cleanup = () => {
      el.removeEventListener(ev, done); el.removeEventListener('error', fail)
    }
    el.addEventListener(ev, done, { once: true })
    el.addEventListener('error', fail, { once: true })
  })
}

async function loadClip (charId) {
  const c = CHARACTERS[charId]
  video.src = `./${charDir(charId)}/${c.video.file}`
  try {
    await once(video, 'loadedmetadata', 12000)
    return true
  } catch {
    fatal(`Couldn't load ${c.video.file}. Check that ${charDir(charId)}/ is complete.`)
    return false
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

let charId = initialChar
let flatSource = true
let crop, place, croppedAspect, feather, curve, gain, front, back, anchor
let scene, cam, locked = false, onGain = null, matchTimer = null
const preview = q.get('preview') === '1'
const FOV = 80

function buildScene () {
  // MindAR normalises a target to 1 unit wide, so the label plane's height is
  // just the compiled image's aspect. Everything below is in those units.
  const labelH = label.target.h / label.target.w

  feather = readFeather(label.feather)
  curve = num('curve',
    label.curve ?? curveFromBottle(label.target.chordMm, label.bottle?.diameterMm))
  gain = [1, 1, 1]
  readCharacter(charId, true)

  const track = { ...DEFAULT_TRACKING, ...(label.tracking || {}) }
  for (const k of Object.keys(track)) track[k] = num(k, track[k])

  scene = document.createElement('a-scene')
  if (!preview) {
    scene.setAttribute('mindar-image', [
      `imageTargetSrc: ./${labelDir(wantedLabel)}/targets.mind`,
      'maxTrack: 1',
      'uiScanning: no',
      'uiLoading: no',
      'uiError: no',
      ...Object.entries(track).map(([k, v]) => `${k}: ${v}`),
    ].join('; '))
  } else {
    scene.setAttribute('background', 'color: #202024')
  }
  scene.setAttribute('vr-mode-ui', 'enabled: false')
  scene.setAttribute('device-orientation-permission-ui', 'enabled: false')
  scene.setAttribute('embedded', '')
  scene.setAttribute('renderer', 'antialias: true; alpha: true')

  const assets = document.createElement('a-assets')
  assets.appendChild(video)
  if (label.still || q.get('still') === '1') {
    const img = document.createElement('img')
    img.id = 'still'
    img.src = `./${labelDir(wantedLabel)}/${label.still || 'label.jpg'}`
    img.crossOrigin = 'anonymous'
    assets.appendChild(img)
  }
  scene.appendChild(assets)

  cam = document.createElement('a-camera')
  cam.setAttribute('position', '0 0 0')
  cam.setAttribute('fov', FOV)
  cam.setAttribute('look-controls', 'enabled: false')
  cam.setAttribute('wasd-controls', 'enabled: false')
  scene.appendChild(cam)

  anchor = document.createElement('a-entity')
  if (!preview) anchor.setAttribute('mindar-image-target', 'targetIndex: 0')

  // Optional back panel: a digital copy of the whole label. Off by default — the
  // physical label is already there, perfectly registered and perfectly lit, and
  // covering it with a photo of itself is strictly worse than leaving it alone.
  back = null
  // ?still=1 forces the backing label on. Off in normal use — the physical label
  // is already there and better lit — but invaluable for aligning a clip in
  // ?preview=1 with no bottle in reach. The image is the PRE-WARPED target, so it
  // shares the panel's projected geometry.
  const wantStill = label.still || (q.get('still') === '1' ? 'label.jpg' : null)
  if (wantStill) {
    back = panel(1, labelH, curve)
    back.setAttribute('material', 'shader: flat; src: #still; transparent: false')
    anchor.appendChild(back)
  }

  front = panel(1, 1, curve)
  front.id = 'video-plane'
  anchor.appendChild(front)
  applyVideo()

  scene.appendChild(anchor)
  document.body.appendChild(scene)

  function readFeather (f) {
    const f0 = normaliseFeather(f)
    return {
      top:    num('ft', num('feather', f0.top)),
      right:  num('fr', num('feather', f0.right)),
      bottom: num('fb', num('feather', f0.bottom)),
      left:   num('fl', num('feather', f0.left)),
    }
  }

  // Query overrides apply only to the character named in the URL. Carrying them
  // onto a character you switched to would silently mis-place their clip.
  function readCharacter (id, allowOverrides) {
    const v = CHARACTERS[id].video
    // Clips generated from the flat label artwork need unwarping onto the curved
    // panel. Set flatSource: false for a clip that is already projected.
    flatSource = v.flatSource !== false && q.get('unwarp') !== '0'
    const o = allowOverrides ? num : (_k, d) => d
    crop = {
      x: o('cx', v.crop?.x ?? 0), y: o('cy', v.crop?.y ?? 0),
      w: o('cw', v.crop?.w ?? 1), h: o('ch', v.crop?.h ?? 1),
    }
    place = {
      x: o('vx', v.place?.x ?? 0), y: o('vy', v.place?.y ?? 0),
      w: o('vw', v.place?.w ?? 1),
    }
    if (v.feather) feather = readFeather(v.feather)
    recomputeAspect()
  }

  function recomputeAspect () {
    croppedAspect = (crop.w * video.videoWidth) / (crop.h * video.videoHeight)
  }

  function applyVideo () {
    // A flat-source clip covers more ARC than its chord width suggests, so its
    // height must be derived from the arc, not from the chord. Getting this wrong
    // squashes the panel ~5% vertically.
    const R = (label.bottle?.diameterMm || 0) / 2
    const chordMm = label.target.chordMm || 0
    let unwarp = 0
    let spanUnits = place.w
    if (flatSource && R > 0 && chordMm > 0) {
      const s = Math.min(0.9999, (place.w * chordMm / 2) / R)
      unwarp = Math.asin(s)
      spanUnits = (2 * R * unwarp) / chordMm
    }
    const vh = spanUnits / croppedAspect
    front.setAttribute('geometry',
      `primitive: curved-panel; width: ${place.w}; height: ${vh}; curve: ${curve}`)
    if (back) {
      back.setAttribute('geometry',
        `primitive: curved-panel; width: 1; height: ${labelH}; curve: ${curve}`)
    }
    // Nudged toward the viewer so it clears the physical label and, when the back
    // panel is on, sits in front of it. Scales with curve: a deeper bulge needs
    // more clearance at the edges to avoid z-fighting with the panel behind.
    const z = 0.002 + curve * 0.0002
    front.setAttribute('position', `${place.x} ${place.y} ${z.toFixed(5)}`)

    // Frame the preview camera on whatever is actually rendered. With the back
    // panel off, the label plane no longer exists and framing to its height would
    // point the camera at empty space above the video.
    if (preview) {
      const fitH = back ? labelH : vh
      const fitY = back ? 0 : place.y
      const wide = back ? 1 : place.w
      const t = curve * Math.PI / 180
      const bulge = t > 0.001
        ? ((wide / 2) / Math.sin(t)) * (1 - Math.cos(t))
        : 0
      // FOV is vertical, so on a portrait phone the horizontal field is much
      // narrower and is usually the binding constraint. Fit both, take the
      // further of the two.
      const tanV = Math.tan((FOV / 2) * Math.PI / 180)
      const aspect = window.innerWidth / window.innerHeight
      const d = Math.max((fitH / 2) / tanV, (wide / 2) / (tanV * aspect)) * 1.12 + bulge
      cam.setAttribute('position', `0 ${fitY.toFixed(4)} ${d.toFixed(4)}`)
    }

    // Feather is authored in label-width units; the shader works in UV, so
    // horizontals divide by the panel's width and verticals by its height.
    const fUV = [
      feather.top / vh, feather.right / place.w,
      feather.bottom / vh, feather.left / place.w,
    ].map(v => Math.min(0.499, Math.max(0, v)))

    front.setAttribute('material', [
      'shader: label-video',
      'src: #avatar',
      'transparent: true',
      `cropOffset: ${crop.x} ${crop.y}`,
      `cropScale: ${crop.w} ${crop.h}`,
      `featherUV: ${fUV.join(' ')}`,
      `gain: ${gain.join(' ')}`,
      `unwarp: ${unwarp.toFixed(6)}`,
    ].join('; '))
  }

  // Re-push only the gain uniform. The matcher runs several times a second, and
  // going through setAttribute('material', ...) each time would re-parse the whole
  // material and thrash the shader.
  function pushGain () {
    const mesh = front.getObject3D('mesh')
    const u = mesh && mesh.material && mesh.material.uniforms
    if (u && u.gain) u.gain.value.set(gain[0], gain[1], gain[2])
  }

  // --- character switching --------------------------------------------------

  async function setCharacter (id) {
    if (id === charId || !CHARACTERS[id] || !CHARACTERS[id].video) return
    const was = charId
    charId = id
    stopMatching()
    gain = [1, 1, 1]                      // previous character's exposure is meaningless

    // Hide the panel across the swap. Assigning .src drops readyState to 0, and a
    // render in that window tries to upload a zero-sized video texture — a
    // transient GL_INVALID_VALUE and a visible flash. Hiding it lets the physical
    // label show through for the ~200ms instead, which reads better anyway.
    front.object3D.visible = false
    const ok = await loadClip(id)
    front.object3D.visible = true
    if (!ok) { charId = was; return }

    readCharacter(id, false)
    applyVideo()                          // panel height follows the new clip's aspect
    pushGain()
    if (locked || preview) {
      video.play().catch(() => {})
      if (!preview) startMatching()
    }
    markCast()
    // Keep the URL honest so a reload or a share reproduces what is on screen.
    const u = new URL(location.href)
    if (id === wantedLabel) u.searchParams.delete('as')
    else u.searchParams.set('as', id)
    history.replaceState(null, '', u)
  }

  function buildCast () {
    const ids = Object.keys(CHARACTERS).filter(id => CHARACTERS[id].castVisible !== false)
    const host = $('cast-list')
    ids.forEach(id => {
      const c = CHARACTERS[id]
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'cast-item'
      b.dataset.char = id
      b.disabled = !c.video
      b.innerHTML = '<b></b><span></span>'
      b.firstChild.textContent = c.name
      b.lastChild.textContent = c.video ? (LABELS[id]?.variant || '') : 'no clip yet'
      b.addEventListener('click', () => { setCharacter(id); closeCast() })
      host.appendChild(b)
    })
    markCast()
    $('cast-btn').hidden = false
    $('cast-btn').addEventListener('click', () =>
      $('cast').hidden ? openCast() : closeCast())
    $('cast-close').addEventListener('click', closeCast)
  }

  function markCast () {
    document.querySelectorAll('.cast-item').forEach(el =>
      el.classList.toggle('on', el.dataset.char === charId))
    $('cast-btn').textContent = CHARACTERS[charId].name
  }

  function openCast  () { $('cast').hidden = false }
  function closeCast () { $('cast').hidden = true }

  // --- exposure matching ----------------------------------------------------
  //
  // Sample the camera feed where the target actually is, sample the clip's cropped
  // region, and scale the clip so the two agree. Valid here precisely because the
  // video content *is* the label content, so it is a like-for-like comparison.

  const MATCH = { ...DEFAULT_MATCH, ...(label.match || {}) }
  for (const k of ['color', 'min', 'max', 'smoothing', 'intervalMs', 'sampleFrac']) {
    MATCH[k] = num(k === 'color' ? 'mcolor' : 'm' + k.toLowerCase(), MATCH[k])
  }
  const fixedGain = parseFloat(q.get('gain'))
  if (Number.isFinite(fixedGain)) gain = [fixedGain, fixedGain, fixedGain]
  const matchOn = MATCH.enabled && q.get('match') !== '0' && !Number.isFinite(fixedGain)

  const sampler = (() => {
    const mk = () => {
      const c = document.createElement('canvas')
      c.width = c.height = 24
      return { c, x: c.getContext('2d', { willReadFrequently: true }) }
    }
    const camBuf = mk(), vidBuf = mk()

    const meanRGB = ({ c, x }) => {
      const d = x.getImageData(0, 0, c.width, c.height).data
      let r = 0, g = 0, b = 0
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
      const n = d.length / 4
      return [r / n, g / n, b / n]
    }

    // MindAR stores its camera element on the system and appends it at z-index -2.
    // Fall back to any <video> that isn't ours, in case that internal name changes.
    const camVideo = () => {
      const sys = scene.systems && scene.systems['mindar-image-system']
      if (sys && sys.video) return sys.video
      return [...document.querySelectorAll('video')].find(v => v !== video) || null
    }

    // Where the anchor's centre lands in the camera frame's own pixel space.
    // Going via getBoundingClientRect() means MindAR's cover-fit sizing and
    // negative offsets are accounted for without reproducing that maths.
    const targetInCamPixels = cv => {
      const rect = cv.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      const p = new THREE.Vector3()
      front.object3D.getWorldPosition(p)
      p.project(scene.camera)
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
      const u = ((p.x * 0.5 + 0.5) * window.innerWidth - rect.left) / rect.width
      const v = ((-p.y * 0.5 + 0.5) * window.innerHeight - rect.top) / rect.height
      if (u < 0 || u > 1 || v < 0 || v > 1) return null      // off-screen
      return { u, v }
    }

    return () => {
      const cv = camVideo()
      if (!cv || !cv.videoWidth || video.readyState < 2) return null
      const at = targetInCamPixels(cv) || { u: 0.5, v: 0.5 }
      const sw = Math.max(8, cv.videoWidth * 0.18 * MATCH.sampleFrac)
      const sx = Math.min(cv.videoWidth - sw, Math.max(0, at.u * cv.videoWidth - sw / 2))
      const sy = Math.min(cv.videoHeight - sw, Math.max(0, at.v * cv.videoHeight - sw / 2))
      try {
        camBuf.x.drawImage(cv, sx, sy, sw, sw, 0, 0, 24, 24)
        const cwPx = crop.w * video.videoWidth
        const chPx = crop.h * video.videoHeight
        const vw2 = cwPx * MATCH.sampleFrac, vh2 = chPx * MATCH.sampleFrac
        vidBuf.x.drawImage(video,
          crop.x * video.videoWidth + (cwPx - vw2) / 2,
          crop.y * video.videoHeight + (chPx - vh2) / 2,
          vw2, vh2, 0, 0, 24, 24)
      } catch {
        return null            // decode not ready, or a tainted frame
      }
      return { cam: meanRGB(camBuf), vid: meanRGB(vidBuf) }
    }
  })()

  // Exposed so it can be exercised without a camera; see the verification notes.
  function gainFrom (cam, vid) {
    const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    const lv = lum(vid)
    if (lv < 4) return null                    // clip too dark to divide by
    const lRatio = lum(cam) / lv
    return [0, 1, 2].map(i => {
      const perCh = vid[i] > 4 ? cam[i] / vid[i] : lRatio
      const mixed = lRatio + (perCh - lRatio) * MATCH.color
      return Math.min(MATCH.max, Math.max(MATCH.min, mixed))
    })
  }
  window.__gainFrom = gainFrom
  window.__setCharacter = setCharacter      // for headless swap tests
  window.__state = () => ({ charId, crop, place, croppedAspect, gain, curve })

  function startMatching () {
    if (!matchOn || matchTimer) return
    matchTimer = setInterval(() => {
      const s = sampler()
      if (!s) return
      const g = gainFrom(s.cam, s.vid)
      if (!g) return
      for (let i = 0; i < 3; i++) gain[i] += (g[i] - gain[i]) * MATCH.smoothing
      pushGain()
      if (onGain) onGain()
    }, MATCH.intervalMs)
  }
  function stopMatching () {
    if (matchTimer) { clearInterval(matchTimer); matchTimer = null }
  }

  // --- tracking events ------------------------------------------------------

  function wireTracking () {
    anchor.addEventListener('targetFound', () => {
      locked = true
      $('scan').hidden = true
      video.play().catch(e => console.warn('play blocked:', e.message))
      startMatching()
    })
    anchor.addEventListener('targetLost', () => {
      locked = false
      $('scan').hidden = false
      // Pause rather than stop, so turning the bottle away and back resumes the
      // line instead of losing it.
      video.pause()
      // Hold the last gain: sampling with no target would read whatever the camera
      // happens to be pointed at and yank the exposure before the next lock.
      stopMatching()
    })
    scene.addEventListener('arReady', () => { if (!locked) $('scan').hidden = false })
    scene.addEventListener('arError', () => {
      fatal('Camera unavailable. Check that the browser has camera permission and that no other app is using it.')
    })
    // Never leave audio running — or keep sampling — in a backgrounded tab.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { video.pause(); stopMatching() }
      else if (locked) { video.play().catch(() => {}); startMatching() }
    })
  }

  // --- alignment panel ------------------------------------------------------

  function buildTuner () {
    const rows = [
      ['x',        () => place.x,        v => place.x = v,        0.01],
      ['y',        () => place.y,        v => place.y = v,        0.01],
      ['width',    () => place.w,        v => place.w = v,        0.01],
      ['crop x',   () => crop.x,         v => crop.x = v,         0.005],
      ['crop w',   () => crop.w,         v => crop.w = v,         0.005],
      ['fade top', () => feather.top,    v => feather.top = v,    0.005],
      // Left and right are ganged: asymmetric side fades are almost never wanted,
      // and panel space on a phone is scarce. ?fl= / ?fr= still split them.
      ['fade side', () => feather.left,
        v => { feather.left = v; feather.right = v },              0.005],
      ['fade btm', () => feather.bottom, v => feather.bottom = v, 0.005],
      ['curve°', () => curve,       v => curve = v,          2],
    ]
    const host = $('tune-rows')
    rows.forEach(([labelText, get, set, step]) => {
      const row = document.createElement('div')
      row.className = 'tune-row'
      row.innerHTML = '<label></label><button type="button">−</button>' +
                      '<output></output><button type="button">+</button>'
      row.querySelector('label').textContent = labelText
      const out = row.querySelector('output')
      const draw = () => { out.textContent = get().toFixed(4) }
      const [minus, plus] = row.querySelectorAll('button')
      const bump = d => { set(+(get() + d * step).toFixed(4)); draw(); applyVideo() }
      minus.addEventListener('click', () => bump(-1))
      plus.addEventListener('click', () => bump(+1))
      draw()
      host.appendChild(row)
    })

    // Live gain readout. Without this there is no way to tell whether the matcher
    // is working, stuck, or pinned against a clamp.
    if (!preview) {
      const row = document.createElement('div')
      row.className = 'tune-row'
      row.innerHTML = '<label>gain</label><output class="wide"></output>'
      const out = row.querySelector('output')
      const draw = () => {
        out.textContent = gain.map(v => v.toFixed(2)).join(' ') + (matchOn ? '' : ' (off)')
      }
      draw()
      onGain = draw
      host.appendChild(row)
    }

    $('tune').hidden = false
    $('tune').addEventListener('click', e => {
      const act = e.target.dataset.act
      if (act === 'hide') $('tune').hidden = true
      if (act === 'copy') {
        const r = n => +n.toFixed(4)
        const sym = feather.left === feather.right
        const fStr = sym
          ? `{ top: ${r(feather.top)}, side: ${r(feather.left)}, bottom: ${r(feather.bottom)} }`
          : `{ top: ${r(feather.top)}, right: ${r(feather.right)}, ` +
            `bottom: ${r(feather.bottom)}, left: ${r(feather.left)} }`
        const snippet =
`  ${charId}: {
    name: '${CHARACTERS[charId].name}',
    video: {
      file: '${CHARACTERS[charId].video.file}',
      crop:  { x: ${r(crop.x)}, y: ${r(crop.y)}, w: ${r(crop.w)}, h: ${r(crop.h)} },
      place: { x: ${r(place.x)}, y: ${r(place.y)}, w: ${r(place.w)} },
    },
  },
// label geometry (shared): feather: ${fStr}, curve: ${r(curve)}`
        const out = $('tune-out')
        out.textContent = snippet
        out.hidden = false
        navigator.clipboard?.writeText(snippet).catch(() => {})
      }
    })
  }

  // Everything above is declarations. Kick off only here, at the end of the
  // function body: calling earlier reaches const/let bindings further down the
  // file that are still in their temporal dead zone — which is exactly how
  // buildCast() ended up crashing on closeCast.
  if (!preview) wireTracking()
  else {
    $('scan').hidden = true
    video.muted = true          // no gesture behind an auto-started preview
    video.play().catch(() => {})
  }
  buildCast()
  if (q.get('tune')) buildTuner()
}

boot()
