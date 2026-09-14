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
//   chord, of which the target keeps the central 83.8% = 58.6mm -> curve 50.5deg.
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

  // The original store-bought bottle, kept as a working reference target.
  '19-crimes-cabernet': {
    name: '19 Crimes',
    variant: 'Cabernet Sauvignon',
    // Compiled from a photograph of the curved bottle, so the cylindrical
    // projection is already baked in. chordMm corrected from 63.6 — see the note
    // in SHARED_LABEL; the original assumed the label reached the silhouette.
    target: { w: 484, h: 1200, chordMm: 58.6 },
    bottle: { diameterMm: 76 },
    feather: { top: 0.01, side: 0.05, bottom: 0.09 },
  },

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
// `video: null` means the clip does not exist yet. Such a character still appears
// in the selector, greyed out, rather than vanishing — so it is obvious what is
// pending rather than looking like a bug.
//
// crop  — sub-rectangle of the video frame to show, 0..1. HeyGen returns 16:9 or
//         9:16 whatever you feed it, so every clip arrives padded; this trims it
//         at render time and the file never needs re-encoding.
// place — where the panel sits on the label, in label-width units, origin at the
//         label centre, +y up. Its height is derived from the cropped aspect, so
//         the picture can never stretch; to make the panel taller, narrow the crop.
//
// Both belong to the video, not the label. They do NOT have to match across
// characters — each clip just has to say where it sits in label coordinates.
// Tune with ?wine=<id>&tune=1 and paste back with Copy manifest.

export const CHARACTERS = {

  '19-crimes-cabernet': {
    name: 'Michael McPhearson',
    video: {
      file: 'avatar.mp4',
      crop:  { x: 0.2431, y: 0.04, w: 0.4585, h: 0.96 },
      place: { x: 0, y: -0.566, w: 1.0 },
    },
  },

  jacqui:   { name: 'Jacqui',   video: null },
  james:    { name: 'James',    video: null },
  seth:     { name: 'Seth',     video: null },
  kyle:     { name: 'Kyle',     video: null },
  scot:     { name: 'Scot',     video: null },
  julie:    { name: 'Julie',    video: null },
  bo:       { name: 'Bo',       video: null },
  dan:      { name: 'Dan',      video: null },
  jayshree: { name: 'Jayshree', video: null },
  jeff:     { name: 'Jeff',     video: null },
  karl:     { name: 'Karl',     video: null },
  duke:     { name: 'Duke',     video: null },
  loren:    { name: 'Loren',    video: null },

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
