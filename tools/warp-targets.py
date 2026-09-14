#!/usr/bin/env python3
"""Cylindrically pre-warp flat label artwork into MindAR tracking targets.

    python3 tools/warp-targets.py --test     # verify the projection, no files
    python3 tools/warp-targets.py            # warp source/labels/ -> source/targets/

WHY: MindAR fits a planar homography, but the camera sees a label wrapped round a
bottle. Feeding it flat artwork makes the reference disagree with reality at the
edges. Simulating the wrap first reproduces the condition the working target
already has baked in — that one came from a photograph of a curved bottle — only
without lighting, noise or lens distortion.

THE PROJECTION: a point at arc distance `a` from the label's centre line, on a
cylinder of radius R, appears to a distant camera at x = R*sin(a/R). Output
columns are uniform in that projected x, so each is sampled from arc position
a = R*asin(x/R). Only the horizontal mapping changes; rows pass through
untouched. Scale is chosen so the centre column is 1:1 with the source, where
dx/da = cos(0) = 1.

The edges are then trimmed: past roughly 50 degrees, cos(theta) < 0.64 squeezes
detail into too few pixels to yield usable features. KEEP is set to the same
fraction of projected width as the target that tracks at 99.6%.
"""
import math
import os
import sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOTTLE_DIAMETER_MM = 76.0      # standard 750ml Bordeaux
LABEL_ARC_IN = 3.5             # label width, measured along the curve
KEEP = 0.838                   # fraction of projected width retained

IDS = ['jacqui', 'james', 'seth', 'kyle', 'scot', 'julie', 'bo',
       'dan', 'jayshree', 'jeff', 'karl', 'duke', 'loren']


def geometry(src_w):
    """Everything the warp and the manifest need, from two measurements."""
    R = BOTTLE_DIAMETER_MM / 2.0
    arc_mm = LABEL_ARC_IN * 25.4
    px_per_mm = src_w / arc_mm            # source is uniform in arc length
    theta_max = (arc_mm / 2.0) / R        # half-arc the whole label subtends
    chord_mm = 2.0 * R * math.sin(theta_max)
    out_w = int(round(chord_mm * px_per_mm * KEEP))
    kept_chord_mm = chord_mm * KEEP
    curve_deg = math.degrees(math.asin((kept_chord_mm / 2.0) / R))
    return dict(R=R, arc_mm=arc_mm, px_per_mm=px_per_mm,
                theta_max_deg=math.degrees(theta_max), chord_mm=chord_mm,
                out_w=out_w, kept_chord_mm=kept_chord_mm, curve_deg=curve_deg)


def source_columns(src_w, g):
    """Fractional source x for each output column."""
    j = np.arange(g['out_w']) + 0.5
    x_mm = (j - g['out_w'] / 2.0) / g['px_per_mm']        # projected, from centre
    x_mm = np.clip(x_mm / g['R'], -1.0, 1.0)              # sin(theta)
    a_mm = g['R'] * np.arcsin(x_mm)                       # back to arc length
    return src_w / 2.0 + a_mm * g['px_per_mm']


def warp(im, g):
    a = np.asarray(im, dtype=np.float32)
    h, w = a.shape[:2]
    sx = source_columns(w, g)
    x0 = np.floor(sx).astype(np.int32)
    x1 = np.clip(x0 + 1, 0, w - 1)
    t = (sx - x0).astype(np.float32)[None, :, None]
    x0 = np.clip(x0, 0, w - 1)
    out = a[:, x0, :] * (1 - t) + a[:, x1, :] * t
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def test():
    g = geometry(1500)
    print('geometry for a 1500px-wide 3.5in label on a 76mm bottle')
    for k in ('R', 'arc_mm', 'px_per_mm', 'theta_max_deg', 'chord_mm',
              'out_w', 'kept_chord_mm', 'curve_deg'):
        print(f'  {k:<16} {g[k]:.4f}')

    # 1. Analytic round trip: arc -> projected -> arc must be identity.
    R, half = g['R'], g['arc_mm'] / 2
    a = np.linspace(-half, half, 20001)
    back = R * np.arcsin(np.clip(R * np.sin(a / R) / R, -1, 1))
    err = np.abs(a - back).max()
    print(f'\nanalytic round trip  max error {err:.3e} mm  '
          f'{"PASS" if err < 1e-9 else "FAIL"}')

    # 2. Monotonic and centre 1:1.
    sx = source_columns(1500, g)
    mono = bool(np.all(np.diff(sx) > 0))
    mid = g['out_w'] // 2
    centre_scale = sx[mid + 1] - sx[mid]
    print(f'mapping monotonic    {mono}  {"PASS" if mono else "FAIL"}')
    print(f'centre px scale      {centre_scale:.6f} (expect ~1.0)  '
          f'{"PASS" if abs(centre_scale - 1) < 0.01 else "FAIL"}')
    edge_scale = sx[-1] - sx[-2]
    print(f'edge px scale        {edge_scale:.4f} '
          f'(= 1/cos({g["curve_deg"]:.1f}deg) = {1/math.cos(math.radians(g["curve_deg"])):.4f})')

    # 3. Pixel round trip on a synthetic grid: warp, invert, compare line centres.
    W, H = 1500, 300
    grid = np.full((H, W, 3), 255, np.uint8)
    lines = list(range(50, W - 50, 100))
    for x in lines:
        grid[:, x - 1:x + 2, :] = 0
    warped = warp(Image.fromarray(grid), g)
    wa = np.asarray(warped.convert('L'), dtype=np.float32)
    # invert: for each source line, where should it land in the warped image?
    ok = True
    for x in lines:
        a_mm = (x + 0.5 - W / 2) / g['px_per_mm']
        x_proj = g['R'] * math.sin(a_mm / g['R'])
        expect = x_proj * g['px_per_mm'] + g['out_w'] / 2 - 0.5
        if not (0 <= expect < g['out_w']):
            continue
        col = wa[H // 2]
        lo, hi = max(0, int(expect) - 6), min(g['out_w'], int(expect) + 7)
        seg = 255.0 - col[lo:hi]
        if seg.sum() < 1:
            print(f'  line {x}: not found near {expect:.1f}  FAIL'); ok = False; continue
        found = float((seg * np.arange(lo, hi)).sum() / seg.sum())
        if abs(found - expect) > 0.75:
            print(f'  line {x}: expected {expect:.2f} found {found:.2f}  FAIL'); ok = False
    print(f'pixel grid round trip {"PASS" if ok else "FAIL"} '
          f'({len(lines)} lines, tolerance 0.75px)')
    return 0 if (err < 1e-9 and mono and ok) else 1


def main():
    src = os.path.join(HERE, 'source', 'labels')
    dst = os.path.join(HERE, 'source', 'targets')
    os.makedirs(dst, exist_ok=True)
    first = Image.open(os.path.join(src, f'{IDS[0]}.png'))
    g = geometry(first.width)
    print(f'source {first.width}x{first.height} -> target {g["out_w"]}x{first.height}'
          f'  aspect {g["out_w"]/first.height:.4f}')
    print(f'manifest: chordMm {g["kept_chord_mm"]:.1f}  '
          f'derived curve {g["curve_deg"]:.2f} deg\n')
    for pid in IDS:
        p = os.path.join(src, f'{pid}.png')
        if not os.path.exists(p):
            sys.exit(f'missing {p} — run tools/prepare-labels.py first')
        im = Image.open(p).convert('RGB')
        warp(im, geometry(im.width)).save(os.path.join(dst, f'{pid}.png'))
        print(f'  {pid}')
    print(f'\n{len(IDS)} targets -> source/targets/')


if __name__ == '__main__':
    sys.exit(test() if '--test' in sys.argv else (main() or 0))
