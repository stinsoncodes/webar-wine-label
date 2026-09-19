# Talking Wine Label

WebAR: scan a QR code on a bottle, point the camera at the label, the character on
the label talks. One app, many wines.

Deployed from this directory (Vercel Root Directory = `webar-wine-label`).

---

## Labels and characters are separate things

Two tables in `wines.js`:

| | |
|---|---|
| `LABELS` | what can be **tracked** — one per physical label design |
| `CHARACTERS` | what can be **played** — one per person |

```
?wine=jacqui             her bottle, her character   <- what a QR code encodes
?wine=jacqui&as=loren    her bottle, Loren talking   <- what the cast selector does
```

`wine` picks the tracking target; `as` picks the clip, defaulting to the label's own
person. The selector only ever rewrites `as`, so the target is untouched and the lock
survives the switch.

`crop` and `place` belong to the **video**, expressed in label coordinates. They do not
have to match across characters — each clip just has to say where it sits on the label.
That is what makes any character valid on any bottle.

**This only works because the label template is pixel-identical across all 13
slides** — torn edge, crest, wordmark and copy at the same coordinates, with only the
portrait differing (verified from the PPTX shape geometry). If a future template shifts
per person, every label x character pair needs its own alignment: 169 passes, not 13.

The QR already identifies the label, so the app never has to work out by sight which
bottle it is looking at. That is why each label gets its own single-target `.mind`
rather than all of them compiled into one: detection stays fast, the download stays
~700 KB instead of ~9 MB, and a new label cannot regress the existing ones.

**Never consolidate the personalised targets into one multi-target file.** Their cream upper
half is byte-identical, so roughly half of every target's features are shared with the
other twelve. Harmless as separate files, since only one is ever loaded — but combined,
they would cross-match constantly.

With no `?wine=`, or an unknown id, the app shows a picker listing every label.

## Watch mode — for people who don't have a bottle

```
?wine=loren&watch=1      Loren's label on screen, tap to play, sound on, no camera
```

Same label, same cast selector, same audio; the camera and the tracker are simply
not involved. The label is drawn as a curved panel — `label-display.jpg`, the same
pre-warp as the tracking target at twice the width, because the 500px target
upscales about 1.8x filling a phone and reads soft.

The picker carries an **"I have the bottle" / "No bottle"** switch that rewrites
its thirteen links to add `&watch=1`, and watch mode itself shows a Share button
that hands the current URL — `as=` included — to the native share sheet. So a link
sends what was actually on screen.

Three things this deliberately does NOT do:

- **It is never a default.** A printed QR encodes a bare `?wine=`; whoever scans it
  is holding the bottle and wants the AR. Watch mode only ever arrives by explicit
  `&watch=1`.
- **It does not restrict the cast.** A watch link is per-person in the sense that it
  shows that person's label, not in the sense of hiding the others — the recipient
  can play all thirteen, exactly as a bottle holder can. That is a deliberate
  choice: anyone holding a watch link can watch everyone. `castVisible: false`
  exists in `wines.js` for anyone who would rather not appear.

### In watch mode the backdrop follows the character

Switch character in watch mode and the label behind it changes too, and the URL
becomes a plain `?wine=<whoever is talking>&watch=1` with no `as=`.

This is not cosmetic. **The video does not cover the whole label.** The panel spans
0.9%..93.3% of the width — the face crop deliberately stops short of the vertical
REG. No. text so a generator could never garble somebody's name — and the side
feather blends over another 8% of that, so the label's own portrait shows through
the rightmost ~15%. When the clip and the label are the same person, that is
invisible: the clip was generated from that very crop of that very label, which is
the whole reason for cutting it from the label in the first place. When they are
not, you get Jacqui's hair beside Seth's face.

In AR this is left alone, because there the bottle in your hand is the truth and a
foreign face on your own label is the point of the selector. Watch mode has no
bottle, so the honest backdrop is the label of whoever is talking.

`?preview=1` deliberately keeps the selected label when you switch characters — it
is the alignment tool, and comparing a clip against a chosen label is what it is
for.
- **It is not `?preview=1`.** Preview is the alignment tool: no gate, muted,
  tracking-resolution still. Wrong for watching on all three counts.

Everything that exists only because of tracking keys off `noAR` in `app.js` —
MindAR, the target anchor, the scan prompt, the exposure matcher. Only the muting
keys off `preview` alone.

Because there is no camera, the view is framed by moving our own camera back far
enough to fit the label, which depends on the viewport aspect — so it re-fits on
resize and orientationchange. Without that, a rotated phone or a narrow desktop
window crops the label.

## Asset layout

```
assets/labels/<label-id>/targets.mind        compiled tracking target
assets/labels/<label-id>/label.jpg           tracking-resolution still, for ?still=1
assets/labels/<label-id>/label-display.jpg   display-resolution still, for ?watch=1
assets/characters/<char-id>/<file>.mp4       the talking clip
```

The two stills are the same warp at different sizes: `warp-targets.py` writes the
500px one into `source/targets/` for compiling, and `--display` writes the 1000px
one straight into `assets/labels/`. They must stay geometrically identical or the
video panel would no longer line up with the label behind it.

---

## Adding a label

For a label that exists as PowerPoint artwork (the personalised set):

1. **Export the slides** from PowerPoint: File > Export > PNG, *Save Every Slide*,
   width 1500. AppleScript cannot do this — its PNG export is a no-op and the app is
   sandboxed out of temp directories. PDF export works but nothing on macOS ships a
   PDF rasteriser.

2. **Build masters and HeyGen inputs**, from the repo root:

   ```bash
   python3 tools/prepare-labels.py "<folder of SlideN.png>"
   python3 tools/verify-names.py                 # then LOOK at names.png
   ```

   `verify-names.py` tiles the per-person name strip from all 13 into one sheet.
   Do not skip it: nine labels once carried a duplicated name, and that text falls
   inside the HeyGen crop, so it would have been baked into nine paid videos.

3. **Pre-warp and compile the targets:**

   ```bash
   python3 tools/warp-targets.py --test          # verify the projection
   python3 tools/warp-targets.py                 # -> source/targets/
   python3 tools/compile-server.py <workspace>   # then open compile.html
   ```

   `tools/compile.html` compiles every id to its **own** `.mind` and reports feature
   counts. Want **>1500 matching points** with keypoints spread across the label;
   sparse or corner-clustered tracks badly and no runtime tuning fixes it.

4. **Place the assets:**

   ```
   assets/labels/<id>/targets.mind
   assets/characters/<id>/<file>.mp4
   ```

5. **Add entries to `wines.js`** — one in `LABELS`, one in `CHARACTERS`. The personalised
   labels share `SHARED_LABEL`, so a new one is a single spread. The values you must
   get right by hand are `target: { w, h }` (pixel size of the compiled image — a
   wrong ratio stretches everything) and `target.chordMm` (how wide that region reads
   straight across the bottle; `warp-targets.py` prints it).

6. **Align the video** (below), then **point a QR code** at `?wine=<id>`. Ids are
   baked into printed labels — pick one you can live with and never change it.

No changes to `app.js` at any point.

For a label that only exists physically, photograph it on the bottle straight on, crop
tight (background in the target gets learned and then isn't there at runtime), and skip
step 3's pre-warp — a photo already carries the cylindrical projection.

---

## Aligning a video

**The 13 personalised clips are already aligned and share one `SHARED_CLIP`.** That is
a property of the pipeline, not luck: each was generated from
`source/heygen/face/<id>.png`, which `tools/prepare-labels.py` cuts at identical
fractions of every label, and the generator returned all 13 at 1920x1080 with the
portrait pillarboxed into the same 900px column (measured: white bars at columns
510..1410 in all 13). So a replacement clip made the same way needs no alignment at
all — spread `SHARED_CLIP` and it lands. A clip made any other way needs its own
`crop`/`place`, and that is what the rest of this section is for.

Generators reframe and pillarbox their output, so a new clip needs alignment. Two
modes, both live — no redeploy:

| URL | What it does |
|---|---|
| `?wine=<id>&preview=1&tune=1` | Head-on, no camera, no bottle. Do the rough pass here. |
| `?wine=<id>&tune=1` | Live AR on the bottle. Confirm here. |
| `?wine=<id>&watch=1&tune=1` | Head-on with the gate and sound, i.e. what a recipient sees. |

Nudge with the on-screen panel, then **Copy manifest** and paste the snippet into
`wines.js`. Every parameter is also settable directly in the URL — handy for jumping
straight to a value: `&vy=-0.566&cw=0.4585`.

| Param | Meaning |
|---|---|
| `vx` `vy` `vw` | Video plane position and width, in label-width units, origin at label centre |
| `cx` `cy` `cw` `ch` | Crop rectangle within the video frame, 0..1 |
| `ft` `fr` `fb` `fl` | Edge fade widths — top, right, bottom, left — in label-width units |
| `feather` | Sets all four at once |
| `curve` | Half-arc wrap in degrees; overrides the value derived from bottle geometry |
| `match` | `0` disables live exposure matching |
| `gain` | Pins a fixed gain and disables matching, e.g. `gain=1.25` |
| `mcolor` `mmin` `mmax` `msmoothing` | Matcher tuning |
| `filterMinCF` `filterBeta` `missTolerance` `warmupTolerance` | Tracker tuning |

The video plane's **height is always derived** from the cropped aspect, so the picture
can never be stretched. To make the plane taller, narrow the crop.

Two things to watch for, both learned the hard way on the first clip:

- **Doubled features.** If the video includes part of the label that is also in the
  static image behind it — the torn edge here — you will see it twice. Crop it out
  with `cy`/`ch` and let the static copy show.
- **Overhang.** `vw` above 1.0 pushes the video past the label's edge, where it reads
  as a dark band against the glass.

---

## Design notes

**No chroma key.** The PRD originally called for a green-screen clip and a chroma-key
shader. That became unnecessary once the video was generated from the label rather than
filmed — there is no background to remove. It also dodges the worst failure mode: H.264
stores colour at quarter resolution, so keyed edges fringe badly and no shader recovers
it.

**Video only, no back panel.** `LABELS[id].still` is `null` by default, so only the
video is drawn. A digital copy of the label was tried first, to keep the video's edge
blending against a texture we control rather than against the physical label under
unknown light. It looked worse than the seam it was avoiding — a flat photo pasted over
a correctly-lit, correctly-curved real label. Set `still: 'label.jpg'` per label to
bring it back if a clip's edge will not sit quietly.

**Version pinning.** `mind-ar` 1.2.5 against A-Frame 1.3.0, pinned exactly in
`index.html`. An unpinned "latest" A-Frame silently produces a blank scene.

Also note `mindar-image.prod.js` (used by the compiler) is an **ES module** and must be
`import`ed; the `-aframe` build used here is a classic script. Mixing them up costs an
hour.

**Audio, and why there is exactly one `<video>` element.** Mobile browsers block
audio-enabled playback that is not the direct result of a user gesture. The tap gate
fires `play()` inside the tap to mark the element user-activated, and playback on
`targetFound` is then allowed to carry sound. The scene is not attached until that tap
either, which puts the camera prompt behind a deliberate action rather than a page load.

That activation lives on the **element**, not the page, so the cast selector reassigns
`.src` on the same element rather than creating a new one. Create a fresh element per
switch and every character after the first is silent.

Two related traps, both of which bit during development:

- The clip must be preloaded *while the gate is displayed*. iOS drops the gesture if you
  `await` anything before calling `play()`, and calling `play()` on an element with no
  `src` never settles at all — the app just hangs, with nothing in the console.
- Reassigning `.src` drops `readyState` to 0, and rendering in that window uploads a
  zero-sized video texture: a transient `GL_INVALID_VALUE` and a visible flash. The
  panel is hidden across the swap, so the physical label shows through instead.

**Per-edge fading, not one number.** The four edges of the video panel are not
equivalent. The top lands on the printed torn-paper edge — already an irregular,
high-contrast boundary, so fading it hard only blurs a join that reads fine crisp. The
sides and bottom cut across flat dark tone with nothing to hide behind and need to
dissolve. Hence `feather: { top, side, bottom }` rather than a single value.

**Exposure matching.** The clip carries whatever lighting it was rendered under; the
physical label sits under the user's. That mismatch at the boundary is the loudest
"this is a sticker" signal, louder than geometry. Every ~120 ms while locked, the app
samples the camera feed where the target is and the clip's cropped centre, and drives a
per-channel `gain` uniform toward the ratio, eased with an EMA.

Comparing the two directly is only valid because the video content *is* the label
content — the same portrait, so it is like-for-like. If a future clip diverges
substantially from what it covers, this assumption breaks and the gain will be wrong;
disable it with `match: { enabled: false }` on that wine.

The gain multiplies in gamma space rather than linear, so it approximates an exposure
change rather than reproducing one. Within the clamped range the difference is not
visible, and linearising both textures to fix it would buy nothing.

**Curve comes from measurements, not taste.** `target.chordMm` (how wide the compiled
region reads straight across the bottle front — a ruler laid flat, not a tape following
the curve) and `bottle.diameterMm` derive the half-arc angle exactly:
`asin((chord/2)/(diameter/2))`. Storing those two inputs rather than the resulting
angle means a new bottle shape is a data change, and nobody has to re-guess later.
A standard 750 ml Bordeaux is 76 mm.

**Never give `body` a background.** MindAR inserts its camera feed as a `<video>` at
`z-index: -2`. A background on the *root* element paints into the viewport canvas
first, underneath everything — but a background on `body` paints as an ordinary box,
which in CSS painting order comes *after* negative-z-index descendants. So an opaque
`body` background hides the camera and the AR renders over solid black while tracking
appears to work perfectly. Page colour lives on `html`; the full-screen overlays each
carry their own.

**Caching (`vercel.json`).** `/assets/*` gets `max-age=3600` — those files are large and
change rarely, and re-downloading a 700 KB `.mind` on every phone reload is painful.
Everything else is `no-store`, because code and manifest change constantly during
alignment and a cached copy silently invalidates a test.

Do not add explanatory keys to `vercel.json`. Its schema rejects any property it does
not recognise — a `"comment"` field inside a headers rule fails the build with
*"should NOT have additional property"*, and because a failed build keeps serving the
previous deployment, the symptom looks like the deploy simply not happening.

**Pre-warped targets.** Flat artwork makes a poor target: MindAR fits a homography, but
the camera sees a label wrapped round a bottle. `tools/warp-targets.py` applies the
cylindrical projection first, so the reference matches what the camera actually sees —
the same condition the original photographed target had baked in, minus the lighting,
noise and lens distortion. It displaces z only; x is already the projected
`R*sin(theta)`, and bending x too would apply the foreshortening twice.

`python3 tools/warp-targets.py --test` checks the projection without touching files:
analytic round trip, monotonicity, centre scale 1.0, and a pixel-grid round trip.

**Curvature at render time.** MindAR still solves the *pose* as a flat plane, so
registration drifts at extreme angles no matter what. The rendered surface, though, is
a partial cylinder (`curved-panel` geometry) matching the bottle — derived from
`target.chordMm` and `bottle.diameterMm`, not guessed.

---

## Tracking spike

`spike/` is the harness that established feasibility before any of this was built:
MindAR with a wireframe quad, no video, no shader. The 19 Crimes label scored **99.6%
locked** through handheld rotation on a phone. Keep it — it's the fastest way to tell
whether a *new* label is viable before investing in a video for it.
