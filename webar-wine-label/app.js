import { WINES, DEFAULT_TRACKING } from './wines.js'

const $ = id => document.getElementById(id)
const q = new URLSearchParams(location.search)
const num = (k, fallback) => {
  const v = parseFloat(q.get(k))
  return Number.isFinite(v) ? v : fallback
}

// ---------------------------------------------------------------------------
// Video shader: UV crop, per-edge feather, exposure/white-balance gain
//
// crop      — generators pillarbox their output; cropping here means a new clip
//             never has to be re-encoded to be usable.
// featherUV — fade widths per edge, in UV, ordered top/right/bottom/left. The
//             edges are not equivalent: the top boundary lands on the printed
//             torn-paper edge and wants to stay crisp, while the sides and bottom
//             cut across flat dark tone and want to dissolve.
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
    varying vec2 vUv;

    // Distance-to-edge ramp; a width of 0 disables that edge entirely.
    float edge(float d, float w) {
      return w > 0.0 ? smoothstep(0.0, w, d) : 1.0;
    }

    void main() {
      vec4 c = texture2D(src, cropOffset + vUv * cropScale);
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
// Only z is displaced, never x. The texture is a photograph of the curved label,
// so its horizontal axis is already the *projected* position R·sin(theta) — which
// is exactly the flat mesh's x. Bending x as well would apply the foreshortening
// twice and squeeze the middle of the face.
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
      const R = (data.width / 2) / sinT          // chord half-width = R·sin(t)
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
    // Chord wider than the bottle is impossible; the data is wrong, and guessing
    // an angle would hide that. Stay flat and say so.
    console.warn(`chordMm ${chordMm} exceeds bottle diameter ${diameterMm}; curve disabled`)
    return 0
  }
  // s == 1 is a label wrapping exactly to the silhouette — real, and 90° is the
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

// ---------------------------------------------------------------------------
// Wine selection
// ---------------------------------------------------------------------------

const ids = Object.keys(WINES)
const wantedId = q.get('wine')
const wine = wantedId ? WINES[wantedId] : null

if (!wine) {
  showPicker(wantedId ? `No wine called “${wantedId}”.` : null)
} else if (q.get('preview') === '1') {
  start(wine)          // no camera, muted video: nothing needs a user gesture
} else {
  showGate(wine)
}

function showPicker (hint) {
  const list = $('picker-list')
  if (!ids.length) {
    fatal('No wines are configured. Add an entry to wines.js.')
    return
  }
  ids.forEach(id => {
    const w = WINES[id]
    const a = document.createElement('a')
    a.className = 'wine'
    a.href = '?wine=' + encodeURIComponent(id) + (q.get('tune') ? '&tune=1' : '')
    a.innerHTML = `<b></b><span></span>`
    a.firstChild.textContent = w.name
    a.lastChild.textContent = w.variant || id
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

function showGate (w) {
  const el = $('gate-label')
  el.textContent = w.name
  if (w.variant) {
    const s = document.createElement('span')
    s.textContent = w.variant
    el.appendChild(s)
  }
  $('gate').hidden = false
  $('gate-btn').addEventListener('click', () => start(w), { once: true })
}

async function start (w) {
  $('gate').hidden = true

  const dir = w.dir || `assets/${wantedId}`
  const video = document.createElement('video')
  video.src = `./${dir}/${w.video.file}`
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.preload = 'auto'
  video.loop = w.video.loop !== false
  video.crossOrigin = 'anonymous'

  // Unlock: a play() call inside the gesture marks the element as user-activated,
  // so later programmatic play() on targetFound is allowed to carry audio.
  try {
    await video.play()
    video.pause()
    video.currentTime = 0
  } catch (e) {
    // Not fatal — playback may still work, it just might arrive muted.
    console.warn('audio unlock failed:', e.message)
  }

  try {
    await once(video, 'loadedmetadata', 12000)
  } catch {
    fatal(`Couldn't load ${w.video.file}. Check that assets/${wantedId}/ is complete.`)
    return
  }

  buildScene(w, dir, video)
}

function once (el, ev, ms) {
  return new Promise((res, rej) => {
    if (el.readyState >= 1) return res()
    const t = setTimeout(() => rej(new Error('timeout')), ms)
    el.addEventListener(ev, () => { clearTimeout(t); res() }, { once: true })
    el.addEventListener('error', () => { clearTimeout(t); rej(new Error('error')) }, { once: true })
  })
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function buildScene (w, dir, video) {
  // MindAR normalises a target to 1 unit wide, so the label plane's height is
  // just the compiled image's aspect. Everything below is in those units.
  const labelH = w.target.h / w.target.w

  const crop = {
    x: num('cx', w.video.crop?.x ?? 0),
    y: num('cy', w.video.crop?.y ?? 0),
    w: num('cw', w.video.crop?.w ?? 1),
    h: num('ch', w.video.crop?.h ?? 1),
  }
  const place = {
    x: num('vx', w.video.place?.x ?? 0),
    y: num('vy', w.video.place?.y ?? 0),
    w: num('vw', w.video.place?.w ?? 1),
  }
  const f0 = normaliseFeather(w.video.feather)
  const feather = {
    top:    num('ft', num('feather', f0.top)),
    right:  num('fr', num('feather', f0.right)),
    bottom: num('fb', num('feather', f0.bottom)),
    left:   num('fl', num('feather', f0.left)),
  }

  // Explicit `curve` wins; otherwise derive it from the bottle's real geometry.
  let curve = num('curve',
    w.curve ?? curveFromBottle(w.target.chordMm, w.bottle?.diameterMm))

  // Live exposure / white-balance match against the camera feed.
  // ?gain=N pins a fixed gain and disables the loop; ?match=0 turns it off entirely.
  const MATCH = {
    enabled:    true,
    color:      0.6,      // 0 = luminance only, 1 = full per-channel white balance
    min:        0.55,
    max:        1.8,
    smoothing:  0.12,
    intervalMs: 120,
    sampleFrac: 0.55,
    ...(w.match || {}),
  }
  for (const k of ['color', 'min', 'max', 'smoothing', 'intervalMs', 'sampleFrac']) {
    MATCH[k] = num(k === 'color' ? 'mcolor' : 'm' + k.toLowerCase(), MATCH[k])
  }
  const fixedGain = parseFloat(q.get('gain'))
  const gain = Number.isFinite(fixedGain)
    ? [fixedGain, fixedGain, fixedGain]
    : [1, 1, 1]
  const matchOn = MATCH.enabled && q.get('match') !== '0' && !Number.isFinite(fixedGain)

  // Derive the video plane's height from the cropped frame so it is never
  // stretched. Depends on the real decoded size, hence the metadata wait.
  const croppedAspect = (crop.w * video.videoWidth) / (crop.h * video.videoHeight)

  const track = { ...DEFAULT_TRACKING, ...(w.tracking || {}) }
  for (const k of Object.keys(track)) track[k] = num(k, track[k])

  // Preview mode (?preview=1) renders the same two planes head-on with no camera
  // and no tracking, so alignment can be dialled in at a desk without a bottle.
  // Same geometry and same shader as the live path — only the pose differs.
  const preview = q.get('preview') === '1'

  const scene = document.createElement('a-scene')
  if (!preview) {
    scene.setAttribute('mindar-image', [
      `imageTargetSrc: ./${dir}/targets.mind`,
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
  video.id = 'avatar'
  assets.appendChild(video)
  if (w.still) {
    const img = document.createElement('img')
    img.id = 'still'
    img.src = `./${dir}/${w.still}`
    img.crossOrigin = 'anonymous'
    assets.appendChild(img)
  }
  scene.appendChild(assets)

  const FOV = 80
  const cam = document.createElement('a-camera')
  cam.setAttribute('position', '0 0 0')
  cam.setAttribute('fov', FOV)
  cam.setAttribute('look-controls', 'enabled: false')
  cam.setAttribute('wasd-controls', 'enabled: false')
  scene.appendChild(cam)

  const anchor = document.createElement('a-entity')
  if (!preview) anchor.setAttribute('mindar-image-target', 'targetIndex: 0')

  // Optional back panel: a digital copy of the whole label. Off by default — the
  // physical label is already there, perfectly registered and perfectly lit, and
  // covering it with a photo of itself is strictly worse than leaving it alone.
  // Turn it on only if the video's edge won't sit quietly against the real label.
  let back = null
  if (w.still) {
    back = panel(1, labelH, curve)
    back.setAttribute('material', 'shader: flat; src: #still; transparent: false')
    anchor.appendChild(back)
  }

  let front = panel(1, 1, curve)
  front.id = 'video-plane'
  anchor.appendChild(front)
  applyVideo()

  scene.appendChild(anchor)
  document.body.appendChild(scene)

  function applyVideo () {
    const vh = place.w / croppedAspect
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
      // A curved panel's centre sits this far toward the camera, so it has to be
      // added to the fit distance or the bulge magnifies past the viewport.
      const t = curve * Math.PI / 180
      const bulge = t > 0.001
        ? ((wide / 2) / Math.sin(t)) * (1 - Math.cos(t))
        : 0
      // FOV is vertical, so on a portrait phone the horizontal field is much
      // narrower and is usually the binding constraint. Fit both, take the
      // further of the two.
      const tanV = Math.tan((FOV / 2) * Math.PI / 180)
      const aspect = window.innerWidth / window.innerHeight
      const dH = (fitH / 2) / tanV
      const dW = (wide / 2) / (tanV * aspect)
      const d = Math.max(dH, dW) * 1.12 + bulge
      cam.setAttribute('position', `0 ${fitY.toFixed(4)} ${d.toFixed(4)}`)
    }
    // Feather is authored in label-width units; the shader works in UV, so
    // horizontals divide by the panel's width and verticals by its height.
    const fUV = [
      feather.top / vh,
      feather.right / place.w,
      feather.bottom / vh,
      feather.left / place.w,
    ].map(v => Math.min(0.499, Math.max(0, v)))

    front.setAttribute('material', [
      'shader: label-video',
      'src: #avatar',
      'transparent: true',
      `cropOffset: ${crop.x} ${crop.y}`,
      `cropScale: ${crop.w} ${crop.h}`,
      `featherUV: ${fUV.join(' ')}`,
      `gain: ${gain.join(' ')}`,
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

  // --- tracking events -----------------------------------------------------

  if (preview) {
    $('scan').hidden = true
    video.muted = true          // no gesture behind an auto-started preview
    video.play().catch(() => {})
    if (q.get('tune')) buildTuner()
    return
  }

  // --- exposure matching ---------------------------------------------------
  //
  // Sample the camera feed where the target actually is, sample the clip's cropped
  // region, and scale the clip so the two agree. Valid here precisely because the
  // video content *is* the label content, so it is a like-for-like comparison.

  const sampler = (() => {
    const mk = () => {
      const c = document.createElement('canvas')
      c.width = c.height = 24
      return { c, x: c.getContext('2d', { willReadFrequently: true }) }
    }
    const camBuf = mk()
    const vidBuf = mk()

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
      const sx = (p.x * 0.5 + 0.5) * window.innerWidth
      const sy = (-p.y * 0.5 + 0.5) * window.innerHeight
      const u = (sx - rect.left) / rect.width
      const v = (sy - rect.top) / rect.height
      if (u < 0 || u > 1 || v < 0 || v > 1) return null      // off-screen
      return { u, v }
    }

    return () => {
      const cv = camVideo()
      if (!cv || !cv.videoWidth || video.readyState < 2) return null

      const at = targetInCamPixels(cv) || { u: 0.5, v: 0.5 }
      // Window scaled to the panel, clamped so it can't run off the frame.
      const sw = Math.max(8, cv.videoWidth * 0.18 * MATCH.sampleFrac)
      const sh = sw
      const sx = Math.min(cv.videoWidth - sw, Math.max(0, at.u * cv.videoWidth - sw / 2))
      const sy = Math.min(cv.videoHeight - sh, Math.max(0, at.v * cv.videoHeight - sh / 2))

      try {
        camBuf.x.drawImage(cv, sx, sy, sw, sh, 0, 0, 24, 24)
        // Matching region of the clip: the centre of the cropped rectangle.
        const cwPx = crop.w * video.videoWidth
        const chPx = crop.h * video.videoHeight
        const vw2 = cwPx * MATCH.sampleFrac
        const vh2 = chPx * MATCH.sampleFrac
        vidBuf.x.drawImage(
          video,
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

  let matchTimer = null
  const startMatching = () => {
    if (!matchOn || matchTimer) return
    matchTimer = setInterval(() => {
      const s = sampler()
      if (!s) return
      const g = gainFrom(s.cam, s.vid)
      if (!g) return
      const k = MATCH.smoothing
      for (let i = 0; i < 3; i++) gain[i] += (g[i] - gain[i]) * k
      pushGain()
      if (onGain) onGain()
    }, MATCH.intervalMs)
  }
  const stopMatching = () => {
    if (matchTimer) { clearInterval(matchTimer); matchTimer = null }
  }
  let onGain = null

  let locked = false
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

  if (q.get('tune')) buildTuner()

  // --- alignment panel -----------------------------------------------------

  function buildTuner () {
    const rows = [
      ['x',        () => place.x,        v => place.x = v,        0.01],
      ['y',        () => place.y,        v => place.y = v,        0.01],
      ['width',    () => place.w,        v => place.w = v,        0.01],
      ['crop x',   () => crop.x,         v => crop.x = v,         0.005],
      ['crop w',   () => crop.w,         v => crop.w = v,         0.005],
      // Left and right are ganged: asymmetric side fades are almost never wanted,
      // and panel space on a phone is scarce. ?fl= / ?fr= still split them.
      ['fade top', () => feather.top,    v => feather.top = v,    0.005],
      ['fade side', () => feather.left,
        v => { feather.left = v; feather.right = v },              0.005],
      ['fade btm', () => feather.bottom, v => feather.bottom = v, 0.005],
      ['curve°',   () => curve,          v => curve = v,          2],
    ]
    const host = $('tune-rows')
    rows.forEach(([label, get, set, step]) => {
      const row = document.createElement('div')
      row.className = 'tune-row'
      row.innerHTML = `<label></label><button type="button">−</button>
                       <output></output><button type="button">+</button>`
      row.querySelector('label').textContent = label
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
        out.textContent = matchOn
          ? gain.map(v => v.toFixed(2)).join(' ')
          : gain.map(v => v.toFixed(2)).join(' ') + ' (off)'
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
`    curve: ${r(curve)},
    video: {
      file: '${w.video.file}',
      crop: { x: ${r(crop.x)}, y: ${r(crop.y)}, w: ${r(crop.w)}, h: ${r(crop.h)} },
      place: { x: ${r(place.x)}, y: ${r(place.y)}, w: ${r(place.w)} },
      feather: ${fStr},
    },`
        const out = $('tune-out')
        out.textContent = snippet
        out.hidden = false
        navigator.clipboard?.writeText(snippet).catch(() => {})
      }
    })
  }
}
