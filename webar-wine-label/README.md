# Talking Wine Label

WebAR: scan a QR code on a bottle, point the camera at the label, the character on
the label talks. One app, many wines.

Deployed from this directory (Vercel Root Directory = `webar-wine-label`).

---

## How a wine is selected

Each bottle's QR code encodes its own URL:

```
https://<app>/?wine=19-crimes-cabernet
```

The QR already identifies the wine, so the app never has to work it out by sight.
That's why each label gets its own single-target `.mind` file rather than all twelve
being compiled into one: detection stays fast, the download stays small (one combined
file would be ~8 MB), and adding label #13 cannot regress the other twelve.

With no `?wine=`, or an unknown id, the app shows a picker listing everything in
`wines.js`.

---

## Adding a wine

1. **Photograph the label** on the bottle, straight on, diffuse light, no flash.
   Crop tight to the label — background in the target gets learned as part of it and
   then isn't there at runtime.

2. **Compile the target.** From the repo root:

   ```bash
   python3 tools/compile-server.py
   ```

   Open `http://localhost:8765/tools/compile.html`, point `SOURCES` at your crop.
   It prints feature counts and draws the keypoint overlay. Want **>1500 matching
   points** and keypoints spread across the whole label; sparse or corner-clustered
   means it will track badly and no runtime tuning fixes that.

3. **Drop three files** into `assets/<id>/`:

   ```
   targets.mind    compiled target
   label.jpg       the same crop, drawn behind the video
   avatar.mp4      the talking clip
   ```

4. **Add an entry to `wines.js`.** Copy an existing one. The only value you must get
   right by hand is `target: { w, h }` — the pixel size of the image you compiled.
   MindAR normalises a target to 1 unit wide, so that ratio sets the label plane's
   aspect, and a wrong value stretches everything.

5. **Align the video** (below).

6. **Point a QR code** at `?wine=<id>`. Ids are baked into printed labels — pick one
   you can live with and never change it.

No changes to `app.js` at any point.

---

## Aligning a video

Generators reframe and pillarbox their output, so every clip needs alignment. Two
modes, both live — no redeploy:

| URL | What it does |
|---|---|
| `?wine=<id>&preview=1&tune=1` | Head-on, no camera, no bottle. Do the rough pass here. |
| `?wine=<id>&tune=1` | Live AR on the bottle. Confirm here. |

Nudge with the on-screen panel, then **Copy manifest** and paste the snippet into
`wines.js`. Every parameter is also settable directly in the URL — handy for jumping
straight to a value: `&vy=-0.566&cw=0.4585`.

| Param | Meaning |
|---|---|
| `vx` `vy` `vw` | Video plane position and width, in label-width units, origin at label centre |
| `cx` `cy` `cw` `ch` | Crop rectangle within the video frame, 0..1 |
| `feather` | Edge fade width, label-width units. Softens the boundary against the static label |
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

**Two planes, no chroma key.** A static `label.jpg` covers the whole target, and the
video sits in front of it. The PRD originally called for a green-screen clip and a
chroma-key shader; that became unnecessary once the video was generated rather than
filmed. It also removes the worst failure mode — H.264 stores colour at quarter
resolution, so keyed edges fringe badly and no shader recovers it.

The back plane matters more than it looks. Without it the video's edge would blend
against the *physical* label under whatever light the room happens to have, and the
brightness would never match. With it, both sides of the seam are textures we control.

**Version pinning.** `mind-ar` 1.2.5 against A-Frame 1.3.0, pinned exactly in
`index.html`. An unpinned "latest" A-Frame silently produces a blank scene.

Also note `mindar-image.prod.js` (used by the compiler) is an **ES module** and must be
`import`ed; the `-aframe` build used here is a classic script. Mixing them up costs an
hour.

**Audio.** Mobile browsers block audio-enabled playback that isn't the direct result of
a user gesture. The tap gate calls `play()` then `pause()` inside the tap to mark the
element user-activated, so playback on `targetFound` is allowed to carry sound. The
scene isn't attached until that tap either, which puts the camera prompt behind a
deliberate action rather than a page load.

**Curvature.** MindAR fits a flat homography, but a wine label is wrapped around a
cylinder. Registration is good in the centre and drifts at the left and right edges.
If it becomes objectionable, the fix is a curved geometry matching the bottle radius
instead of `a-plane` — roughly 20 lines, not yet needed.

---

## Tracking spike

`spike/` is the harness that established feasibility before any of this was built:
MindAR with a wireframe quad, no video, no shader. The 19 Crimes label scored **99.6%
locked** through handheld rotation on a phone. Keep it — it's the fastest way to tell
whether a *new* label is viable before investing in a video for it.
