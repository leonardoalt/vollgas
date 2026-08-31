# HANDOFF — road & roadside visuals (Vollgas)

Branch: `worktree-agent-a2414b96acb114bf0`. Worktree:
`/home/leo/devel/autobahn/.claude/worktrees/agent-a2414b96acb114bf0`.

**State at time of writing: WIP, DOES NOT BUILD.** `src/world.js` now imports
`buildVergeGrass` from `src/scenery.js` and several new texture functions, and
`makeMaterials()` has been rewritten — but `buildRoadChunks()` still contains the
*old* flat-quad road and barrier code, and `buildVergeGrass` does not exist in
`scenery.js` yet. See "Where I left off".

## Goal

"Better graphics for the immediate surroundings — asphalt, guardrail, walls,
grass." Everything within ~25 m of the camera. Zero external assets: every
texture is drawn on a 2-D canvas at load. Perf budget: no more than ~2× the
baseline triangles/draw calls and no more than +2 s load.

Files I own: `src/textures.js`, `src/world.js`, `src/scenery.js`, anything new
under `dev/`. `src/game.js` may only get minimal additive edits — **so far I have
touched game.js not at all, and I intend to keep it that way** (see "grass
culling" below for why that worked out).

## Measured baseline (before any change)

`dev/world.html?km=12&view=drive`, via the new `dev/probe.mjs`:

    tris 394684  calls 996  geometries 881  textures 29

`dev/prod-check.mjs` baseline (per the brief): ~576 k tris, ~1490 calls, ~4.0 s
load. Budget therefore ~1.15 M tris / ~2980 calls.

## What the screenshots actually showed (all checked, saved in dev/shots/)

`before-a` km 12 drive · `before-b` km 12 cockpit · `before-c` km 0.2 drive ·
`before-d` km 4.6 drive · `before-e` km 24.5 drive · `before-f` km 12 air.

1. **The guardrails are far and away the worst thing on screen.** The W-beam is
   two flat 0.20 m DoubleSide quads. From the driver's eye they project as three
   or four enormous pale-grey ribbons that dominate the whole left half of the
   frame and read as grey tape, not steel. I proved this: hiding the 51 meshes
   named `steel` (`dev/probe.mjs`, see command below) removes every one of those
   bands and the shot instantly looks normal. **I initially misdiagnosed those
   pale bands as the oncoming carriageway being blown out by an env-map/Fresnel
   sheen, and wasted time on it — it is not that.** Setting
   `mats.asphalt.envMapIntensity = 0` changes the image not at all
   (`dev/shots/probe-noenv.png` is pixel-identical to `before-a`), and the aerial
   view shows both carriageways equally dark. Don't go down that path again.
2. Asphalt is a flat 256 px noise tile, uniform and washed out; the mid-distance
   goes to grey mush. No lateral structure whatsoever.
3. Grass/median is flat vertex colour; the median in particular is a solid
   untextured green (`mats.median` had no map at all).
4. Lane markings are flat white quads — and their geometry has **degenerate V**
   (`ribbon()` is called with `vScale` defaulting to 0), so they cannot carry a
   texture until the call sites pass a vScale.
5. Tunnel and Baustelle: structurally fine, just untextured grey concrete.
6. Aerial view: terrain reads correctly, no folding — the phantom-centreline
   machinery is working. Don't disturb it.

### The prompt's screenshot locations are wrong

The section table is in 42 km units squeezed onto `STAGE_KM = 26`. Real
positions (from `dev/probe.mjs`):

* Engelbergtunnel **km 2.352 → 3.594** (so `km=4.6` is *not* in the tunnel; use
  `km=2.8`)
* Baustelle Empfingen **km 14.61 → 16.16** (so `km=24.5` is *not* the Baustelle;
  use `km=15.2`)

Shoot both the prompt's locations and the real ones.

## Approach, and what I rejected

**Asphalt — three aligned maps at different scales, not one.**
`asphaltTex` (colour, one tile per ~3.9 m) carries only tone/segregation/bitumen
streaks; `asphaltNormalTex` and `asphaltRoughTex` share one aggregate height
field and repeat 3× (one tile per ~1.3 m ≈ 390 px/m) so individual 8–14 mm
chippings actually resolve at 2 m from the camera. This is the classic detail-map
trick and needs no custom shader: in three.js each texture carries its own
`repeat`, so a normal map can simply run at a higher frequency than the colour
map. Rejected: (a) one big 2048 px colour map — memory and still soft; (b) a
custom `onBeforeCompile` detail blend — more code, more merge risk.

**Nothing lateral may live in the asphalt texture.** The carriageway UV is
`uRep = 2.7` across 10.5 m, so the existing "wheel-track polishing" gradient
baked into the old tile came out **2.7 times across the road**. Wheel tracks,
repairs and the pale hard shoulder therefore have to be *vertex colours plus
lateral subdivision*. Hence `LANE_CUTS` (17 lateral strips per carriageway,
bracketing the four wheel tracks) and `asphaltTone(s,u)`. The eight strips whose
midpoint is within 0.30 m of a track centre go to a second material,
`asphaltPolished` (roughness 0.72 vs 1.0), because real tracks are darker *and*
glossier. Cost: +1 draw call per chunk.

**Guardrail — real extruded profile, decoration in the texture.** `W_BEAM` in
`textures.js` is a Profil A section (311 mm tall, 83 mm deep, three
corrugations) as `[depth, height]` pairs; `BEAM_V` is the matching V stop per
vertex. Both the geometry and the texture are laid out from that one list, so
the bolt head drawn in the texture lands in the central valley of the pressing.
Beam **and** post share one atlas (beam V 0–0.72, post V 0.78–1.0) so the whole
barrier is one draw call per chunk — that actually *removes* a draw call versus
the current separate `steel` + `posts` meshes. Rejected: modelling bolts as
geometry (far too expensive over 26 km).

**Grass — instanced cross-billboard tufts, but only as a fringe.** Blanket
coverage is impossible: tufts dense enough to read over the full verge is >1 M
triangles. Instead ~3.5 tufts/m of route concentrated in four narrow bands
(the median, and just outside each outer barrier), bucketed into **200 m**
InstancedMeshes and distance-culled in `world.update()`.

**Grass culling needs no game.js change.** `game.js:631` already calls
`this.world.update(dt, p.mesh.position)`, and `dev/world.js` calls it with
`cam.position`. A world-space distance test against each bucket centre is
enough, so the signature does not change and game.js stays untouched.

## Implemented and believed complete

### `src/textures.js` (done, not yet exercised)

* `srand(seed)` — deterministic LCG so textures are identical every load (the
  old ones used `Math.random`, which made before/after screenshots noisy).
* `normalFromHeight(hc, strength)` — height canvas → tangent-space normal map.
  **Sign gotcha, got this wrong once:** three.js uploads canvases with
  `flipY`, so +V runs *up* the canvas and the V gradient is the negated row
  gradient. `nx = -dx` but `ny = +dy`. Backwards is invisible on asphalt and
  very visible on a bolt head or a panel joint.
* `levels(src, lo, hi)` — height field → roughness map.
* `tiled(S, fn)` — draws `fn` nine times at ±S offsets so anything touching an
  edge wraps. **Generate a shape's random vertices once and *then* draw the nine
  copies**, or the copies differ and the tile is not seamless.
* `asphaltHeight` / `asphaltTex` / `asphaltNormalTex` / `asphaltRoughTex`.
* `markHeight` / `markingTex` / `markingNormalTex` / `markingRoughTex` — worn
  thermoplastic: bevelled raised edge, chipped edges, glass-bead grain, rubber
  scuffs, hairline cracks. The colour map reads the height field back so chips
  show asphalt through in both maps consistently.
* `W_BEAM`, `BEAM_V`, `BEAM_V_MAX`, `POST_V`, `railHeight`, `railTex`,
  `railNormalTex` — galvanised spangle, baked AO for the corrugation, bolt +
  washer + rust weep at each 4 m post, road grime up the bottom of the pressing,
  darker dirtier post band.
* `grassHeight` / `grassTex` / `grassNormalTex` — **neutral** modulation around
  1.0, because the terrain is vertex-coloured per biome and anything with hue in
  the map fights the palette. `tuftTex` — alpha-cut blades for the billboards.
* `concreteTex` / `concreteNormalTex` — board-marked in-situ concrete.
* `noiseWallTex` / `noiseWallNormalTex` — precast panels, coping, weathering
  streaks. **The old wall reused `facadeTex`, i.e. the noise barriers had rows of
  lit office windows in them.** That is why they "read oddly".
* `tunnelLiningTex` — U runs right across the arch (0 and 1 are the two wall
  bases at road level) so the grubby plinth and painted band can be baked in
  place; V is one 9 m ring.
* All normal/roughness maps whose UV exceeds 0..1 were given `repeat` so
  `RepeatWrapping` is enabled — `finish()` only sets wrapping when `repeat` is
  passed, and a clamped normal map on a road smears one pixel row down 26 km.

### `src/world.js` (partially done)

* `Mesher` gained `col` + `quadC()` (per-corner rgb) and `geo()` back-fills
  white so `quad` and `quadC` can be mixed.
* `hash1(i,j)` — int32 spatial hash (`Math.imul`, not `*`).
* `ribbonC()` — `ribbon()` plus a `tint(s,u)` callback. **The colours must
  follow the winding flip, not the argument order**, or the shading mirrors
  itself on the oncoming carriageway.
* `prismSides()` — the four sides of a vertical prism, re-wound to CCW in xz by
  signed area so normals face outward whatever order the corners arrive in.
  Used for rail posts and noise-wall posts.
* `LANE_CUTS`, `TRACKS`, `isTrack()`, `asphaltTone()`.
* `BRIDGE_AT` hoisted to a module const (was inline in `buildBridges`) so the
  verge-grass blocker can use the same list.
* `makeMaterials()` fully rewritten: `asphalt`, `asphaltPolished`, `asphaltDark`,
  `concrete`, `tunnelLining`, `concreteBoth`, `barrier`, `median`, `markWhite`,
  `markYellow`, `rail`, `steel`, `noiseWall`, `wallPost`, plus the unchanged
  `white`/`dark`/`lamp`/`baken`/`bakenRed`.
  * `postDark` and `concreteIn` were **removed**. `concreteIn` was only used for
    the tunnel shell (now `tunnelLining`) and `postDark` only for the old flat
    rail posts. I grepped: `mats` is not referenced outside `world.js`, so this
    is safe — but `buildTunnel()` still says `mats.concreteIn` and must be
    updated (see below).
  * `steel` is deliberately left alone: it is shared with `vergeSign()` and
    `gantry()`, and changing it would regress the signage.

### `dev/` (done)

* `dev/probe.mjs <url> <expr> [out.png]` — load a page, await `__ready`,
  evaluate an expression, print JSON, optionally screenshot. This is how I found
  the section positions and proved the guardrail diagnosis.
* `dev/world.js` — added `window.__bench = { THREE, scene, cam, renderer, world,
  stats() }`. Additive; existing harnesses unaffected.
* `dev/shots/` — the six before shots plus the two probe shots.

## Where I left off — exact next steps, in priority order

1. **`buildRoadChunks()` in `world.js` is still entirely the old code** and now
   refers to materials that no longer exist (`mats.postDark`). It must be
   rewritten to:
   * emit the carriageway as `LANE_CUTS` strips via `ribbonC(..., asphaltTone)`,
     routing strips with `isTrack(midpoint)` into a second mesher on
     `mats.asphaltPolished` and the rest onto `mats.asphalt`;
   * emit the median as ~6 strips (cuts `[-2, -1.62, -0.8, 0, 0.8, 1.62, 2]`)
     with `ribbonC` on `mats.median`, `vScale 1/4`, darker under the rails;
   * add a `seam` mesher on `mats.asphaltDark` — longitudinal paving joint at
     u = ±6.25, transverse day-work joints, and occasional machine-laid patch
     repairs. Tint by vertex colour: ~0.30 for seams, ~0.85 for patches, so
     both live on one material and one draw call. Lift `dy = 0.005` (below the
     markings' 0.015) plus the polygonOffset already on the material.
   * replace the two flat beam quads with `railRun()` + `railPost()` (design
     below, fully worked out but **not yet typed in**);
   * pass a `vScale` to every marking `ribbon()` call — currently V is
     degenerate so the new marking texture would be a single stretched row.
     `vScale = 1/2` (one tile per 2 m) is what the texture was drawn for.
2. **`buildVergeGrass(rand, blocked)` in `scenery.js`** — does not exist yet;
   `world.js` already imports it, which is the immediate build break.
3. `buildTunnel()` — `mats.concreteIn` → `mats.tunnelLining`, and change the
   shell UV from `k/RIB` to `k/(RIB-1)` so U spans exactly 0..1 across the arch
   (RIB = 15, so today the arch only reaches U = 0.933 and the baked plinth
   would land in the wrong place).
4. `buildNoiseWalls()` — UV `s/5` → `s/4` to match the 4 m bay in the texture,
   plus merged posts every 4 m via `prismSides` on `mats.wallPost`.
5. `buildRoadworks()` — the concrete separator to `mats.barrier`.
6. Re-shoot everything, run `dev/prod-check.mjs` and `dev/start-check.mjs`.

### Guardrail geometry — worked out, not yet written

Rails, as `[u, topHeight, faceLat]` where `faceLat` is the lateral direction the
pressing bulges in (i.e. toward the traffic it protects):

    median right  [ +1.62, 0.75, +1 ]
    median left   [ -1.62, 0.75, -1 ]
    outer right   [ +(pavedOut+0.45), 0.78, -1 ]   // omitted where gapped()
    outer left    [ -(pavedOut+0.45), 0.78, +1 ]

Beam centre y = `top - 0.1555`. Profile point k sits at lateral
`u + faceLat * W_BEAM[k][0]`, height `centre + W_BEAM[k][1]`. U = `s / 4`
(one texture tile per post), V = `BEAM_V[k]`. Nine quads: eight across the
pressing plus one closing back plate from `W_BEAM[8]` to `W_BEAM[0]` at depth 0,
V `BEAM_V[8] → BEAM_V[9]`.

**Winding — I derived this on paper, do not guess.** With
`T = (sin h, 0, cos h)` (tangent) and `R = (-cos h, 0, sin h)` (the lateral
direction `roadPt` moves in), `T × R = -up` and `T × up = R`. `W_BEAM` traverses
clockwise in the (depth, height) plane (shoelace sum ≈ -0.0437), so the outward
normal of edge k→k+1 is that edge rotated +90°. Working it through:

* `faceLat = -1` → the natural order `(P_k(s), P_k(s2), P_{k+1}(s2), P_{k+1}(s))`
  with `quad(a,b,c,d, U0, BEAM_V[k], U1, BEAM_V[k+1])` is **correct**.
* `faceLat = +1` → must be reversed: pass `(d, c, b, a)` and swap the V pair,
  i.e. `quad(d, c, b, a, U0, BEAM_V[k+1], U1, BEAM_V[k])`. Reversing the corner
  list while keeping `quad`'s corner→UV mapping is why the V ends have to swap;
  U stays on the road axis either way.

Posts: every 4 m (`POST_PITCH = 4`), one `prismSides` each, horizontal corners at
`(s ± 0.062, u + faceLat * -0.012)` and `(s ± 0.062, u + faceLat * -0.105)` —
i.e. 12 mm *behind* the beam's back plate so there is no z-fighting over the
0.311 m where they overlap. `yBot = -0.17` (into the ground; the flat mown verge
is 3.75 cm below the road edge at u = 12.5, so it must go deeper than that),
`yTop = beamCentre + 0.10`. UVs `(0, POST_V[0], 1, POST_V[1])` — v0 is the top.

Estimated cost: beams 4 × 9 quads + posts 4 × 2 × 4 quads = 136 tris per 8 m
segment ≈ 17 tris/m, ~61 k triangles visible against a 394 k baseline. Measure it.

### Verge grass — design, not yet written

`buildVergeGrass(rand, blocked)` in `scenery.js`, returning a group whose
`userData.buckets` is `[{ mesh, x, y, z }]` for the distance cull.

* Geometry: two crossed `PlaneGeometry(1,1)` translated to put the base at
  y = 0, merged → 4 triangles. Material: `tuftTex()`, `alphaTest: 0.42`
  (**not** `transparent` — alphaTest writes depth, needs no sorting, and the
  mipmaps thin the tufts out with distance, which is a free LOD),
  `side: DoubleSide`. Per-instance `setColorAt` for variety.
* Bands: median `|u| ∈ [0.30, 1.85]` at ~1.3/m; outer verge
  `|u| ∈ [12.85, 16.0]` at ~2.2/m. Start at 12.85 not 12.5 so a 0.5 m-wide
  billboard cannot cross the asphalt edge.
* Buckets of 200 m, all built `visible = false`; `world.update()` turns on the
  ~3 within 240 m of `playerPos`. Without that first-frame guard every bucket
  draws for one frame (~364 k triangles).
* Height **must match the terrain mesh's own interpolation**, not `hillHeight`
  directly. The ribbon is only sampled at the `RING` distances, so between rings
  you have to lerp the same way the mesh does:
  `yOf(d) = baseY + hillHeight(x, z, d) - (d <= 14.5 ? 0.30 : 0)`, then
  interpolate between the two bracketing rings. Note `hillHeight` returns 0 for
  `ad <= 14.5` while the explicit `-0.30` only applies there, so a naive
  `baseY + hillHeight(ad)` has a 30 cm step at ad = 14.5 that the mesh does not.
* `blocked(s,u)` predicate built in `world.js` from a rectangle list, because
  grass poking through paving is the failure mode the brief calls out:
  * `[-10, ENTRY_LEN+120, 9, 60]` — the Auffahrt. **This is the km 0.06 slip
    road hazard.** The ramp is lifted 7 cm, so at u ≈ 14 its surface sits at
    `cy - 0.23` while the flat verge is at `cy - 0.30`: a 0.3 m tuft would stick
    23 cm through the tarmac.
  * each `sec.exit` (not the first): `[s-90, s+330, 9, 60]`
  * `sec.rest`: `[s-170, s+340, 9, 70]`
  * `sec.works`: `[s-40, nextSectionStart-20, 8.5, 22]`
  * `sec.tunnel`: `[s-12, s1+12, -2.5, 20]` — kills median and right-verge
    tufts inside the bore but deliberately **not** the left carriageway's outer
    verge, which is in open ground (the tunnel is a single bore over our
    carriageway only).
  * each `BRIDGE_AT` fraction: `[s-8, s+8, -60, 60]`

## Gotchas (the expensive ones)

* **Use the `ribbon()` / `ribbonC()` helpers.** Winding is centralised because
  getting it wrong points the face normals down and the lane markings silently
  vanish.
* **Crossfall.** `roadPt` applies `-max(0, |u| - 2.0) * 0.025`, so the road edge
  at u = 12.5 is 26 cm below the centreline while the flat mown verge is at
  −30 cm. That 3.75 cm is the entire clearance on the outer verge, and it is why
  the entry ramp is lifted 7 cm. Anything you place laterally must respect it —
  re-check `km=0.06&view=drive` for grass through the asphalt after any change.
* **Terrain ring level must stay a continuous function of lateral distance**
  (`levelOf()` in `scenery.js`). I have not touched it and it should stay
  untouched: snapping to discrete levels gives cliff faces in the distance and a
  ridge in the grass beside the road. The aerial view is where this shows up.
* **Chunking.** Road furniture is built in 512 m chunks merged to a handful of
  meshes so the frustum culls it, and vegetation is bucketed at 1.8 km. Do not
  create per-object meshes along 26 km.
* `finish()` in `textures.js` only enables `RepeatWrapping` if you pass
  `repeat`. Every map whose UV leaves 0..1 needs it.
* The `[error] Failed to load resource: 404` that every `dev/shot.mjs` run
  prints is a **pre-existing missing favicon**, not a regression.

## Build and verify

    ln -s /home/leo/devel/autobahn/node_modules node_modules   # do NOT npm install
    npx vite --port 5204 --strictPort &

    npm run build

    node dev/shot.mjs "http://localhost:5204/dev/world.html?km=12&view=drive"    dev/shots/after-a.png
    node dev/shot.mjs "http://localhost:5204/dev/world.html?km=12&view=cockpit"  dev/shots/after-b.png
    node dev/shot.mjs "http://localhost:5204/dev/world.html?km=0.2&view=drive"   dev/shots/after-c.png
    node dev/shot.mjs "http://localhost:5204/dev/world.html?km=2.8&view=drive"   dev/shots/after-d.png   # real tunnel
    node dev/shot.mjs "http://localhost:5204/dev/world.html?km=15.2&view=drive"  dev/shots/after-e.png   # real Baustelle
    node dev/shot.mjs "http://localhost:5204/dev/world.html?km=0.06&view=drive"  dev/shots/after-ramp.png
    node dev/shot.mjs "http://localhost:5204/dev/world.html?km=12&view=air"      dev/shots/after-f.png

    node dev/probe.mjs "http://localhost:5204/dev/world.html?km=12&view=drive" "return window.__bench.stats();"
    node dev/prod-check.mjs  "http://localhost:5204/" /tmp/prod.png
    node dev/start-check.mjs /tmp/start.png     # NB: hardcodes port 5173

Useful probe one-liners:

    # prove what a mesh contributes
    node dev/probe.mjs "<url>" "const b=window.__bench;let n=0;b.scene.traverse(o=>{if(o.isMesh&&o.name==='steel'){o.visible=false;n++;}});return {hidden:n};" out.png
    # real section positions
    node dev/probe.mjs "<url>" "const t=await import('/src/track.js');return t.SECTIONS.map(s=>[s.km,s.name]);"
