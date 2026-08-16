// One entry per wine. Adding a wine means adding an entry here and dropping three
// files into assets/<id>/ — no changes to app.js. See README.md for the full recipe.
//
// The key is the URL id: ?wine=19-crimes-cabernet, which is what each bottle's QR
// code encodes. Keep keys lowercase-kebab and stable: reprinting labels because an
// id changed is not a mistake you want to make twice.

export const WINES = {

  '19-crimes-cabernet': {
    name: '19 Crimes',
    variant: 'Cabernet Sauvignon',

    // Pixel dimensions of the image that was compiled into targets.mind.
    // MindAR normalises a target to 1 unit wide, so this is what sets the
    // label plane's aspect. Getting it wrong stretches everything.
    //
    // chordMm is how wide that same region reads straight across the front of the
    // bottle — a ruler laid flat, not a tape following the curve. Together with
    // bottle.diameterMm it derives `curve` exactly, so no one has to re-guess it.
    // Here: the target covers 83.8% of a label that reaches the bottle's
    // silhouette, so 0.838 x 76mm.
    target: { w: 484, h: 1200, chordMm: 63.6 },

    // Standard 750ml Bordeaux.
    bottle: { diameterMm: 76 },

    video: {
      file: 'avatar.mp4',

      // Sub-rectangle of the video frame to actually show, in 0..1 UV space.
      // Generators pillarbox their output; this crops it at render time so the
      // file never has to be re-encoded. Full frame is {x:0, y:0, w:1, h:1}.
      //
      // Measured content for this clip is x 263..946 of 1280. It is cropped in
      // tighter than that on purpose: narrowing the width raises the plane's
      // height for a given width, which is what lets the video reach the bottom
      // of the label. The small y crop removes the video's own copy of the
      // torn-paper edge, which would otherwise appear twice.
      crop: { x: 0.2431, y: 0.04, w: 0.4585, h: 0.96 },

      // Placement on the label plane, in label-width units, origin at label centre,
      // +y up. `w` is the video plane's width; its height is derived from the
      // cropped aspect so the picture is never stretched.
      //
      // y is set so the video's torn edge lands on the printed one at y = -0.062.
      // Tune live with ?tune=1 rather than by editing and redeploying.
      place: { x: 0, y: -0.566, w: 1.0 },

      // Edge fade widths, in label-width units. Accepts a scalar, {top, side,
      // bottom}, or {top, right, bottom, left}. 0 on an edge disables it.
      //
      // The edges are not equivalent. The top lands on the printed torn-paper
      // edge, which is already an irregular high-contrast boundary — fading it
      // hard only blurs a join that reads fine crisp. The sides and bottom cut
      // across flat dark tone with nothing to hide behind, so they need to
      // dissolve. Hence three different numbers rather than one.
      feather: { top: 0.01, side: 0.05, bottom: 0.09 },
    },

    // Live exposure and white-balance match against the camera feed, so the clip's
    // baked-in lighting follows the room instead of fighting it. Omit to accept
    // these defaults; ?match=0 disables, ?gain=N pins a fixed value.
    // match: { color: 0.6, min: 0.55, max: 1.8, smoothing: 0.12 },

    // Half-arc angle the panel wraps, in degrees; 0 is flat. Omitted here because
    // target.chordMm and bottle.diameterMm derive it (~57° for this bottle).
    // Set explicitly, or pass ?curve=NN, to override.
    // curve: 57,

    // Static label image drawn behind the video, covering the whole target.
    // OFF (null) by default. It was on initially to control the seam, but the
    // physical label is already there, correctly lit and correctly curved, and
    // covering it with a flat photo of itself looked worse than the seam it was
    // avoiding. Set to 'label.jpg' to re-enable if a video's edge won't sit
    // quietly against the real label.
    still: null,

    // Per-label tracker tuning. Omit to use the app defaults.
    // tracking: { filterMinCF: 0.0001, filterBeta: 0.001, missTolerance: 5 },
  },

}

export const DEFAULT_TRACKING = {
  filterMinCF: 0.0001,
  filterBeta: 0.001,
  missTolerance: 5,
  warmupTolerance: 5,
}
