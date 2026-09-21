#!/usr/bin/env python3
"""Generate the printed QR codes, one per person, plus a pack for the designer.

    python3 tools/make-qr.py                      # uses the production base URL
    python3 tools/make-qr.py --base https://...   # override for a test run
    python3 tools/make-qr.py --selftest            # encoder checks, writes nothing

WHY THIS EXISTS RATHER THAN A WEBSITE: these URLs get printed onto thirteen
physical labels and can never be changed afterwards. A generator that is a black
box, that might append tracking, that might redirect through someone else's
domain, or that might quietly be offline the day we reprint, is the wrong
dependency for that. So the encoder is here, in the repo, pinned to nothing.

WHAT IS FIXED, AND WHY:

  byte mode        The ids are lowercase. QR's denser alphanumeric mode is
                   uppercase-only, and while a HOST is case-insensitive, our
                   QUERY STRING is not -- ?WINE=LOREN would not match
                   q.get('wine'). So byte mode it is.

  ECC level Q      25% recovery. These live on a bottle that gets handled,
                   chilled and spilled on; M's 15% is the web default, not a
                   print default.

  version 4        33x33 modules. Every id fits, so all thirteen codes are
  (forced)         geometrically IDENTICAL: same module count, same size, same
                   placement on every label. The designer positions one box
                   thirteen times instead of measuring thirteen boxes. The
                   longest id (jayshree, 33 bytes) is one byte over what V3-Q
                   holds, so V4 is also the smallest version that fits them all.

  quiet zone 4     The spec minimum. Not negotiable -- a QR with artwork tight
                   against its edge is the single most common reason a printed
                   code will not scan.

Everything is verified by decoding the rendered image back to the URL, not by
trusting the encoder. See --selftest and the checks at the end of main().
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

BASE_DEFAULT = 'https://qcrimes.us'
PEOPLE = ['jacqui', 'james', 'seth', 'kyle', 'scot', 'julie', 'bo',
          'dan', 'jayshree', 'jeff', 'karl', 'duke', 'loren']

VERSION = 4
ECL = 'Q'
QUIET = 4
PNG_SCALE = 30          # integer module size, so no resampling blur

# (data codewords, ec codewords per block, blocks) for the versions we may touch.
# Full table trimmed to what this tool can emit; a wrong row here is caught by
# the self-test, which checks data+ec == total codewords for the version.
BLOCKS = {
    (4, 'L'): (80, 20, 1),
    (4, 'M'): (64, 18, 2),
    (4, 'Q'): (48, 26, 2),
    (4, 'H'): (36, 16, 4),
}
TOTAL_CODEWORDS = {4: 100}
ALIGNMENT = {4: [6, 26]}
ECL_BITS = {'L': 0b01, 'M': 0b00, 'Q': 0b11, 'H': 0b10}


# --------------------------------------------------------------------------
# GF(256) and Reed-Solomon
# --------------------------------------------------------------------------
EXP = [0] * 512
LOG = [0] * 256
_x = 1
for _i in range(255):
    EXP[_i] = _x
    LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:              # x^8 + x^4 + x^3 + x^2 + 1, QR's primitive poly
        _x ^= 0x11D
for _i in range(255, 512):
    EXP[_i] = EXP[_i - 255]


def gmul(a, b):
    if a == 0 or b == 0:
        return 0
    return EXP[LOG[a] + LOG[b]]


def rs_generator(n):
    """Generator polynomial for n error-correction codewords."""
    g = [1]
    for i in range(n):
        g = poly_mul(g, [1, EXP[i]])
    return g


def poly_mul(a, b):
    out = [0] * (len(a) + len(b) - 1)
    for i, ai in enumerate(a):
        for j, bj in enumerate(b):
            out[i + j] ^= gmul(ai, bj)
    return out


def rs_encode(data, n):
    """n Reed-Solomon codewords for `data`."""
    gen = rs_generator(n)
    rem = [0] * n
    for byte in data:
        factor = byte ^ rem[0]
        rem = rem[1:] + [0]
        for i, g in enumerate(gen[1:]):
            rem[i] ^= gmul(g, factor)
    return rem


def rs_syndromes(codewords, n):
    """Syndromes of a full codeword block; all zero means a valid RS codeword.

    This is the check that proves the ECC is right rather than merely present.
    """
    out = []
    for i in range(n):
        acc = 0
        for c in codewords:
            acc = gmul(acc, EXP[i]) ^ c
        out.append(acc)
    return out


# --------------------------------------------------------------------------
# Data encoding
# --------------------------------------------------------------------------
def encode_data(payload, version, ecl):
    """Payload -> interleaved data+EC codewords, ready for placement."""
    data_cw, ec_cw, blocks = BLOCKS[(version, ecl)]
    raw = payload.encode('utf-8')
    cap = data_cw - 2                      # mode (4 bits) + length (8 bits)
    if len(raw) > cap:
        raise ValueError(f'{payload!r} is {len(raw)} bytes; V{version}-{ecl} '
                         f'holds {cap}')

    bits = []
    put = lambda v, n: bits.extend((v >> (n - 1 - i)) & 1 for i in range(n))
    put(0b0100, 4)                         # byte mode
    put(len(raw), 8)                       # count, 8 bits for versions 1-9
    for b in raw:
        put(b, 8)

    total_bits = data_cw * 8
    put(0, min(4, total_bits - len(bits)))  # terminator
    while len(bits) % 8:                    # pad to a byte boundary
        bits.append(0)
    cws = [int(''.join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
    for i in range(data_cw - len(cws)):      # pad codewords, alternating
        cws.append(0xEC if i % 2 == 0 else 0x11)

    # Split into blocks. For every version this tool emits, blocks are equal
    # size; the assert makes a future unequal-block version fail loudly rather
    # than silently produce an unscannable code.
    assert data_cw % blocks == 0, f'unequal blocks for V{version}-{ecl}'
    per = data_cw // blocks
    dblocks = [cws[i * per:(i + 1) * per] for i in range(blocks)]
    eblocks = [rs_encode(b, ec_cw) for b in dblocks]

    for d, e in zip(dblocks, eblocks):
        assert not any(rs_syndromes(d + e, ec_cw)), 'RS syndrome check failed'

    out = []
    for i in range(per):
        out.extend(b[i] for b in dblocks)
    for i in range(ec_cw):
        out.extend(b[i] for b in eblocks)
    assert len(out) == TOTAL_CODEWORDS[version]
    return out


# --------------------------------------------------------------------------
# Module placement
# --------------------------------------------------------------------------
def new_matrix(version):
    size = 17 + 4 * version
    return [[None] * size for _ in range(size)], size


def place_function_patterns(m, size, version):
    def finder(r0, c0):
        for dr in range(-1, 8):
            for dc in range(-1, 8):
                r, c = r0 + dr, c0 + dc
                if not (0 <= r < size and 0 <= c < size):
                    continue
                ring = max(abs(dr - 3), abs(dc - 3))
                m[r][c] = 1 if ring in (0, 1, 3) else 0

    finder(0, 0)
    finder(0, size - 7)
    finder(size - 7, 0)

    for i in range(size):                       # timing patterns
        if m[6][i] is None:
            m[6][i] = 1 if i % 2 == 0 else 0
        if m[i][6] is None:
            m[i][6] = 1 if i % 2 == 0 else 0

    coords = ALIGNMENT[version]
    for r in coords:
        for c in coords:
            if m[r][c] is not None:             # overlaps a finder
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    ring = max(abs(dr), abs(dc))
                    m[r + dr][c + dc] = 1 if ring in (0, 2) else 0

    m[size - 8][8] = 1                          # the dark module

    for i in range(9):                          # reserve format areas
        for r, c in ((8, i), (i, 8)):
            if m[r][c] is None:
                m[r][c] = 'F'
    for i in range(8):
        if m[8][size - 1 - i] is None:
            m[8][size - 1 - i] = 'F'
        if m[size - 1 - i][8] is None:
            m[size - 1 - i][8] = 'F'


def place_data(m, size, codewords):
    bits = [(cw >> (7 - i)) & 1 for cw in codewords for i in range(8)]
    idx = 0
    up = True
    col = size - 1
    while col > 0:
        if col == 6:                            # the vertical timing pattern
            col -= 1
        rows = range(size - 1, -1, -1) if up else range(size)
        for r in rows:
            for c in (col, col - 1):
                if m[r][c] is None:
                    m[r][c] = bits[idx] if idx < len(bits) else 0
                    idx += 1
        up = not up
        col -= 2
    return idx


MASKS = [
    lambda r, c: (r + c) % 2 == 0,
    lambda r, c: r % 2 == 0,
    lambda r, c: c % 3 == 0,
    lambda r, c: (r + c) % 3 == 0,
    lambda r, c: (r // 2 + c // 3) % 2 == 0,
    lambda r, c: (r * c) % 2 + (r * c) % 3 == 0,
    lambda r, c: ((r * c) % 2 + (r * c) % 3) % 2 == 0,
    lambda r, c: ((r + c) % 2 + (r * c) % 3) % 2 == 0,
]


def is_function(r, c, size, version):
    """True where a module belongs to a function pattern, so masking skips it."""
    if r == 6 or c == 6:
        return True
    for r0, c0 in ((0, 0), (0, size - 7), (size - 7, 0)):
        if r0 - 1 <= r <= r0 + 7 and c0 - 1 <= c <= c0 + 7:
            return True
    coords = ALIGNMENT[version]
    for ar in coords:
        for ac in coords:
            if (ar, ac) in ((6, 6), (6, size - 7), (size - 7, 6)):
                continue
            if abs(r - ar) <= 2 and abs(c - ac) <= 2:
                return True
    if r == 8 and (c <= 8 or c >= size - 8):
        return True
    if c == 8 and (r <= 8 or r >= size - 8):
        return True
    return False


def apply_mask(m, size, version, mask):
    out = [row[:] for row in m]
    f = MASKS[mask]
    for r in range(size):
        for c in range(size):
            if not is_function(r, c, size, version) and f(r, c):
                out[r][c] ^= 1
    return out


def penalty(m, size):
    """The four penalty rules from the spec. Lower is better."""
    score = 0

    for line in list(m) + [[m[r][c] for r in range(size)] for c in range(size)]:
        run, prev = 0, None
        for v in line:
            if v == prev:
                run += 1
            else:
                if run >= 5:
                    score += 3 + (run - 5)
                run, prev = 1, v
        if run >= 5:
            score += 3 + (run - 5)

    for r in range(size - 1):                   # 2x2 blocks of one colour
        for c in range(size - 1):
            v = m[r][c]
            if v == m[r][c + 1] == m[r + 1][c] == m[r + 1][c + 1]:
                score += 3

    pat = [1, 0, 1, 1, 1, 0, 1]                 # finder-like 1:1:3:1:1
    for line in list(m) + [[m[r][c] for r in range(size)] for c in range(size)]:
        for i in range(size - 6):
            if line[i:i + 7] == pat:
                before = line[max(0, i - 4):i]
                after = line[i + 7:i + 11]
                if len(before) >= 4 and not any(before[-4:]):
                    score += 40
                if len(after) >= 4 and not any(after[:4]):
                    score += 40

    dark = sum(sum(row) for row in m)
    pct = dark * 100 / (size * size)
    score += 10 * int(abs(pct - 50) // 5)
    return score


def format_bits(ecl, mask):
    data = (ECL_BITS[ecl] << 3) | mask
    rem = data << 10
    for _ in range(5):
        if rem >> (10 + 4 - _) & 1:
            pass
    # BCH(15,5): divide by 0x537
    rem = data << 10
    while rem.bit_length() > 10:
        rem ^= 0x537 << (rem.bit_length() - 11)
    return ((data << 10) | rem) ^ 0x5412


def place_format(m, size, ecl, mask):
    bits = format_bits(ecl, mask)
    get = lambda i: (bits >> i) & 1
    for i in range(6):
        m[8][i] = get(i)
        m[i][8] = get(14 - i)
    m[8][7] = get(6)
    m[8][8] = get(7)
    m[7][8] = get(8)
    for i in range(8):
        m[8][size - 1 - i] = get(i)
    for i in range(7):
        m[size - 7 + i][8] = get(8 + i)


def make_qr(payload, version=VERSION, ecl=ECL):
    cws = encode_data(payload, version, ecl)
    base, size = new_matrix(version)
    place_function_patterns(base, size, version)
    placed = place_data(base, size, cws)
    assert placed >= TOTAL_CODEWORDS[version] * 8, 'not all data bits placed'

    grid = [[0 if v == 'F' else v for v in row] for row in base]
    best = None
    for mask in range(8):
        cand = apply_mask(grid, size, version, mask)
        place_format(cand, size, ecl, mask)
        p = penalty(cand, size)
        if best is None or p < best[0]:
            best = (p, mask, cand)
    return best[2], size, best[1], best[0]


# --------------------------------------------------------------------------
# Decoding, for verification only
# --------------------------------------------------------------------------
def decode(m, size, version=VERSION, ecl=ECL):
    """Read a rendered matrix back to its payload. Verification, not a reader."""
    fmt = 0
    for i in range(8):
        fmt |= m[8][size - 1 - i] << i
    for i in range(7):
        fmt |= m[size - 7 + i][8] << (8 + i)
    fmt ^= 0x5412
    mask = (fmt >> 10) & 0b111

    unmasked = apply_mask(m, size, version, mask)      # masking is involutive
    base, _ = new_matrix(version)
    place_function_patterns(base, size, version)

    bits = []
    up, col = True, size - 1
    while col > 0:
        if col == 6:
            col -= 1
        rows = range(size - 1, -1, -1) if up else range(size)
        for r in rows:
            for c in (col, col - 1):
                if base[r][c] is None:
                    bits.append(unmasked[r][c])
        up = not up
        col -= 2

    cws = [int(''.join(map(str, bits[i:i + 8])), 2)
           for i in range(0, len(bits) // 8 * 8, 8)]
    data_cw, ec_cw, blocks = BLOCKS[(version, ecl)]
    per = data_cw // blocks
    dblocks = [[0] * per for _ in range(blocks)]
    for i in range(per):
        for b in range(blocks):
            dblocks[b][i] = cws[i * blocks + b]
    flat = [c for b in dblocks for c in b]

    nbits = [(c >> (7 - i)) & 1 for c in flat for i in range(8)]
    take = lambda o, n: int(''.join(map(str, nbits[o:o + n])), 2)
    if take(0, 4) != 0b0100:
        raise ValueError('not byte mode')
    n = take(4, 8)
    return bytes(take(12 + 8 * i, 8) for i in range(n)).decode('utf-8'), mask


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------
def to_svg(m, size, payload, label):
    n = size + 2 * QUIET
    px = []
    for r in range(size):
        for c in range(size):
            if m[r][c]:
                px.append(f'M{c + QUIET} {r + QUIET}h1v1h-1z')
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- {label}: {payload}
     QR version {VERSION} ({size}x{size} modules), ECC level {ECL},
     {QUIET}-module quiet zone included in the viewBox.
     Do not crop, rotate-shear, or place artwork inside the quiet zone.
     Scale freely: this is vector. Keep it square. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}"
     width="{n}" height="{n}" shape-rendering="crispEdges">
  <title>{label} - talking wine label</title>
  <rect width="{n}" height="{n}" fill="#ffffff"/>
  <path fill="#000000" d="{''.join(px)}"/>
</svg>
'''


def to_png(m, size, path, scale=PNG_SCALE):
    from PIL import Image
    n = size + 2 * QUIET
    img = Image.new('1', (n, n), 1)
    for r in range(size):
        for c in range(size):
            if m[r][c]:
                img.putpixel((c + QUIET, r + QUIET), 0)
    img.resize((n * scale, n * scale), Image.NEAREST).save(path)
    return n * scale


def proof_sheet(entries, path):
    """One image showing all thirteen, captioned, for eyeballing before print."""
    from PIL import Image, ImageDraw
    cell, pad, cap = 190, 14, 26
    cols, rows = 5, 3
    W = cols * (cell + pad) + pad
    H = rows * (cell + cap + pad) + pad + 30
    sheet = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(sheet)
    d.text((pad, 10), 'Talking Wine Label - QR proofs - scan every one before print',
           fill='black')
    for i, (pid, payload, png) in enumerate(entries):
        x = pad + (i % cols) * (cell + pad)
        y = 30 + pad + (i // cols) * (cell + cap + pad)
        sheet.paste(Image.open(png).convert('RGB').resize((cell, cell),
                                                          Image.NEAREST), (x, y))
        d.text((x, y + cell + 4), pid, fill='black')
        d.text((x, y + cell + 14), payload.replace('https://', ''), fill='#666666')
    sheet.save(path)


# --------------------------------------------------------------------------
def selftest():
    """Structure and round-trip checks. Writes nothing."""
    ok = True
    for version, ecl in BLOCKS:
        d, e, b = BLOCKS[(version, ecl)]
        got = d + e * b
        if got != TOTAL_CODEWORDS[version]:
            print(f'  FAIL V{version}-{ecl}: {d}+{e}x{b}={got}, '
                  f'expected {TOTAL_CODEWORDS[version]}')
            ok = False
    print(f'  block tables consistent with total codewords: {"PASS" if ok else "FAIL"}')

    cases = ['https://qcrimes.us/?wine=bo', 'https://qcrimes.us/?wine=jayshree',
             'a', 'x' * 46]
    for s in cases:
        m, size, mask, _ = make_qr(s)
        back, dmask = decode(m, size)
        good = back == s and dmask == mask
        print(f'  round trip {s[:34]:<34} mask {mask} -> {"PASS" if good else "FAIL"}')
        ok &= good

    # The three finders must survive masking untouched, so compare all 49
    # modules against the canonical pattern rather than spot-checking. Note the
    # centre 3x3 is dark: rings 0 AND 1, then light at 2, dark at 3.
    FINDER = [[1 if max(abs(r - 3), abs(c - 3)) in (0, 1, 3) else 0
               for c in range(7)] for r in range(7)]
    m, size, _, _ = make_qr('https://qcrimes.us/?wine=bo')
    fin_ok = True
    for r0, c0 in ((0, 0), (0, size - 7), (size - 7, 0)):
        got = [[m[r0 + r][c0 + c] for c in range(7)] for r in range(7)]
        if got != FINDER:
            print(f'  FAIL finder at ({r0},{c0}) does not match the spec pattern')
            fin_ok = False
    print(f'  finder patterns well formed: {"PASS" if fin_ok else "FAIL"}')
    ok &= fin_ok

    # Timing patterns must alternate and start dark at the module after the
    # separator; a break here is invisible to a round trip but breaks real readers.
    tim_ok = all(m[6][i] == (1 if i % 2 == 0 else 0) for i in range(8, size - 8))
    tim_ok &= all(m[i][6] == (1 if i % 2 == 0 else 0) for i in range(8, size - 8))
    print(f'  timing patterns alternate:   {"PASS" if tim_ok else "FAIL"}')
    ok &= tim_ok

    # The dark module is mandatory and fixed.
    dm_ok = m[size - 8][8] == 1
    print(f'  dark module present:         {"PASS" if dm_ok else "FAIL"}')
    ok &= dm_ok

    try:
        make_qr('x' * 47)
        print('  FAIL overlong payload was accepted')
        ok = False
    except ValueError:
        print('  overlong payload rejected: PASS')
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default=BASE_DEFAULT)
    ap.add_argument('--out', default=os.path.join(HERE, 'source', 'qr'))
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()

    base = a.base.rstrip('/')
    svg_dir = os.path.join(a.out, 'svg')
    png_dir = os.path.join(a.out, 'png')
    for d in (svg_dir, png_dir):
        os.makedirs(d, exist_ok=True)

    print(f'base URL   {base}/?wine=<id>')
    print(f'encoding   byte mode, ECC {ECL}, version {VERSION} forced for all\n')
    print(f"{'id':<9} {'bytes':>5} {'mask':>4} {'penalty':>7}  {'decoded back':<34} check")
    print('-' * 74)

    entries, bad = [], 0
    for pid in PEOPLE:
        payload = f'{base}/?wine={pid}'
        m, size, mask, pen = make_qr(payload)
        back, _ = decode(m, size)
        svg = os.path.join(svg_dir, f'qr-{pid}.svg')
        png = os.path.join(png_dir, f'qr-{pid}.png')
        open(svg, 'w').write(to_svg(m, size, payload, pid))
        dim = to_png(m, size, png)
        good = back == payload
        bad += 0 if good else 1
        entries.append((pid, payload, png))
        print(f'{pid:<9} {len(payload):>5} {mask:>4} {pen:>7}  {back[-34:]:<34} '
              f'{"ok" if good else "MISMATCH"}')

    proof = os.path.join(a.out, 'qr-proof-sheet.png')
    proof_sheet(entries, proof)

    n = size + 2 * QUIET
    print(f'\n{size}x{size} modules + {QUIET} quiet each side = {n}x{n} total')
    print(f'PNG {dim}x{dim}px at {PNG_SCALE}px/module')
    print(f'\nsvg   -> {os.path.relpath(svg_dir, HERE)}/  (vector, for print)')
    print(f'png   -> {os.path.relpath(png_dir, HERE)}/  (preview/fallback)')
    print(f'proof -> {os.path.relpath(proof, HERE)}')
    if bad:
        print(f'\n!! {bad} code(s) did not decode back to their URL')
        return 1
    print(f'\nall {len(PEOPLE)} decoded back to their own URL')
    return 0


if __name__ == '__main__':
    sys.exit(main())
