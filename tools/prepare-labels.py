#!/usr/bin/env python3
"""Turn PowerPoint's slide exports into print masters and HeyGen inputs.

    python3 tools/prepare-labels.py "<folder of SlideN.png>"

Two outputs per person:

  source/labels/<id>.png   1500x2464 — the label centre-cropped to a true
                           3.5in x 5.75in. THIS IS THE PRINT MASTER. The slide
                           canvas is 5 x 8.4in (aspect 0.5952) against the
                           label's 0.6087, so ~2.3% of excess height is trimmed
                           evenly top and bottom. Whatever goes to the printer
                           must be this file, or the printed label will not match
                           the compiled AR tracking target.

  source/heygen/<id>.png   1500x<window> — exactly the region of the printed
                           label that the photo occupies, so a generated clip is
                           framed the same way the label is. Identical crop for
                           all 13, which is what lets any character's video play
                           on any bottle.

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

# Highest point of the torn-paper edge, as a fraction of slide height.
#
# Derived from the template's own alpha channel, not detected from the render:
# ppt/media/image2.png is 1650x1202 with the cream opaque and everything below
# the tear transparent. Its opaque region ends between rows 603 and 703, and the
# shape is placed at y=1.319in with height 5.833in on an 8.4028in slide, giving a
# torn edge spanning 4.2452..4.7305in. 4.2452 / 8.4028 = 0.505213.
#
# Measured rather than eyeballed because detecting the cream/photo transition
# from the composite is unreliable — a scan for sustained dark pixels latches
# onto the serif copy higher up the label. CHECK_* below guards against this
# constant going stale if the template is ever revised.
TORN_TOP_FRAC = 0.505213
CHECK_CREAM_MIN = 170      # luminance well above the tear should be paper
CHECK_PHOTO_MAX = 150      # luminance well below it should be photograph

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
    hey_dir = os.path.join(HERE, 'source', 'heygen')
    os.makedirs(lab_dir, exist_ok=True)
    os.makedirs(hey_dir, exist_ok=True)

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

    torn_export = TORN_TOP_FRAC * H          # highest point of the tear
    MARGIN = 8                               # a sliver of cream above it
    top = int(round(torn_export - cut - MARGIN))
    win_h = need - top

    print(f'export       {W}x{H}  aspect {W/H:.4f}')
    print(f'print master {W}x{need}  aspect {W/need:.6f}  '
          f'(target {LABEL_W_IN/LABEL_H_IN:.6f}, err '
          f'{abs(W/need-LABEL_W_IN/LABEL_H_IN)/(LABEL_W_IN/LABEL_H_IN)*100:.3f}%)')
    print(f'  trimmed {cut}px top and bottom; {W/LABEL_W_IN:.1f} DPI')
    print(f'torn edge    row {torn_export:.0f} of {H} (from template geometry)')
    print(f'heygen crop  {W}x{win_h}  aspect {W/win_h:.4f}  '
          f'= {LABEL_W_IN:.2f} x {win_h/need*LABEL_H_IN:.3f} in printed')
    print(f'  window top {top/need*LABEL_H_IN:.3f} in from label top '
          f'({top/need*100:.1f}%)\n')

    print(f"{'id':<9} {'name':<9} {'print master':>16} {'heygen':>14}  check")
    print('-' * 62)
    bad = 0
    for n, pid, name in PEOPLE:
        im = Image.open(os.path.join(src_dir, f'Slide{n}.png')).convert('RGB')
        label = im.crop((0, cut, W, cut + need))
        gray = np.asarray(label.convert('L'), dtype=np.int16)
        ok = check_torn_edge(gray, int(round(torn_export - cut)), pid)
        bad += 0 if ok else 1
        label.save(os.path.join(lab_dir, f'{pid}.png'))
        window = label.crop((0, top, W, need))
        window.save(os.path.join(hey_dir, f'{pid}.png'))
        print(f'{pid:<9} {name:<9} {str(label.size):>16} {str(window.size):>14}'
              f'  {"ok" if ok else "FAIL"}')
    if bad:
        print(f'\n!! {bad} label(s) failed the torn-edge check — review before printing')

    print(f'\nprint masters -> source/labels/   ({len(PEOPLE)} files)')
    print(f'heygen inputs -> source/heygen/   ({len(PEOPLE)} files)')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
