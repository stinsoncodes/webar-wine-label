// Pure geometry helpers, kept out of app.js so they can be exercised without a
// browser: app.js registers A-Frame components at module scope, so importing it
// outside a page is not possible. These two functions carry the bottle maths and
// the one piece of manifest shorthand, which is exactly what is worth testing.
//
// See tests/geometry.test.mjs (run with `node --test tests/`).

// Half-arc angle, in degrees, that a chord of `chordMm` subtends on a cylinder of
// `diameterMm`. Lets a manifest state the two things that are actually measurable
// about a bottle rather than a magic angle nobody can re-derive later.
export function curveFromBottle (chordMm, diameterMm) {
  if (!chordMm || !diameterMm) return 0
  const s = (chordMm / 2) / (diameterMm / 2)
  if (!(s > 0)) return 0
  if (s > 1.001) {
    console.warn(`chordMm ${chordMm} exceeds bottle diameter ${diameterMm}; curve disabled`)
    return 0
  }
  // s == 1 is a label wrapping exactly to the silhouette — real, and 90deg is the
  // right answer. Clamp just below to keep asin and the 1/sin in the geometry finite.
  return Math.asin(Math.min(s, 0.9999)) * 180 / Math.PI
}

// `feather` may be a scalar, {top, side, bottom}, or {top, right, bottom, left}.
// Always returns all four, in label-width units, CSS order.
export function normaliseFeather (f) {
  if (typeof f === 'number') return { top: f, right: f, bottom: f, left: f }
  if (!f) return { top: 0, right: 0, bottom: 0, left: 0 }
  const side = f.side ?? 0
  return {
    top:    f.top    ?? 0,
    right:  f.right  ?? side,
    bottom: f.bottom ?? 0,
    left:   f.left   ?? side,
  }
}
