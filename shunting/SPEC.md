# 조차장 / SHUNTING YARD — Master Spec (v1)

> **Read this file completely before writing a single line.** Every module is built by a
> different agent working in parallel. The contracts below are law. If you need a contract
> that does not exist, add it to *your own* module's public API and document it in a
> `/* CONTRACT */` comment block at the top of your file — never edit another agent's file.

---

## 0. What we are building

A **browser puzzle game**: a miniature railway shunting yard, rendered as a **floating
diorama island** in stylized 3D. The player rearranges freight wagons using a shunting
locomotive and a small set of dead-end sidings, to assemble a train in a required order.

**The quality bar is `oskarstalberg.com/Townscaper` and `krunker.io`.** A reviewer will put
our screenshot next to theirs and pick the better-looking one. Ours must win or tie.
"It's a browser game" is not an excuse for anything.

Target: `static/games/shunting/` in the AI Game Lab (`https://junstellar.github.io/games/`).

---

## 1. Hard constraints

| Rule | Detail |
|---|---|
| **No build step** | Plain classic `<script>` tags. No modules, no bundler, no npm, no JSX. |
| **No network at runtime** | No CDN, no fonts, no external images. Everything self-contained in this folder. |
| **No binary assets** | All textures/geometry/audio are **generated procedurally in code**. No .png/.jpg/.mp3 checked in. (Exception: none.) |
| **One dependency** | `vendor/three.min.js` (Three.js r160.1 UMD, already vendored). `THREE` is a global. |
| **Shared chrome** | Link `../shared.css`, `../share.js`, `../stats.js` like the other games. `GAME_ID = 'shunting'`. |
| **Language** | All player-visible text is **Korean**. Code comments Korean or English, your call. |
| **Mobile first** | Must be playable one-handed in portrait on a phone, and look great on desktop. |
| **Perf** | 60fps on a mid laptop at 1080p; ≥30fps on a 3-year-old phone via automatic quality tiers. |
| **ES5-safe-ish** | Use `var`/`let`/`const`, arrow functions, template literals, `class` — all fine (modern browsers only). Do **not** use `import`/`export`. |

---

## 2. Game rules (this is the whole game — do not invent extra rules)

### 2.1 The yard

Tracks are **stacks**, all opening to the **west** (left). The east end of every siding has a
buffer stop. The locomotive is **always at the west end of its consist**.

```
                     ┌──── S1 (siding, cap 3) ────────┤▌
   HEAD ─────┐       ├──── S2 (siding, cap 3) ────────┤▌
 (headshunt) ├─ throat ─── S3 (siding, cap 3) ────────┤▌
   cap 3+loco┘       └──── EXIT (departure road) ─────┤▌
```

### 2.2 State

```
state = {
  tracks: { HEAD:[...], S1:[...], S2:[...], S3:[...], EXIT:[...] },  // wagon ids, WEST→EAST
  at:      'S1',        // which track the loco is standing on
  consist: [...],       // wagon ids coupled to the loco, WEST→EAST (loco is west of consist[0])
  moves:   0
}
```
Physical arrangement on track `at` is `[LOCO, ...consist, ...tracks[at]]`.

### 2.3 The only two player actions

**`go(t)` — send the loco to track `t`.** Costs **1 move**.
- The loco pulls its consist west out of the current track onto the headshunt, reverses at
  the throat, and propels east into `t`.
- On arrival, the consist's east end contacts `tracks[t]`'s west end and **couples to
  everything standing there**:
  `consist = consist ++ tracks[t]; tracks[t] = []`
- **Legal only if** `1 + consist.length <= cap(HEAD)` (the whole cut must clear the throat)
  **and** `1 + consist.length + tracks[t].length <= cap(t)`.
- `go(at)` is illegal (already there).

**`cut(k)` — uncouple, keeping `k` wagons.** **Free** (0 moves). Only while stationary.
- `tracks[at] = consist.slice(k) ++ tracks[at]; consist = consist.slice(0, k)`
- `k` ranges `0 .. consist.length - 1`. `cut(0)` drops everything.

That is the entire rule set. Depth comes from the LIFO stacks + the headshunt capacity.

### 2.4 Win condition

`tracks.EXIT` deep-equals the level's `target` array (west→east), `consist` is empty, and
`at !== 'EXIT'` (the loco has run round and is clear of the departure road).

### 2.5 Scoring

- **Moves used vs `par`** (par = BFS-optimal `go` count).
- ★★★ = `moves <= par` · ★★ = `moves <= par + 2` · ★ = finished at all.
- Stars, best move count and completion are persisted per level in `localStorage`.
- On finishing a level: `GameStats.record('shunting', {score: starsEarnedTotal})`.

---

## 3. Art direction (non-negotiable — this is what wins the blind test)

### 3.1 The one big idea

**A floating diorama island.** The yard sits on a chunk of earth torn out of the world,
hanging in a soft gradient sky — grass and gravel on top, layered rock and hanging roots
underneath, gently bobbing. Narrow field of view (**22–26°**) from far away, so it reads as
a **miniature model**, not a first-person world. This is the Townscaper trick and it is why
Townscaper looks expensive.

### 3.2 Light

- **Golden hour.** One warm key (`#ffd9a0`, elevation ~28°, azimuth from the west-southwest),
  a cool sky fill from above (`#9fc4ff`), and a warm bounce from below (`#c98f5a`).
- **Soft shadows** are the single highest-value detail. PCF-soft, generous radius, tight
  ortho frustum around the island so texels are small. Contact shadows must be crisp where
  wheel meets rail and dissolve with distance.
- **IBL**: build a procedural sky-gradient environment map with `PMREMGenerator` at boot and
  assign it to `scene.environment`. Everything metallic depends on this.
- Tonemapping `ACESFilmicToneMapping`, `outputColorSpace = SRGBColorSpace`, exposure ~1.05.

### 3.3 Palette

| Role | Hex | Note |
|---|---|---|
| Ballast | `#8a7861` → `#5d5245` | warm grey gravel, dusty |
| Sleepers | `#4a3b2f` | creosoted timber, silvered on top faces |
| Rail web | `#6b5f57` rust · rail head `#cfc9c0` | polished crown only where wheels run |
| Grass | `#7d8f52` → `#5f7440` | dry olive, not video-game green |
| Cliff/soil | `#7a5c43` / strata `#8f7355`, `#63483a` | |
| Sky top | `#3f6fa8` · horizon `#f0c08a` | |
| Wagon liveries | oxide red `#9e3b2c` · mustard `#d99a26` · pine `#3f6b4e` · cobalt `#2f5d97` · cream `#d9cbb0` · slate `#4b5560` | high chroma, low value — like painted steel, not plastic |
| Loco | `#2b3440` body, `#d9a441` warning chevrons | |
| UI accent | `#d99a26` | matches `games.js` accent |

### 3.4 Materials — the difference between "good" and "AAA"

Every surface needs **three** things or it will read as a toy:
1. **Value break-up** at low frequency (large blotches, sun-bleaching, dirt gradient)
2. **Edge wear** — paint chipping to primer/rust on every convex edge (bake into the map by
   drawing along the UV edges, or use a cheap fresnel-driven rust blend in `onBeforeCompile`)
3. **Grime gradient** — dirt accumulates from the bottom up and in every crevice

Roughness must **vary spatially**. A constant roughness value is the #1 tell of amateur 3D.

### 3.5 Post-processing chain (custom, we write it)

`depth+normal prepass → SSAO → main (MSAA 4x) → bloom → composite`

- **SSAO** is mandatory. It is what makes Townscaper's crevices look soft and expensive.
  Half-res, 12–16 samples, radius ~0.6m, strong but not muddy; blur bilaterally.
- **Bloom**: threshold ~1.0, 5 mip levels down/up (Kawase-ish), tight and warm. Only the sun
  glints, lamp glass and rail crowns should bloom.
- **Composite**: ACES → vignette (subtle) → film grain (very subtle, animated) → chromatic
  aberration (edges only, ≤1.2px) → slight lift/gamma/gain grade toward teal shadows.

### 3.6 Motion (the game *feels* AAA here)

- Trains are **heavy**. Accelerate over ~1.2s, brake with a long tail, and **never** snap.
- **Slack action**: couplings have ~0.25m of free play. When the loco starts, the buffers
  compress and each wagon starts a beat after the one in front, running a small wave down the
  rake. When it stops, the wave runs back. This detail alone sells the weight.
- **Bogies** yaw to follow the rail tangent. **Wheels** rotate at the correct rate for their
  radius. **Bodies** roll slightly into curves and pitch under accel/brake on visible springs.
- **Coupling impact**: on contact, hit-stop 60ms, a small camera punch, a dust puff at the
  buffers, and a metallic clank.
- Camera drifts and re-frames smoothly; never teleports.

### 3.7 FX

Diesel exhaust (dark, dissipating), brake dust, dust kicked at the wheels, floating pollen
motes in the light, a lens-flare-free warm sun disc, birds crossing on a long timer, grass
that sways. Lamps come on in the dusk levels.

---

## 4. File layout & load order

```
static/games/shunting/
  index.html            ← shell: HUD, overlays, script tags IN THIS ORDER
  SPEC.md               ← this file
  vendor/three.min.js   ← THREE global (already present, do not modify)
  js/00-util.js         → SH.U, SH.Bus
  js/10-textures.js     → SH.Tex
  js/15-materials.js    → SH.Mat
  js/20-geometry.js     → SH.Geo
  js/25-world.js        → SH.World
  js/30-render.js       → SH.Render
  js/35-fx.js           → SH.FX
  js/40-audio.js        → SH.Audio
  js/50-puzzle.js       → SH.Puzzle
  js/55-levels.js       → SH.Levels
  js/60-motion.js       → SH.Motion
  js/70-input.js        → SH.Input
  js/80-ui.js           → SH.UI
  js/90-game.js         → SH.Game (boot)
```

`window.SH` is created by `00-util.js`. Every module does `SH.X = (function(){ ... })();`
**One agent owns one file.** Never edit a file you do not own.

---

## 5. Units & world space

- **Y is up.** 1 unit = 1 metre. Right-handed (Three.js default).
- Tracks run along **X**. West (the throat) is **−X**. East (buffer stops) is **+X**.
- Gauge **1.5**, sleeper length **2.6**, track centre spacing **5.0**.
- Wagon body length **12.0**, width **3.0**, height **3.4**, floor at **y=1.25**.
  Coupled pitch (centre to centre) **13.0**. Wheel radius **0.48**.
- Locomotive length **14.0**.
- Rail top surface is at **y = 0.30** (ballast shoulder 0, sleeper top 0.18, rail 0.12 tall).
- Island top surface at **y = 0**; the island slab extends down to about **y = −14**.
- The yard occupies roughly `x ∈ [−98, 62]`, `z ∈ [−7.5, 12.5]`.

**Track layout** (built by `25-world.js`, consumed by everyone):

| id | z | west end x | east end x | role |
|---|---|---|---|---|
| `HEAD` | 0.0 | −98 | −34 | headshunt, loco home |
| `EXIT` | −5.0 | −20 | 58 | departure road |
| `S1` | 2.5 | −16 | 56 | siding |
| `S2` | 7.5 | −12 | 54 | siding |
| `S3` | 12.5 | −8 | 52 | siding |

The throat is the region `x ∈ [−34, −8]` where turnouts ladder off the lead. Every track is
represented as a **`THREE.CurvePath`** so vehicles can be placed by arc-length; the throat
transitions use a 1:9-ish divergence built from two opposing circular arcs (a proper
turnout shape — no kinked polylines, ever).

---

## 6. Module contracts

Everything below is the **public API**. Keep internals private inside the IIFE.

### `SH.U` — utilities *(owned by: orchestrator, already written)*
```
U.clamp(v,a,b)  U.lerp(a,b,t)  U.smooth(t)  U.smootherstep(t)
U.damp(cur,tgt,lambda,dt)      U.ease.inOutCubic(t) / .outCubic / .outBack / .outElastic
U.rng(seed) -> ()=>[0,1)       U.randRange(rng,a,b)  U.pick(rng,arr)  U.shuffle(rng,arr)
U.hash(str)->int               U.col(hex)->THREE.Color   (sRGB-correct)
U.canvas(w,h)->{cv,ctx}        U.noise2D(seed)->(x,y)=>[-1,1]   (value/simplex-ish, tileable option)
U.fbm(noiseFn,x,y,oct,lac,gain)
SH.Bus.on(evt,fn) / .off / .emit(evt,payload)
```

### `SH.Tex` — procedural textures
```
Tex.build(quality)             // called once at boot; quality: 0 low | 1 med | 2 high
Tex.sets.<name> = { map, normalMap, roughnessMap, aoMap? }   // THREE.Texture, repeat preset
   names: ballast, sleeper, railSide, grass, cliff, soilTop, woodPlank, concrete,
          paintedSteel, rustSheet, tarpaulin, glassDirt, metalPlate, gravelFine
Tex.paint(hex, seed) -> { map, normalMap, roughnessMap }   // cached per (hex,seed): a painted
                        // steel sheet in that colour, with edge chipping, rust bleed,
                        // running dirt, subtle panel lines and a weld seam or two
Tex.decal(kind, opts) -> THREE.Texture   // 'number','hazard','logo','stencil'
Tex.skyGradient() -> THREE.Texture       // equirect for the environment
```
Rules: generate on `<canvas>`, `colorSpace = SRGBColorSpace` for colour maps and
`NoColorSpace`/linear for normal & roughness. Always set `anisotropy = 8` (clamped to the
renderer max, which `SH.Render.maxAniso` exposes; fall back to 4 if it is not up yet).
Derive normal maps from a height canvas via Sobel — write one shared helper and reuse it.
Budget: total texture build **< 400ms** on a laptop at quality 2. Cache aggressively.

### `SH.Mat` — materials
```
Mat.build()                    // after Tex.build()
Mat.ballast / .sleeper / .railHead / .railWeb / .grass / .cliff / .soil / .wood /
   .concrete / .metalDark / .glass / .rubber / .tarp / .lampGlass
Mat.paint(hex, seed) -> THREE.MeshStandardMaterial   // cached; uses Tex.paint
Mat.emissive(hex, strength) -> material
Mat.setQuality(q)              // drop normal maps / AO at q=0
```
Use `MeshStandardMaterial`. Where you need edge-wear or dirt-gradient beyond what the texture
gives, hook `onBeforeCompile` — keep the injected GLSL small and commented.

### `SH.Geo` — procedural geometry
```
Geo.track(curvePath, opts) -> THREE.Group     // rails (extruded profile), sleepers
                                              // (InstancedMesh), ballast shoulder
Geo.turnout(spec) -> THREE.Group              // point blades, frog, check rails, tie bar
Geo.bufferStop() -> THREE.Group
Geo.wagon(type, livery, seed) -> THREE.Group  // types below
Geo.loco(seed) -> THREE.Group
Geo.prop(name, seed) -> THREE.Object3D
   props: tree, bush, grassTuft, signal, lampPost, shed, waterTower, coalStage,
          fence, crate, oilDrum, sleeperStack, signBoard, weeds, puddle, birdFlock
Geo.island(bounds, seed) -> THREE.Group        // the floating slab: grass top, rock strata,
                                               // broken underside, hanging roots
```
**Vehicle contract.** Every `Geo.wagon`/`Geo.loco` returns a Group with
`group.userData.rig = { bogies:[Object3D,Object3D], wheels:[Object3D…], bodyPivot:Object3D,
buffers:{w:Object3D,e:Object3D}, couplers:{w:Object3D,e:Object3D}, length:Number,
exhaust:Object3D|null, lights:[Object3D] }`.
- `bogies` pivot in **Y** to follow the tangent; they sit at ±4.2 from the wagon centre.
- `wheels` spin about their local **X**.
- `bodyPivot` is what `SH.Motion` rolls/pitches; the shell hangs off it so springs read.
- `buffers.w/e` translate in local **X** for slack action (max 0.25).
- The group's **origin is the vehicle centre at rail level (y = 0.30)**.

**Wagon types** (all must look distinctly different in silhouette at a glance — silhouette is
how the player reads the puzzle):
`box` (closed van, sliding door), `open` (gondola with a coal/scrap load), `tank`
(cylindrical, walkway, ladder, dome), `flat` (with a strapped crate load), `hopper`
(sloped sides, discharge chutes), `brake` (short caboose w/ veranda, chimney, glazing).

Detail budget: a wagon should be **6k–14k tris**. Add rivets as normal-map detail, **not**
geometry, except on the silhouette (buffer heads, ladders, handrails, brake wheels — those
are geometry, because they break the silhouette and that is what reads at a distance).

### `SH.World` — scene assembly
```
World.build(scene, levelDef, seed) -> world
world = {
  tracks: Map<id, { id, kind, capacity, curve:THREE.CurvePath, length, group }>,
  vehicles: Map<vehId, { id, type, livery, group, rig, len }>,
  loco: {...same shape...},
  island, props, bounds:THREE.Box3
}
World.point(trackId, s) -> { pos:THREE.Vector3, tan:THREE.Vector3 }  // s = metres from west end
World.railPath(fromTrack, toTrack) -> { segs:[{track,from,to}], total }  // the physical
        // route incl. the reverse at the throat; used by Motion
World.dispose()
```

### `SH.Render` — renderer + post FX
```
Render.init(canvasEl) -> { renderer, scene, camera }
Render.scene / .camera / .renderer / .maxAniso
Render.frame(dt)                       // renders one frame (called by Game)
Render.setQuality(q)                   // 0 low | 1 med | 2 high — resizes RTs, toggles SSAO
Render.resize()
Render.frameBounds(box3, opts)         // smoothly frame a region (Game/Input call this)
Render.orbit(dx,dy) / .zoom(dz) / .pan(dx,dy)     // Input drives these
Render.shake(strength)                 // camera punch on coupling
Render.sunDir -> THREE.Vector3
Render.setTimeOfDay(t)                 // 0 dawn, .5 noon, 1 dusk — drives sky/sun/lamps
Render.screenPos(vec3) -> {x,y,visible} // for UI markers
```
Camera: perspective, **fov 24**, positioned ~150–260 units out, elevation 26–42°, target on
the yard centre. Orbit is **clamped** (azimuth ±38° from default, elevation 18–58°) — the
player must never be able to find an ugly angle. Auto-frame keeps the active train on screen.

### `SH.FX` — particles & decals
```
FX.init(scene); FX.update(dt, camera)
FX.exhaust(anchorObj3D, load)      // continuous, load 0..1
FX.dust(pos, amount, dir?)  FX.sparks(pos, dir)  FX.steam(pos, amount)
FX.pollen(bounds)                  // ambient motes, started once
FX.impact(pos)                     // coupling: dust ring + a couple of sparks
FX.setQuality(q)
```
Use pooled `THREE.Points` with a custom shader (soft round sprite, no textures loaded from
disk — generate the sprite on a canvas). Additive for sparks, normal for dust/smoke. Sort
matters: keep smoke `depthWrite:false`.

### `SH.Audio` — procedural WebAudio
```
Audio.init(); Audio.unlock()                // call unlock on first user gesture
Audio.play(name, opts)   // 'clank','hiss','squeal','points','horn','ui','win','fail','couple'
Audio.engine(on, load)   // diesel idle→notch, load 0..1, smooth
Audio.roll(speed)        // wheel-on-rail rumble, speed-dependent
Audio.ambience(on)       // wind + birds bed
Audio.mute(bool) -> bool
```
**No audio files.** Synthesise: filtered noise bursts + resonant bandpass for the clank,
sawtooth stack with LFO for the diesel, pink noise + comb for roll, etc. Everything must
sound like *metal and open air*, never like a synth arpeggio. Keep total voices ≤ 24.

### `SH.Puzzle` — pure logic, **must not reference THREE**
```
Puzzle.create(levelDef) -> state
Puzzle.clone(state) -> state
Puzzle.legalGo(state, trackId) -> true | 'reason-code'
Puzzle.go(state, trackId) -> state           // throws if illegal
Puzzle.cut(state, k) -> state
Puzzle.isWin(state) -> bool
Puzzle.key(state) -> string                  // canonical, for the solver's visited set
Puzzle.solve(state, target, opts) -> { moves:[{type:'go'|'cut', ...}], gos:int } | null
Puzzle.hint(state, target) -> move | null    // next move on an optimal path
```
The solver is a BFS over `go` moves where each edge internally enumerates the useful `cut`
values. Must solve an 8-wagon / 4-track level in **< 400 ms**. Memoise; cap the visited set.

### `SH.Levels`
```
Levels.pack -> [levelDef, ...]        // ~14 hand-tuned levels, gentle → nasty
Levels.generate(seed, difficulty) -> levelDef     // solver-verified, par computed
Levels.daily() -> levelDef            // seeded by local date
Levels.progress.get(id) / .set(id, {stars, best})   // localStorage 'gamelab:shunting:prog'
levelDef = {
  id, name,                            // name is Korean, e.g. "아침 첫 입환"
  tracks: [{id:'HEAD', kind:'head', capacity:4}, ...],   // capacity counts the loco too
  wagons: [{id:'a', type:'box', livery:'#9e3b2c'}, ...],
  start:  { HEAD:[], S1:['a','b'], S2:['c'], S3:[], EXIT:[] , at:'HEAD'},
  target: ['c','a','b'],               // required EXIT contents, WEST→EAST
  par: 6,                              // BFS-optimal go count — MUST be verified
  timeOfDay: 0.35,
  hint: '헤드샨트에 3량까지만 들어갑니다.'
}
```

### `SH.Motion` — physical train animation
```
Motion.init(world)
Motion.snap(state)                       // place everything instantly (level load)
Motion.execute(state, move, done)        // animate the move, call done() at rest
Motion.update(dt)
Motion.isBusy -> bool
Motion.speed -> number                   // current m/s, for Audio.roll
```
The animation for a `go` is: brake release hiss → pull west along the current track to the
throat (accelerating, slack running out) → stop → points throw (audible + the blades animate)
→ propel east into the target track → contact + coupling impact → settle. Total ~2.2–3.4s,
scaled by distance. Use the arc-length parametrisation from `World.point`; each vehicle's
`s` is `leadS − (i * 13.0) ± slack[i]`.

### `SH.Input`
```
Input.init(canvasEl, hooks)
hooks = { onTrack(id), onCoupler(index), onEmpty(), onHoverTrack(id|null) }
Input.setEnabled(bool)
Input.pickables(world, state)            // refresh raycast targets after each move
```
- Tap a track (its rails, its ballast, its buffer stop, or the wagons standing on it) → `onTrack`.
- Tap the glowing coupling knuckle between two coupled vehicles → `onCoupler(k)`.
- Drag = orbit. Two-finger drag / right-drag = pan. Pinch / wheel = zoom.
- A tap is a pointerup within 8px and 300ms of pointerdown. Everything else is camera.
- Hover (desktop) highlights the target track with a soft ground glow + a lift on its wagons.
- Touch targets are generous: raycast against invisible fat proxy boxes, not the fine mesh.

### `SH.UI` — DOM overlay
```
UI.init(hooks)   // hooks: {onRestart, onUndo, onHint, onLevel(i), onNext, onShare, onMute}
UI.setLevel(def) / .setState(state) / .setMoves(n, par) / .setBusy(b)
UI.target(list)  // renders the required order as a row of little wagon chips
UI.toast(msg) / .flash(msg)
UI.win(result) / .levelSelect(open)
UI.tutorial(step)
```
Korean copy. The HUD must stay out of the way of the diorama: a slim top bar (level name,
moves/par, ★), a bottom strip showing the **target order** as coloured wagon chips, and a
small round button cluster (undo / hint / restart / menu). Glassy dark panels, `backdrop-filter`,
the accent `#d99a26`. Never cover the centre of the screen during play.

### `SH.Game` — boot & state machine
```
States: BOOT → TITLE → PLAY ⇄ ANIM → WIN → (next level)
Owns: the Puzzle state, undo stack, move counting, level flow, autosave.
Exposes the debug/screenshot API below.
```

---

## 7. Screenshot / review API (required — the review agents depend on it)

`90-game.js` must expose:
```js
window.__SHOT = {
  ready: false,               // flips true when the first frame has rendered
  async pose(name),           // set up a canned scene for review; see list below
  async level(i),             // load level i and snap to it
  step(ms),                   // advance the simulation deterministically by ms and render
  hideUI(b),                  // hide the DOM overlay for pure-render shots
  info()                      // { fps, tris, calls, quality }
};
```
Poses: `'establish'` (default framing, full yard, wagons on all sidings), `'closeup-wagon'`,
`'closeup-coupler'`, `'closeup-track'` (rails/sleepers/ballast macro), `'mid-move'` (loco
propelling, exhaust up, dust), `'dusk'` (lamps lit), `'win'`, `'ui'` (normal play with HUD).
`pose()` must be **deterministic** — no `Math.random()` without a seeded RNG — so
before/after screenshots are comparable.

---

## 8. Definition of done (every module)

- [ ] Zero console errors or warnings on load.
- [ ] Public API exactly as specified above.
- [ ] No `Math.random()` outside a seeded `U.rng`.
- [ ] No `console.log` left in.
- [ ] Disposes what it creates (`dispose()` on geometry/material/texture) if it can be rebuilt.
- [ ] Runs at quality 0/1/2 without exceptions.
- [ ] Reads as **AAA at 1440p and at 390px wide**.
