#!/usr/bin/env python3
"""Tile the name strip from every print master into one sheet.

    python3 tools/verify-names.py [out.png]

The per-person name sits as small rotated text at the right edge of the portrait
window. Viewing a whole 1500x2464 label renders it illegibly, and there is no OCR
available here, so this crops just that strip from each master, rotates it
upright, and stacks all 13 with their expected id alongside. One look confirms
every label carries the right name.

This exists because nine of the thirteen labels initially carried a duplicated
name: slides 6-13 were copied from slide 5 and the name field was never updated.
That text falls inside the HeyGen crop, so a stale name would be baked into a
generated video and contradict the printed label. Re-run this after any re-export.
"""
import os
import sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDS = ['jacqui', 'james', 'seth', 'kyle', 'scot', 'julie', 'bo',
       'dan', 'jayshree', 'jeff', 'karl', 'duke', 'loren']

# Name-strip box as FRACTIONS of the master, not pixels. The text runs vertically
# just inside the right edge of the photo area.
#
# Fractional on purpose: this was absolute pixels measured against a 1500x2464
# master, and silently pointed at the wrong region the moment the artwork arrived
# on a different canvas. Same trap as TORN_TOP_FRAC in prepare-labels.py.
# Widened after the numbers got longer: the text is rotated 90 degrees, so a
# longer register number grows DOWNWARD in this frame, not sideways. The original
# box clipped the two longest. Horizontal extent is fixed by the two stacked lines
# and does not move.
BOX_FRAC = (0.820, 0.550, 0.940, 0.825)
GUTTER = 96          # space for the expected id, drawn beside each strip


def main(out):
    strips = []
    for pid in IDS:
        p = os.path.join(HERE, 'source', 'labels', f'{pid}.png')
        if not os.path.exists(p):
            sys.exit(f'missing {p} — run tools/prepare-labels.py first')
        im = Image.open(p)
        W, H = im.size
        box = (round(BOX_FRAC[0] * W), round(BOX_FRAC[1] * H),
               round(BOX_FRAC[2] * W), round(BOX_FRAC[3] * H))
        s = im.crop(box).transpose(Image.ROTATE_270)
        strips.append((pid, s))

    w = max(s.width for _, s in strips) + GUTTER
    h = sum(s.height for _, s in strips)
    sheet = Image.new('RGB', (w, h), (24, 24, 28))
    d = ImageDraw.Draw(sheet)
    y = 0
    for pid, s in strips:
        sheet.paste(s, (GUTTER, y))
        d.text((8, y + s.height // 2 - 4), pid, fill=(255, 210, 90))
        d.line([(0, y), (w, y)], fill=(70, 70, 80))
        y += s.height
    sheet.save(out)
    print(f'{len(strips)} strips -> {out}  ({sheet.width}x{sheet.height})')
    print('Each row: expected id on the left, the label\'s own printed name on the right.')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'names.png')
