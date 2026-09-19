// Two tables, not one, because a bottle and a character are separate things.
//
//   LABELS      what can be TRACKED — one per physical label design
//   CHARACTERS  what can be PLAYED  — one per person
//
// A QR code encodes only ?wine=<label>. The cast selector adds ?as=<character>.
// That split is what lets you hold Jacqui's bottle and watch Loren talk.
//
// It works because the label template is pixel-identical across all 13 —
// torn edge, crest, wordmark and copy at the same coordinates on every slide, with
// only the portrait differing. So one geometry serves every label, and a
// character's `crop`/`place` are valid on any bottle. Had the template shifted per
// slide, every label x character pair would have needed its own alignment: 169
// passes instead of 13.
//
// Ids are baked into printed QR codes. Never change one.
//
// Keep this file free of surnames and of any employer or organisation name: it is
// served verbatim to anyone who opens the site. First names only.

// ---------------------------------------------------------------------------
// Shared geometry for the 13 personalised labels
// ---------------------------------------------------------------------------

// target: pixel size of the image compiled into targets.mind. MindAR normalises a
//   target to 1 unit wide, so this ratio sets the label plane's aspect — a wrong
//   value stretches everything.
// chordMm: how wide that region reads straight across the bottle front (a ruler
//   laid flat, not a tape following the curve). With bottle.diameterMm it derives
//   `curve` exactly — see tools/warp-targets.py, which prints both.
//   3.5in of label is an 88.9mm arc wrapping 134deg of a 76mm bottle: a 69.97mm
//   chord, of which the target keeps the central 83.8% = 58.6mm -> curve 50.45deg.
const SHARED_LABEL = {
  variant: 'Special Edition',
  target: { w: 500, h: 1246, chordMm: 58.6 },
  bottle: { diameterMm: 76 },

  // Edge fade widths in label-width units; a scalar, {top, side, bottom}, or all
  // four. The edges are not equivalent: the top lands on the printed torn-paper
  // edge, an irregular high-contrast boundary that reads fine crisp, while the
  // sides and bottom cut across flat dark tone and need to dissolve.
  // A character may override this.
  feather: { top: 0.01, side: 0.05, bottom: 0.09 },
}

export const LABELS = {

  jacqui:   { name: 'Jacqui',   ...SHARED_LABEL },
  james:    { name: 'James',    ...SHARED_LABEL },
  seth:     { name: 'Seth',     ...SHARED_LABEL },
  kyle:     { name: 'Kyle',     ...SHARED_LABEL },
  scot:     { name: 'Scot',     ...SHARED_LABEL },
  julie:    { name: 'Julie',    ...SHARED_LABEL },
  bo:       { name: 'Bo',       ...SHARED_LABEL },
  dan:      { name: 'Dan',      ...SHARED_LABEL },
  jayshree: { name: 'Jayshree', ...SHARED_LABEL },
  jeff:     { name: 'Jeff',     ...SHARED_LABEL },
  karl:     { name: 'Karl',     ...SHARED_LABEL },
  duke:     { name: 'Duke',     ...SHARED_LABEL },
  loren:    { name: 'Loren',    ...SHARED_LABEL },

}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------
//
// crop  — sub-rectangle of the video frame to show, 0..1. The generator returns
//         16:9 or 9:16 whatever you feed it, so every clip arrives padded; this
//         trims it at render time and the file never needs re-encoding.
// place — where the panel sits on the label, in label-width units, origin at the
//         label centre, +y up. Its height is derived from the cropped aspect, so
//         the picture can never stretch; to make the panel taller, narrow the crop.
//
// Both belong to the video, not the label, and they do NOT have to match across
// characters — each clip just has to say where it sits in label coordinates. It
// happens that all 13 share one set, because all 13 were generated the same way:
//
// SHARED_CLIP is not a lucky coincidence but a consequence of the pipeline. Every
// clip was generated from source/heygen/face/<id>.png, which tools/prepare-labels.py
// cuts at the same fractions of every label, and the generator returned all 13 at
// 1920x1080 with the portrait pillarboxed into the identical 900px-wide column.
// Measured, not assumed: the white bars sit at columns 510..1410 in all 13, and
// each clip cross-correlates against its own label master at NCC 0.88..0.98,
// agreeing with the numbers below to within 0.5mm of arc. If a future clip is
// generated any other way, give it its own crop/place rather than editing these.
//
// place.w is the panel's CHORD width. A clip generated from flat label artwork is
// linear in arc length, so the shader unwarps it onto the curved panel and derives
// the panel height from the arc rather than the chord — without that the picture
// stretches at the edges and the panel sits ~5% short. Set flatSource: false on a
// clip that is already projected, or pass ?unwarp=0 to compare.
// Tune with ?wine=<id>&tune=1 and paste back with Copy manifest.
const SHARED_CLIP = {
  // The generator's white pillarbox bars, trimmed. 510/1920 and 900/1920.
  crop: { x: 0.265625, y: 0, w: 0.46875, h: 1 },

  // Derived from the crop tools/prepare-labels.py takes, not eyeballed. The face
  // input is master pixels x 239..1463 of 1800 and y 1486..2957 of 2957, i.e.
  // label fractions x 0.132778..0.812778, y 0.502536..1. Projecting those onto a
  // 76mm bottle (x = R*sin(a/R), R = 38mm, 88.9mm of arc across the label) and
  // dividing by the target's 58.6mm chord gives the panel's chord span and centre.
  place: { x: -0.0289, y: -0.6262, w: 0.9243 },

  // Wider panel than the label's default assumes, so the shared 0.05 side fade
  // would cover proportionally less of it — and these edges cut across uniform
  // wall with nothing to hide behind.
  feather: { top: 0.01, side: 0.09, bottom: 0.09 },
}

export const CHARACTERS = {

  jacqui:   { name: 'Jacqui',   video: { file: 'Jacqui_1080p.mp4',   ...SHARED_CLIP } },
  james:    { name: 'James',    video: { file: 'James_1080p.mp4',    ...SHARED_CLIP } },
  seth:     { name: 'Seth',     video: { file: 'Seth_1080p.mp4',     ...SHARED_CLIP } },
  kyle:     { name: 'Kyle',     video: { file: 'Kyle_1080p.mp4',     ...SHARED_CLIP } },
  scot:     { name: 'Scot',     video: { file: 'Scot_1080p.mp4',     ...SHARED_CLIP } },
  julie:    { name: 'Julie',    video: { file: 'Julie_1080p.mp4',    ...SHARED_CLIP } },
  bo:       { name: 'Bo',       video: { file: 'bo-landscape.mp4',   ...SHARED_CLIP } },
  dan:      { name: 'Dan',      video: { file: 'Dan_1080p.mp4',      ...SHARED_CLIP } },
  jayshree: { name: 'Jayshree', video: { file: 'Jayshree_1080p.mp4', ...SHARED_CLIP } },
  jeff:     { name: 'Jeff',     video: { file: 'Jeff_1080p.mp4',     ...SHARED_CLIP } },
  karl:     { name: 'Karl',     video: { file: 'Karl_1080p.mp4',     ...SHARED_CLIP } },
  duke:     { name: 'Duke',     video: { file: 'Duke_1080p.mp4',     ...SHARED_CLIP } },
  loren:    { name: 'Loren',    video: { file: 'Loren_1080p.mp4',    ...SHARED_CLIP } },

  // A character with `video: null` still appears in the selector, greyed out and
  // labelled "no clip yet", rather than vanishing — so a missing file reads as
  // pending rather than as a bug.
  //
  // Set castVisible: false on anyone who would rather not appear in everyone
  // else's selector. Their own QR still works.

}

// Live exposure and white-balance match against the camera feed, so a clip's baked
// lighting follows the room instead of fighting it. ?match=0 disables,
// ?gain=N pins a fixed value.
export const DEFAULT_MATCH = {
  enabled: true,
  color: 0.6,
  min: 0.55,
  max: 1.8,
  smoothing: 0.12,
  intervalMs: 120,
  sampleFrac: 0.55,
}

export const DEFAULT_TRACKING = {
  filterMinCF: 0.0001,
  filterBeta: 0.001,
  missTolerance: 5,
  warmupTolerance: 5,
}
