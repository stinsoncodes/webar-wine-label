# Tracking spike

Purpose: find out whether the wine label is trackable **before** any of the app gets built.
If the label can't hold a lock, no amount of shader or UI work saves the project, and the
answer becomes a redesigned label, an added marker, or a paid tracker (8th Wall).

Nothing here is app code. It gets deleted once the question is answered.

---

## Step 1 — Feature check — DONE

`targets.mind` in this folder is compiled and ready. Source: `IMG_4189.HEIC`
(19 Crimes Cabernet Sauvignon), converted and cropped to `/source/label.jpg`
(484×1200, cropped to label only, mild autocontrast).

Result for target 0:

| Metric | Value | Read |
|---|---|---|
| Matching feature points | 2706 | Strong. Detection should be quick and robust. |
| Tracking points, scale 0 / 1 | 68 / 38 | Healthy. Enough to hold a homography. |
| Keypoint distribution | Spread head-to-foot | No dead zones; face, wordmark and torn edge all contribute. |

The label is a good AR target — unsurprising, since 19 Crimes designed it to be one.
The remaining unknown is not feature quality but whether tracking survives the glass
curvature at real viewing angles. That's step 2.

**Caveat on the source photo:** it was shot from slightly above and off-axis, so mild
keystone is baked into the target, and the far left/right of the label was cropped away
where curvature is steepest. Good enough to answer the feasibility question. If step 2
lands marginal, reshoot straight-on before concluding anything.

### Recompiling

To regenerate from a new or additional photo, use `/tools/compile.html` — it runs the
MindAR compiler locally, prints the feature stats above, draws the keypoint overlay,
and POSTs the result straight to disk (no browser download step):

```bash
python3 tools/compile-server.py     # from the project root
```

then open `http://localhost:8765/tools/compile.html`. Edit the `SOURCES` array at the
top of that file to compile several images into one multi-target `.mind`.

The hosted compiler at https://hiukim.github.io/mind-ar-js-doc/tools/compile does the
same job if you'd rather not run anything locally. Note it needs JPEG/PNG — browsers
cannot decode HEIC, so convert first:

```bash
sips -s format jpeg -s formatOptions 95 IMG_XXXX.HEIC --out label.jpg
```

---

## Step 2 — Live tracking test  ← you are here

Serve the folder — `file://` will not get camera access:

```bash
cd tracking-spike && python3 -m http.server 8000
```

`localhost` is a secure context, so no certificates are needed for desktop testing.

### 2a. Check the camera

http://localhost:8000/camera-check.html

Pick the Studio Display camera from the dropdown. **Turn Center Stage off first**
(Control Center → Video Effects) — it digitally re-crops the frame in real time and
will make tracking look worse than it is.

Hold the bottle where a user would hold a phone and watch the sharpness number. The
Studio Display is a fixed-focus 122° ultrawide, so it goes soft up close; find the
distance that maximises the score and use that distance in 2b.

### 2b. Run the tracker

http://localhost:8000/tracking-test.html

A green wireframe quad locks onto the label. No video, no shader — if this jitters
or drops, the cause is tracking.

| Query param | Default | Effect |
|---|---|---|
| `targets` | `1` | Number of targets in the `.mind` file |
| `filterMinCF` | `0.0001` | Lower = smoother, laggier |
| `filterBeta` | `0.001` | Higher = snappier, jitterier |
| `missTolerance` | `5` | Frames of loss tolerated before `targetLost` fires |
| `warmupTolerance` | `5` | Frames of detection required before `targetFound` fires |

e.g. `tracking-test.html?targets=4&filterBeta=0.01`

**Note:** MindAR picks the camera itself; there's no device selector. If it grabs the
wrong one on a multi-camera Mac, set the default in Chrome under
Settings → Privacy and security → Site settings → Camera.

---

## What counts as a pass

The metric that matters is **% locked while the bottle is moving**, not whether it can
find the target once while held still. Rotate the bottle slowly ±40°, tilt it, move it
toward and away from the camera.

- **> 90% locked through slow rotation** — good, proceed to build.
- **60–90%, or visible jitter** — try the multi-angle mitigation below.
- **< 60%, or won't lock at all** — the label is the problem. Stop and rethink the target.

### Multi-angle mitigation

If a single target is marginal, shoot the label at 3–5 rotations (0°, ±20°, ±40°),
compile all of them into one `.mind` file, and run with `?targets=5`. MindAR treats
them as separate indices; in the real app every index renders the same video. This
widens the usable viewing cone considerably and is the standard fix for curved labels.

---

## Then, and only then

Once tracking passes, the remaining risk is video keying quality, which is a
production problem more than a code problem. Test that second, also in isolation,
before wiring the two together.
