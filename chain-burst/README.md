# Chain Burst / 연쇄 폭발

**The fun:** one small tap unexpectedly spreads across the field.

Static HTML, CSS and Canvas 2D. No build, dependencies, images or server required.
Open through a local HTTP server, or open `index.html` directly.

## Rules

- Three rounds with 40, 48 and 56 randomly moving lights.
- Aim once within 8 seconds. No tap means that round scores zero.
- The initial wave triggers nearby lights. Each light explodes once, after a short fuse.
- Golden relays spread farther and last longer. The first wave to touch a light determines its chain depth.
- Normal lights score 100; golden lights score 180. Add 40 for each depth beyond the first, capped at depth 8.
- Each round lasts at most 20 active seconds. Result screens and pauses do not count. Switching tabs pauses the game.
- Tap/click to fire, or use arrow keys and Space/Enter. Escape pauses. Free replays, browser-local best score and shared result text.

## Files and verification

- `engine.js`: fixed-step simulation, usable from both Node and the browser.
- `game.js`: rendering, sound, input, round flow, common GameStats/GameShare integration.
- `style.css` / `index.html`: responsive UI.
- `engine.test.cjs`: propagation, single-use shot, gold relays, timeout, score invariants, frame-rate independence and seeded random rounds.

Run `node --test static/games/chain-burst/engine.test.cjs` from the Blog root (or `node --test chain-burst/engine.test.cjs` from the games repository).

Hub registration: `../games.js`. Deployment follows the existing games submodule and Blog GitHub Pages workflow.
