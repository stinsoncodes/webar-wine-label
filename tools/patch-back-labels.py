#!/usr/bin/env python3
"""Drop the real QR codes into the back-label PowerPoint, one per slide.

    python3 tools/patch-back-labels.py <in.pptx> [-o out.pptx]

The artist's template leaves a placeholder on every slide: a shape called
"Rectangle 28" with no fill and a thin #46423D outline, plus a "QR CODE REPLACE"
caption sitting inside it. This replaces both with that person's actual code.

WHAT CHANGES, AND NOTHING ELSE:

  - "Rectangle 28" is deleted (it is a guide; its stroke would otherwise print
    hard against the quiet zone).
  - The "QR CODE REPLACE" caption is deleted.
  - A picture is added as the frontmost shape on the slide, 21mm square.
  - One PNG per slide is added under ppt/media/, with one new relationship.

Every other part of the package is copied through byte for byte, including the
sensitivity label in docMetadata/. The input file is never written to.

GEOMETRY: 21mm square (756000 EMU exactly, since 1mm = 36000 EMU), right edge
held at the placeholder's own right edge so the code stays optically aligned with
the column the artist set up, and the top raised to 0.150in so the bottom clears
the "SCAN TO WATCH" caption. 21mm across the full 41-module span (33 modules of
code plus the mandatory 4-module quiet zone each side) gives 0.512mm per module,
comfortably above the ~0.4mm that phone cameras need.

TRANSPARENT BACKGROUND: the codes are embedded with transparency rather than on a
white plate, so the label's own paper tone reads through and there is no visible
white square. That is only safe because the backdrop was measured first -- flat,
opaque, luma 243-244 across the whole footprint on every slide. The standalone
files in source/qr/ keep their white background, because those may be placed
anywhere.
"""
import argparse
import importlib.util
import os
import re
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMU_PER_MM = 36000
EMU_PER_IN = 914400

SIZE_MM = 21.0
TOP_IN = 0.150
BASE_URL = 'https://qcrimes.us'

# Slide order, verified against the personal name printed on each back label.
PEOPLE = ['jacqui', 'james', 'seth', 'kyle', 'scot', 'julie', 'bo',
          'dan', 'jayshree', 'jeff', 'karl', 'duke', 'loren']
PLACEHOLDER = 'Rectangle 28'
CAPTION = 'QR CODE REPLACE'


def load_qr_module():
    p = os.path.join(HERE, 'tools', 'make-qr.py')
    spec = importlib.util.spec_from_file_location('make_qr', p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def qr_png_transparent(qr, payload, path, scale=30):
    """Black modules, everything else transparent."""
    from PIL import Image
    m, size, _, _ = qr.make_qr(payload)
    q = qr.QUIET
    n = size + 2 * q
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    for r in range(size):
        for c in range(size):
            if m[r][c]:
                img.putpixel((c + q, r + q), (0, 0, 0, 255))
    img.resize((n * scale, n * scale), Image.NEAREST).save(path)
    return m, size


def find_sp_blocks(xml):
    """(start, end) for every <p:sp> element, handling nesting defensively."""
    out, depth, start = [], 0, None
    for m in re.finditer(r'<p:sp>|</p:sp>', xml):
        if m.group(0) == '<p:sp>':
            if depth == 0:
                start = m.start()
            depth += 1
        else:
            depth -= 1
            if depth == 0:
                out.append((start, m.end()))
    return out


def drop_block(xml, predicate, what):
    """Remove the one <p:sp> block matching predicate. Exactly one, or raise."""
    hits = [(s, e) for s, e in find_sp_blocks(xml) if predicate(xml[s:e])]
    if len(hits) != 1:
        raise RuntimeError(f'expected exactly 1 {what}, found {len(hits)}')
    s, e = hits[0]
    return xml[:s] + xml[e:]


def text_of(block):
    # re.S matters: a text run can contain a literal newline, as the caption
    # does ("QR CODE\nREPLACE"). Without DOTALL the run is simply not seen and
    # the caption silently survives the patch.
    runs = re.findall(r'<a:t>(.*?)</a:t>', block, re.S)
    return re.sub(r'\s+', ' ', ''.join(runs)).strip()


def pic_xml(shape_id, rid, name, x, y, size):
    return (
        f'<p:pic><p:nvPicPr><p:cNvPr id="{shape_id}" name="{name}"/>'
        f'<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/>'
        f'</p:nvPicPr>'
        f'<p:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/>'
        f'</a:stretch></p:blipFill>'
        f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/>'
        f'<a:ext cx="{size}" cy="{size}"/></a:xfrm>'
        f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('-o', '--out')
    ap.add_argument('--base', default=BASE_URL)
    a = ap.parse_args()
    src = os.path.abspath(a.src)
    out = a.out or os.path.join(
        HERE, 'source',
        os.path.splitext(os.path.basename(src))[0] + '_QR-PLACED.pptx')
    if os.path.abspath(out) == src:
        sys.exit('refusing to overwrite the input file')

    qr = load_qr_module()
    zin = zipfile.ZipFile(src)
    names = zin.namelist()

    slides = sorted([n for n in names if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)],
                    key=lambda n: int(re.search(r'(\d+)', n).group(1)))
    if len(slides) != len(PEOPLE):
        sys.exit(f'{len(slides)} slides but {len(PEOPLE)} people')

    size_emu = round(SIZE_MM * EMU_PER_MM)
    top_emu = round(TOP_IN * EMU_PER_IN)

    tmp = os.path.join(os.path.dirname(out), '.qrtmp')
    os.makedirs(tmp, exist_ok=True)
    patched, media, rels_patched = {}, {}, {}

    print(f'{SIZE_MM:.0f}mm square = {size_emu} EMU, top {TOP_IN}in = {top_emu} EMU')
    print(f'module size {SIZE_MM / 41:.3f}mm across the 41-module span\n')
    print(f"{'slide':<6} {'person':<9} {'left EMU':>9} {'bottom in':>9} "
          f"{'clears by':>10}  {'placeholder':<12} caption")
    print('-' * 74)

    for i, sname in enumerate(slides):
        pid = PEOPLE[i]
        xml = zin.read(sname).decode('utf-8')

        # The placeholder gives us the right edge to align to.
        blocks = find_sp_blocks(xml)
        ph = [xml[s:e] for s, e in blocks if f'name="{PLACEHOLDER}"' in xml[s:e]]
        if len(ph) != 1:
            sys.exit(f'{sname}: found {len(ph)} "{PLACEHOLDER}" shapes')
        off = re.search(r'<a:off x="(-?\d+)" y="(-?\d+)"/>', ph[0])
        ext = re.search(r'<a:ext cx="(\d+)" cy="(\d+)"/>', ph[0])
        right = int(off.group(1)) + int(ext.group(1))
        left = right - size_emu
        bottom = top_emu + size_emu

        # Anything the new box might now collide with, below it.
        below = []
        for s, e in blocks:
            b = xml[s:e]
            o = re.search(r'<a:off x="(-?\d+)" y="(-?\d+)"/>', b)
            if not o or f'name="{PLACEHOLDER}"' in b or CAPTION in text_of(b):
                continue
            bx, by = int(o.group(1)), int(o.group(2))
            if by >= bottom - 1 and bx + 200000 > left:
                below.append(by)
        clears = (min(below) - bottom) / EMU_PER_IN if below else None

        xml = drop_block(xml, lambda b: f'name="{PLACEHOLDER}"' in b, PLACEHOLDER)
        had_caption = any(CAPTION in text_of(xml[s:e]) for s, e in find_sp_blocks(xml))
        if had_caption:
            xml = drop_block(xml, lambda b: CAPTION in text_of(b), CAPTION)

        ids = [int(n) for n in re.findall(r'<p:cNvPr id="(\d+)"', xml)]
        shape_id = max(ids) + 1

        rel_path = f'ppt/slides/_rels/{os.path.basename(sname)}.rels'
        rels = zin.read(rel_path).decode('utf-8')
        used = set(re.findall(r'Id="(rId\d+)"', rels))
        rid = next(f'rId{n}' for n in range(100, 999) if f'rId{n}' not in used)
        media_name = f'qr-{pid}.png'
        rels = rels.replace(
            '</Relationships>',
            f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/'
            f'officeDocument/2006/relationships/image" '
            f'Target="../media/{media_name}"/></Relationships>')
        rels_patched[rel_path] = rels.encode('utf-8')

        pic = pic_xml(shape_id, rid, f'QR {pid}', left, top_emu, size_emu)
        xml = xml.replace('</p:spTree>', pic + '</p:spTree>')
        patched[sname] = xml.encode('utf-8')

        png = os.path.join(tmp, media_name)
        qr_png_transparent(qr, f'{a.base}/?wine={pid}', png)
        media[f'ppt/media/{media_name}'] = open(png, 'rb').read()

        print(f"{i + 1:<6} {pid:<9} {left:>9} {bottom / EMU_PER_IN:>9.3f} "
              f"{(f'{clears * 25.4:.2f}mm' if clears is not None else 'n/a'):>10}  "
              f"{'removed':<12} {'removed' if had_caption else 'not found'}")
        if clears is not None and clears < 0:
            print(f'   !! slide {i + 1}: the new box OVERLAPS a shape below it')

    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in names:                      # preserve original part order
            info = zin.getinfo(n)
            data = patched.get(n) or rels_patched.get(n) or zin.read(n)
            z.writestr(zipfile.ZipInfo(n, date_time=info.date_time), data)
        for n, data in media.items():
            z.writestr(n, data)

    shutil.rmtree(tmp, ignore_errors=True)
    zin.close()
    print(f'\n-> {os.path.relpath(out, HERE)}  '
          f'({os.path.getsize(out) / 1024 / 1024:.1f} MB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
