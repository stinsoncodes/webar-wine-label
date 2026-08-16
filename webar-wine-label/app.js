import { WINES, DEFAULT_TRACKING } from './wines.js'

const $ = id => document.getElementById(id)
const q = new URLSearchParams(location.search)
const num = (k, fallback) => {
  const v = parseFloat(q.get(k))
  return Number.isFinite(v) ? v : fallback
}

// ---------------------------------------------------------------------------
// Video shader: UV crop + edge feather
//
// The crop exists because generators pillarbox their output; doing it here means
// a new clip never has to be re-encoded to be usable. The feather softens the
// plane's outer edge so a small misalignment against the static label reads as a
// soft transition instead of a hard rectangle.
// ---------------------------------------------------------------------------
AFRAME.registerShader('label-video', {
  // `is: 'uniform'` is not optional — without it A-Frame treats these as plain
  // component data, the material compiles with an empty uniform set, and the crop
  // and feather silently do nothing.
  schema: {
    src:        { type: 'map',  is: 'uniform' },
    cropOffset: { type: 'vec2', is: 'uniform', default: { x: 0, y: 0 } },
    cropScale:  { type: 'vec2', is: 'uniform', default: { x: 1, y: 1 } },
    featherUV:  { type: 'vec2', is: 'uniform', default: { x: 0, y: 0 } },
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
    uniform vec2 featherUV;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(src, cropOffset + vUv * cropScale);
      float ax = featherUV.x > 0.0
        ? smoothstep(0.0, featherUV.x, min(vUv.x, 1.0 - vUv.x)) : 1.0;
      float ay = featherUV.y > 0.0
        ? smoothstep(0.0, featherUV.y, min(vUv.y, 1.0 - vUv.y)) : 1.0;
      gl_FragColor = vec4(c.rgb, c.a * ax * ay);
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
  let feather = num('feather', w.video.feather ?? 0)
  let curve = num('curve', w.curve ?? 0)

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
    front.setAttribute('material', [
      'shader: label-video',
      'src: #avatar',
      'transparent: true',
      `cropOffset: ${crop.x} ${crop.y}`,
      `cropScale: ${crop.w} ${crop.h}`,
      // Feather is authored in label-width units; the shader works in UV.
      `featherUV: ${feather / place.w} ${feather / vh}`,
    ].join('; '))
  }

  // --- tracking events -----------------------------------------------------

  if (preview) {
    $('scan').hidden = true
    video.muted = true          // no gesture behind an auto-started preview
    video.play().catch(() => {})
    if (q.get('tune')) buildTuner()
    return
  }

  let locked = false
  anchor.addEventListener('targetFound', () => {
    locked = true
    $('scan').hidden = true
    video.play().catch(e => console.warn('play blocked:', e.message))
  })
  anchor.addEventListener('targetLost', () => {
    locked = false
    $('scan').hidden = false
    // Pause rather than stop, so turning the bottle away and back resumes the
    // line instead of losing it.
    video.pause()
  })

  scene.addEventListener('arReady', () => { if (!locked) $('scan').hidden = false })
  scene.addEventListener('arError', () => {
    fatal('Camera unavailable. Check that the browser has camera permission and that no other app is using it.')
  })

  // Never leave audio running in a backgrounded tab.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) video.pause()
    else if (locked) video.play().catch(() => {})
  })

  if (q.get('tune')) buildTuner()

  // --- alignment panel -----------------------------------------------------

  function buildTuner () {
    const rows = [
      ['vx',      'x',       () => place.x,  v => place.x = v,  0.01],
      ['vy',      'y',       () => place.y,  v => place.y = v,  0.01],
      ['vw',      'width',   () => place.w,  v => place.w = v,  0.01],
      ['cx',      'crop x',  () => crop.x,   v => crop.x = v,   0.005],
      ['cw',      'crop w',  () => crop.w,   v => crop.w = v,   0.005],
      ['feather', 'feather', () => feather,  v => feather = v,  0.005],
      ['curve',   'curve°',  () => curve,    v => curve = v,    2],
    ]
    const host = $('tune-rows')
    rows.forEach(([key, label, get, set, step]) => {
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

    $('tune').hidden = false
    $('tune').addEventListener('click', e => {
      const act = e.target.dataset.act
      if (act === 'hide') $('tune').hidden = true
      if (act === 'copy') {
        const snippet =
`    curve: ${curve},
    video: {
      file: '${w.video.file}',
      crop: { x: ${crop.x}, y: ${crop.y}, w: ${crop.w}, h: ${crop.h} },
      place: { x: ${place.x}, y: ${place.y}, w: ${place.w} },
      feather: ${feather},
    },`
        const out = $('tune-out')
        out.textContent = snippet
        out.hidden = false
        navigator.clipboard?.writeText(snippet).catch(() => {})
      }
    })
  }
}
