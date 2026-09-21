# QR codes for the talking wine labels — artwork spec

Thirteen QR codes, one per bottle. Each one opens that person's talking label.

**Use the files in `svg/`.** They are vector: scale them to whatever size the layout
needs and they stay perfectly sharp. `png/` is a 1230 × 1230 px preview and a
fallback only — please don't send PNGs to the printer.

---

## Which code goes on which bottle

This is the part that matters most. A swapped code puts the wrong person on the
wrong bottle, and it cannot be fixed after printing.

| File | Bottle | Opens |
|---|---|---|
| `qr-jacqui.svg` | Jacqui | qcrimes.us/?wine=jacqui |
| `qr-james.svg` | James | qcrimes.us/?wine=james |
| `qr-seth.svg` | Seth | qcrimes.us/?wine=seth |
| `qr-kyle.svg` | Kyle | qcrimes.us/?wine=kyle |
| `qr-scot.svg` | Scot | qcrimes.us/?wine=scot |
| `qr-julie.svg` | Julie | qcrimes.us/?wine=julie |
| `qr-bo.svg` | Bo | qcrimes.us/?wine=bo |
| `qr-dan.svg` | Dan | qcrimes.us/?wine=dan |
| `qr-jayshree.svg` | Jayshree | qcrimes.us/?wine=jayshree |
| `qr-jeff.svg` | Jeff | qcrimes.us/?wine=jeff |
| `qr-karl.svg` | Karl | qcrimes.us/?wine=karl |
| `qr-duke.svg` | Duke | qcrimes.us/?wine=duke |
| `qr-loren.svg` | Loren | qcrimes.us/?wine=loren |

`qr-proof-sheet.png` shows all thirteen side by side with their names. Worth a
glance once they're placed, to confirm nothing got shuffled.

---

## Size

**Minimum 20 mm square. 22–25 mm is the comfortable range.**

Every code is 33 × 33 modules with a mandatory 4-module clear margin, so 41 × 41
units square overall. That means:

| Printed size | Module size |
|---|---|
| 15 mm | 0.37 mm — too tight, avoid |
| 20 mm | 0.49 mm — minimum |
| 22 mm | 0.54 mm — recommended |
| 25 mm | 0.61 mm — comfortable |
| 30 mm | 0.73 mm — fine, but see below |

**Resist going large.** The label wraps a 76 mm bottle, so a wide code curves away
from the camera and the outer columns compress:

| Printed size | Arc it wraps | Outer modules squeezed to |
|---|---|---|
| 22 mm | 34° | 96% |
| 30 mm | 47° | 92% |
| 40 mm | 64° | 85% |

Readers cope with the small numbers and struggle with the big ones. 22–25 mm near
the label's horizontal centre — where the curve is flattest — scans best.

---

## Rules

**Keep the clear margin.** The white border is part of the file and is already the
spec minimum. Nothing may sit inside it — no rules, no text, no artwork, no
label edge. This is the single most common reason a printed code fails to scan.

**Keep it square.** Scale proportionally. Any horizontal or vertical stretch
breaks it.

**Black on light.** The files are pure black on white. Deep ink on the cream paper
is fine. Please don't:

- invert it (light modules on dark) — many phone readers reject that
- use a mid-tone, a tint under ~60% black, or a gradient
- put a logo or initials in the middle
- round the module corners, add a drop shadow, outline, or texture
- rotate by anything other than 90° increments

The white background rectangle can be deleted if you're placing the code onto the
cream paper and prefer the stock to show through — just keep the margin area
clear and light.

**Please don't regenerate these.** They aren't generic codes; they're built and
individually verified against the live site. If a URL needs to change, ask for new
files rather than making them in Illustrator or from a QR website.

---

## Before the print run

**Scan each of the thirteen from a proof, with a phone, off curved stock.** Tape a
proof around a bottle and try it. That is the only test that counts, and it takes
five minutes. A code that scans flat on a desk can still fail wrapped.

---

## Also outstanding

The label artwork is currently exactly trim size — 3.5 in × 5.75 in — with **no
bleed**. If the printer wants the usual ⅛ in, the artwork needs to extend past
trim on all four sides, and the current files don't provide it. Worth settling
with the printer before the run.

---

### Technical detail, if anyone asks

QR model 2, version 4 (33 × 33 modules), byte mode, error correction level Q
(25% recoverable), 4-module quiet zone. All thirteen are deliberately the same
version, so they are geometrically identical — one placement works for every
label. Each file was decoded back to its own URL and cross-checked with an
independent reader at three rasterisation sizes before being sent.
