Product Requirements Document (PRD)
Project: WebAR "Talking Wine Label" Experience

0. Amendments since first draft
* Scope: the app serves MANY wines (~12), not one. Each bottle's QR encodes
  ?wine=<id>; the manifest in wines.js maps that to a per-wine asset folder. One
  single-target .mind per label, not one combined multi-target file — detection stays
  fast, downloads stay small, and a new label cannot regress existing ones.
* Task 2 (chroma key) is superseded. See below.
* Directory: the app lives in /webar-wine-label, which is also the Vercel root.
* Feasibility was confirmed before building: the 19 Crimes label holds 99.6% lock
  through handheld rotation on a phone. Harness kept in webar-wine-label/spike.

1. Project Overview
We are building a Web-based Augmented Reality (WebAR) application that replicates the "19 Crimes" talking wine bottle experience. When a user scans a QR code on a physical wine bottle, they are taken to a web app. Upon pointing their phone camera at the wine bottle's label, a video of a character seamlessly overlays onto the physical label, animating and talking while tracking the bottle's movement in 3D space.

2. User Flow
1. Trigger: User scans a standard QR code printed on the bottle using their native phone camera.
2. Access: User is redirected to a mobile web browser (HTTPS required).
3. Permissions: The web app requests camera access.
4. Instruction: UI prompts the user to "Tap the screen to start" (required to bypass browser auto-play media policies) and "Point camera at the wine label."
5. AR Experience: The camera recognizes the target image (the label). A transparent video (or green-screen keyed video) starts playing exactly over the physical label, tracking the bottle's physical movements.

3. Technical Stack
* Frontend: HTML5, CSS3, Vanilla JavaScript.
* AR Engine: MindAR (specifically mind-ar-js for A-Frame) - Open source image tracking.
* 3D Framework: A-Frame (HTML-based declarative 3D framework).
* Video Handling: MP4 video with a green screen background, utilizing a custom WebGL/A-Frame shader to key out the green and render the video transparently over the bottle. (Note: WebM with alpha channel is natively supported on some browsers, but chromakey shaders on MP4s offer the most robust cross-platform compatibility for iOS/Android WebAR).

4. Asset Requirements (To be provided by the human user)

4a. Runtime assets (deployed, live in /assets):
1. targets.mind - The compiled tracking file of the label. This is the only tracking
   artifact the app loads at runtime.
2. avatar.mp4 - A video of the character talking, filmed against a solid green
   screen (#00FF00).

4b. Source assets (NOT deployed, live in /source):
3. label.jpg - A flat, high-contrast image of the physical wine label. This is input
   to the MindAR compiler only; the app never loads it. Keep it in the repo for
   reproducibility so targets.mind can be regenerated.
   (Human instruction: Go to the MindAR Image Compiler web tool, upload label.jpg,
   and download the .mind file as targets.mind.)

Note on multi-angle targets: a single flat photo of a curved bottle label often
tracks poorly. targets.mind may instead be compiled from 3-5 photos of the label
shot at different angles, producing target indices 0..N-1 that all map to the same
video. See Task 1.

5. Directory Structure for Claude Code
Please scaffold the project using the following structure:
/webar-wine-label
  ├── index.html        # Main A-Frame/MindAR scene
  ├── style.css         # UI overlays (loading screens, prompts)
  ├── app.js            # Video playback logic, AR event listeners
  ├── chromakey.js      # Custom A-Frame shader component for green-screen removal
  ├── /assets           # Deployed runtime assets
  │   ├── targets.mind  # Compiled MindAR image target(s)
  │   └── avatar.mp4    # Green screen video asset
  └── /source           # Not deployed; compiler inputs kept for reproducibility
      └── label.jpg     # Flat photo of the label, input to the MindAR compiler

6. Implementation Tasks for Claude Code

Task 1: Scaffold the HTML & AR Scene
* Create index.html and import the required CDN scripts for A-Frame and MindAR-AFrame.
  Pin both versions exactly. mind-ar-js is version-sensitive; an unpinned "latest"
  A-Frame is a known cause of a silently blank scene.
* Set up the <a-scene> with the mindar-image system. Point the imageTargetSrc to ./assets/targets.mind.
* Set up the <a-camera> and one <a-entity mindar-image-target="targetIndex: N"> per
  target compiled into targets.mind. If multi-angle targets are used, every index
  renders the same video plane.
* Ensure the video element (assets/avatar.mp4) is preloaded in the <a-assets> tag.

Task 2: SUPERSEDED — no chroma key needed
* Original plan: film a character against a green screen and key it out in a shader.
* The video is generated from the label image rather than filmed, so there is no real
  background to remove and the green screen serves no purpose.
* Replaced by a two-plane composite: a static label.jpg plane covering the whole target,
  with the video plane in front of it. Both are textures the app controls, so the seam
  never has to survive a brightness match against the physical label under room light.
* This also removes the approach's worst failure mode: H.264 stores colour at quarter
  resolution, so keyed edges fringe badly and no shader recovers it.
* A small shader is still used, but only for UV cropping (generators pillarbox their
  output) and an edge feather — not for keying.

Task 3: Handle Interaction & Audio Policies (app.js)
* Modern mobile browsers block audio-enabled video from auto-playing.
* Create a full-screen UI overlay in style.css that says "Tap to Begin AR Experience".
* In app.js, add an event listener to the UI overlay. On tap, hide the UI, execute video.play(), and initialize the AR camera.
* Add MindAR event listeners: 
  * targetFound: Ensure the video plays and becomes visible.
  * targetLost: Pause the video so the user doesn't miss the dialogue if they move the phone away.

Task 4: UI/UX Polish
* Add a scanning reticle or instructional UI overlay telling the user to "Align the label within the frame" while the AR engine searches for the target.
* Ensure the UI is mobile-responsive and handles different aspect ratios.

Task 5: Local Development Server Setup
* Camera access in browsers strictly requires HTTPS or localhost.
* Please generate a simple Node.js server.js using Express, or provide instructions/scripts in package.json to run a local HTTPS server (e.g., using vite --host with basic SSL certs or http-server -S -C cert.pem).