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
    target: { w: 484, h: 1200 },

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

      // Fade the outer edge of the video plane to transparent, in label-width
      // units. Softens the boundary against the static label underneath so a
      // small misalignment doesn't read as a hard rectangle. 0 disables.
      feather: 0.03,
    },

    // Static label image drawn behind the video, covering the whole target.
    // This is what makes the seam land between two textures we control rather
    // than between the video and the physical label under unknown lighting.
    still: 'label.jpg',

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
