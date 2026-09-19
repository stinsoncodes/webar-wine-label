#!/usr/bin/env python3
"""Turn PowerPoint's slide exports into print masters and HeyGen inputs.

    python3 tools/prepare-labels.py "<folder of SlideN.png>"

Two outputs per person:

  source/labels/<id>.png          the label at a true 3.5in x 5.75in. THIS IS THE
                           PRINT MASTER. Whatever goes to the printer must be this
                           file, or the printed label will not match the compiled AR
                           tracking target. Any excess canvas height is trimmed
                           evenly top and bottom; if the artwork already arrives on
                           a 3.5:5.75 canvas that trim is simply zero.

  source/heygen/window/<id>.png   exactly the region of the printed label that the
                           photo occupies, so a generated clip is framed the way
                           the label is and its background matches the print at the
                           seam.

  source/heygen/face/<id>.png     the same pixels cropped tighter, for generators
                           that need the subject larger in frame. Also excludes the
                           vertical name text, so nobody's name can be warped by a
                           generative model.

Sizes follow the export. An 1800px-wide export gives a 1800x2957 master at 514 DPI,
a 1800x1471 window and a 1224x1471 face crop. Nothing downstream is pinned to a
particular export width: the crops are fractional and the tracking targets are
downscaled to a fixed 500px regardless.

Which variant to use is an open question: generators warn that avatars fail when
the subject is small, but the window crop is already a chest-up framing. Generate
one person both ways and compare before committing to thirteen.

The window's top edge is placed just ABOVE the highest point of the torn-paper
edge, so the clip contains its own copy of that edge. That is deliberate: the
runtime UV crop can remove the torn edge later if a generated clip makes it
wobble, but it cannot add one back. Including it keeps both options open.
"""
import os
import sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABEL_W_IN, LABEL_H_IN = 3.5, 5.75

# Highest point of the torn-paper edge, as a fraction of the LABEL's height —
# NOT of PowerPoint's canvas.
#
# This distinction matters and was learned the hard way. The constant was
# originally a fraction of the 5 x 8.4in slide; when the artist re-laid the
# artwork onto a correct 3.5 x 5.75 canvas, every crop would have landed ~160px
# wrong. Expressed against the label, it survives any canvas the artwork arrives on.
#
# Derived from the template's own alpha channel, not detected from the render:
# ppt/media/image2.png is 1650x1202 with the cream opaque and everything below the
# tear transparent. Its opaque region ends between rows 603 and 703, and the shape
# sat at y=1.319in with height 5.833in, putting the tear at 4.2452..4.7305in on a
# slide whose label region spanned 0.0943..8.3085in. Hence
# (4.2452 - 0.0943) / 8.2143 = 0.505323.
#
# Cross-checked against pixels: in the 1500x2464 master the tear's top lands at
# row 1245, i.e. 1245/2464 = 0.505276 — agreement to 0.009%.
#
# Measured rather than eyeballed because detecting the cream/photo transition from
# the composite is unreliable: a scan for sustained dark pixels latches onto the
# serif copy higher up the label, and a looser test on the new export gave a 159px
# spread across the thirteen. CHECK_* below guards against this going stale.
TORN_TOP_FRAC_OF_LABEL = 0.505323
CHECK_CREAM_MIN = 170      # luminance well above the tear should be paper
CHECK_PHOTO_MAX = 150      # luminance well below it should be photograph

# Tighter crop of the photo window, as fractions of window width, for generators
# that want the subject larger in frame. One fixed box serves all 13: the designer
# placed every portrait so the face sits essentially dead centre of the window
# (verified on a 13-up contact sheet with centre crosshairs), so no per-person
# face detection is needed — and none is available here anyway.
#
# The right edge stops short deliberately: the vertical REG. NO. / name text lives
# beyond it, and excluding it means a generator cannot warp or garble somebody's
# name. Full height is kept so the shoulders stay in frame, which is the framing
# these tools ask for.
FACE_CROP_X0, FACE_CROP_X1 = 0.133, 0.813

# slide number -> (id, display name), in the order the names were given.
PEOPLE = [
    (1, 'jacqui', 'Jacqui'), (2, 'james', 'James'), (3, 'seth', 'Seth'),
    (4, 'kyle', 'Kyle'), (5, 'scot', 'Scot'), (6, 'julie', 'Julie'),
    (7, 'bo', 'Bo'), (8, 'dan', 'Dan'), (9, 'jayshree', 'Jayshree'),
    (10, 'jeff', 'Jeff'), (11, 'karl', 'Karl'), (12, 'duke', 'Duke'),
    (13, 'loren', 'Loren'),
]


def check_torn_edge(gray, torn_row, label):
    """Confirm TORN_TOP_FRAC still describes this artwork.

    Not a detector — just a sanity check that cream sits above the assumed tear
    and photograph below it. Catches a revised template instead of silently
    cropping in the wrong place.
    """
    h, w = gray.shape
    band = max(8, h // 100)
    above = gray[max(0, torn_row - 6 * band):torn_row - band, :].mean()
    below = gray[torn_row + 3 * band:torn_row + 8 * band, :].mean()
    ok = above >= CHECK_CREAM_MIN and below <= CHECK_PHOTO_MAX
    if not ok:
        print(f'  !! {label}: expected cream above the tear and photo below, got '
              f'above={above:.0f} below={below:.0f}. TORN_TOP_FRAC may be stale.')
    return ok


def main(src_dir):
    lab_dir = os.path.join(HERE, 'source', 'labels')
    win_dir = os.path.join(HERE, 'source', 'heygen', 'window')
    fac_dir = os.path.join(HERE, 'source', 'heygen', 'face')
    for d in (lab_dir, win_dir, fac_dir):
        os.makedirs(d, exist_ok=True)

    # One window for all 13. The label template is identical across slides, so a
    # shared window keeps every HeyGen input the same size and framing — the
    # precondition for playing any character's clip on any bottle.
    sizes = set()
    for n, _, _ in PEOPLE:
        p = os.path.join(src_dir, f'Slide{n}.png')
        if not os.path.exists(p):
            sys.exit(f'missing {p}')
        sizes.add(Image.open(p).size)
    if len(sizes) != 1:
        sys.exit(f'exports differ in size: {sizes}')
    W, H = sizes.pop()

    need = round(W / (LABEL_W_IN / LABEL_H_IN))
    if need > H:
        sys.exit(f'render {W}x{H} is too short to crop to {LABEL_W_IN}:{LABEL_H_IN}')
    cut = (H - need) // 2

    # Relative to the label, so an export whose canvas already IS 3.5:5.75
    # (cut == 0) and one carrying excess height both land in the same place.
    torn_label = TORN_TOP_FRAC_OF_LABEL * need
    MARGIN = 8                               # a sliver of cream above the tear
    top = int(round(torn_label - MARGIN))
    win_h = need - top

    print(f'export       {W}x{H}  aspect {W/H:.4f}')
    print(f'print master {W}x{need}  aspect {W/need:.6f}  '
          f'(target {LABEL_W_IN/LABEL_H_IN:.6f}, err '
          f'{abs(W/need-LABEL_W_IN/LABEL_H_IN)/(LABEL_W_IN/LABEL_H_IN)*100:.3f}%)')
    print(f'  trimmed {cut}px top and bottom; {W/LABEL_W_IN:.1f} DPI')
    print(f'torn edge    row {torn_label:.0f} of {need} in the master '
          f'(label-relative, from template geometry)')
    print(f'heygen crop  {W}x{win_h}  aspect {W/win_h:.4f}  '
          f'= {LABEL_W_IN:.2f} x {win_h/need*LABEL_H_IN:.3f} in printed')
    print(f'  window top {top/need*LABEL_H_IN:.3f} in from label top '
          f'({top/need*100:.1f}%)\n')

    fx0, fx1 = int(round(FACE_CROP_X0 * W)), int(round(FACE_CROP_X1 * W))
    print(f'face crop    {fx1-fx0}x{win_h}  aspect {(fx1-fx0)/win_h:.4f}'
          f'  (x {fx0}..{fx1}, excludes the name text)')
    print()
    print(f"{'id':<9} {'print master':>16} {'window':>13} {'face':>13}  check")
    print('-' * 62)
    bad = 0
    for n, pid, name in PEOPLE:
        im = Image.open(os.path.join(src_dir, f'Slide{n}.png')).convert('RGB')
        label = im.crop((0, cut, W, cut + need))
        gray = np.asarray(label.convert('L'), dtype=np.int16)
        ok = check_torn_edge(gray, int(round(torn_label)), pid)
        bad += 0 if ok else 1
        label.save(os.path.join(lab_dir, f'{pid}.png'))
        window = label.crop((0, top, W, need))
        window.save(os.path.join(win_dir, f'{pid}.png'))
        window.crop((fx0, 0, fx1, win_h)).save(os.path.join(fac_dir, f'{pid}.png'))
        print(f'{pid:<9} {str(label.size):>16} {str(window.size):>13} '
              f'{str((fx1-fx0, win_h)):>13}  {"ok" if ok else "FAIL"}')
    if bad:
        print(f'\n!! {bad} label(s) failed the torn-edge check — review before printing')

    print(f'\nprint masters -> source/labels/          ({len(PEOPLE)} files)')
    print(f'generator in  -> source/heygen/window/  ({len(PEOPLE)} files)')
    print(f'              -> source/heygen/face/    ({len(PEOPLE)} files)')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
