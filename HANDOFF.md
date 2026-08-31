# HANDOFF — car visuals

Branch: `worktree-agent-a6340a3413cc4f8e9` (pushed to `origin`).
Task: make the cars look like renders from a good car game, without breaking the
perf budget or the "no external assets" property.

## Decision: procedural, not imported models

Researched exhaustively first. **No viable set of permissively-licensed,
verifiable, badge-free, sub-2 MB realistic car models exists.** Full evidence
with URLs and quoted licence text is in `CREDITS.md` — read that rather than
redoing the search; it is the most expensive part to repeat. One-paragraph
summary:

* Clean CC0 sets exist (Kenney Car Kit 690 kB for 4 cars, OGA Lyricsz pack,
  Quaternius) but they are stylised toy geometry — a visual *downgrade* on what
  the game already renders.
* three.js's `ferrari.glb` has no licence at all (MIT covers the code, not
  example media, cf. three.js#23089) and its credited Sketchfab source has been
  taken down. Hard no.
* Sketchfab's CC0 filter contains literally no cars; its "CC0" realistic cars
  have a contradicting structured licence field; its CC-BY vehicle results
  include obvious rips from shipped games.
* TurboSquid/CGTrader licences *specifically* forbid serving assets in an
  extractable open format, which is what a browser game does.
* Open-source racing sims (VDrift, TORCS, Stunt Rally, Speed Dreams, STK) are
  GPL / Free Art / CC-BY-SA: copyleft, not permissive.
* The single genuinely viable realistic option is **Daniel Zhabotinsky's CC-BY
  fictional-marque cars** (<https://sketchfab.com/DanielZhabotinsky>, 15–28 k
  faces, invented brands so trademark-clean by design). Rejected only because
  each needs a manual authenticated download. Worth reopening later.

So: all effort went into lighting, materials and geometry.

## What is implemented

New files (all mine, no conflicts):

| file | what |
|---|---|
| `src/carEnv.js` | Procedural **HDR** equirectangular environments → PMREM. `roadEnv()` = sky with a real sun disc (~200× the sky, which is what makes clearcoat glint), Mie aureole, faint cloud banding, a crisp horizon band and a dark ground half. `studioEnv()` = photo studio: three softboxes + a long overhead strip, dark surround, sweep floor. Half-float `DataTexture`, so the sun is genuinely brighter than 1.0 — an 8-bit canvas cannot do this and that was the core problem with the old env. |
| `src/carPaint.js` | The whole material set. Paint is `MeshPhysicalMaterial` with `clearcoat: 1` — metallic basecoat holds the colour, near-mirror lacquer holds the sky. Also glass (tinted, `depthWrite:false` so near/far screens blend), chrome, satin trim, tyre with tread normal map, two rim finishes, discs, calipers, lamps + always-on DRLs, contact shadow. Plus `retargetEnv()`. |
| `src/carTextures.js` | `bodyDetail()` draws **panel gaps in loft UV space** (u = once round the cross-section, v = tail→nose): door shut lines, bonnet and boot-lid outlines, sill shading, shoulder creases, and a roughness map with large-scale blotching. Two canvases: one sRGB for `map`, one linear for `roughnessMap`/`aoMap`. Also `flakeNormal()` (orange peel), `tyreNormal()` (tread), `contactShadow()` (car-shaped, not a circle in a rectangle). |
| `src/postfx.js` | Hand-rolled 5-pass bloom (MSAA half-float scene target → bright pass → separable blur ×2 widths → composite with its own sRGB conversion). Deliberately *not* EffectComposer: the game renders three times per frame and drives `toneMappingExposure`, and `OutputPass` would tone-map twice. Returns `null` if the device can't give a float target, so callers fall back. |
| `dev/carsx.html` + `dev/carsx.js` | New bench that lights cars the way the game and menu actually do (`?env=road|studio&post=0|1`). `dev/cars.js` deliberately untouched. |
| `CREDITS.md` | Licence research record. |

Rewritten (owned): `src/carFactory.js`, `src/showroom.js`.

`src/carFactory.js` changes:
* **Detail tiers.** `TIERS.hi/mid/lo` set loft resolution, station count, wheel
  detail and *how many materials* a car uses. `hi` = the four player cars,
  `mid` = Zivilstreifen + Messwagen, `lo` = traffic. Traffic cars came out
  *cheaper* than before (fewer draw calls) which paid for the player's car.
* Loft: `section()`/`loft()` now take a resolution object instead of the module
  constant. Haunches added — the body swells over each axle (`hipAt`), more at
  the rear, which is what stops the flank highlight being dead straight.
* Wheels rewritten: `revolveX()` builds tyre and rim as solids of revolution
  (smooth sidewall bulge, and UVs the tread normal map wants). The rim is
  deliberately **open** at the front — barrel + lip + spokes, so you see the
  brake disc through the gaps; a closed annulus reads as a hubcap. Twin-spoke
  blades, polished lip ring and lug bolts on `hi`, discs + calipers on `hi`/`mid`.
* Front/rear ends rebuilt: recessed lamp housings, chrome reflectors, **daytime
  running lights** (biggest single readability win at distance), horizontal
  chrome bars inside grille apertures, dark inset tail band, reversing lamps,
  reflectors, diffuser fins, exhaust tips with a dark bore, plate recesses.
* Side detail: rounded mirror shells, sunken door handles, **window surround
  and wheel-arch lips laid along the actual loft stations** (`TubeGeometry`
  through sampled station points), roof rails on estates, shark fin, wipers.
* Interior: floor, bulkhead, dashboard, steering wheel, two front seats with
  headrests, rear bench. You look through the glass on the turntable and from
  the cockpit camera, so an empty shell was very obvious.
* Front and rear number plates merged into one mesh (same texture) — one draw
  call instead of two, thirty times over.

`src/showroom.js`: uses `studioEnv()` on its own context and `retargetEnv()` to
re-point each car's materials at it. **This fixes a real pre-existing bug**: a
PMREM result is a render target and lives on the GPU of the renderer that made
it, so the menu cars had been carrying an envMap from the *game's* context and
were lit entirely by four directional lights. Directional lights reduced to two
now the environment does the work.

`src/game.js` — only these additive edits:
* line 7: `import { roadEnv } from './carEnv.js';`
* the `initMaterials(this.world.env)` call replaced by
  `this.carEnv = roadEnv(renderer); initMaterials(this.carEnv);` plus a comment.
  Deliberately does **not** touch `scene.environment`, so world.js's own
  materials keep exactly the env they had — zero risk to the other agents' work.

## Numbers

Baseline before any change (`node dev/prod-check.mjs http://localhost:5201/`):
**516 772 tris / 1428 draw calls**, load 4157 ms, 522 geometries, 60 textures.

Budget: ~2× either figure (≈1.03 M tris / ≈2860 calls).

Current: see the last line of the report / re-run prod-check. The design intent
is roughly break-even on draw calls (player car up, thirty traffic cars down)
and a modest triangle increase.

## Left to do, in priority order

1. **Wire `postfx` into `game.js`** (3 more additive lines: create in `init`,
   `setSize` in `onResize`, and `this.post ? this.post.render(...) :
   this.renderer.render(...)` in the loop). Written and used by `dev/carsx.js`
   but **not yet wired into the game** at the time of writing.
2. Tune: lamp lens brightness (the round lamps on the 911 still read a little
   like googly eyes), front splitter/apron reads as a black slab, spoilers are
   still floating plates.
3. Verify the cockpit camera is not blocked by the new dashboard / wheel
   (`dev/race-shot.mjs ... 12 2`).
4. Re-run `dev/prod-check.mjs`, `dev/lang-check.mjs`, `dev/flash-check.mjs`
   (it asserts on `userData.headMat.emissiveIntensity` and `userData.glows`),
   `dev/cop-shot.mjs` (blue LEDs), `npm run build`.
5. Save before/after pairs into `dev/shots/`.

## Gotchas found the hard way

* Rollup rejects `-x ** 2`; write `-(x ** 2)`.
* `dev/cars.js` bench builds its own flat-gradient env, so it does **not** show
  the new environment. Use `dev/carsx.js` for that.
* External contracts that must not break (grepped): `userData.paintMat.color`,
  `userData.tailMat.emissiveIntensity` (0.55 + brake·2.6),
  `userData.headMat.emissiveIntensity` (0.4 / 2.2 / 16 for a Lichthupe),
  `userData.glows[].material.opacity`, `userData.wheels[].userData.spin`
  (rotated about **X**) and `.userData.radius`, `userData.blues[].material`,
  `userData.led.userData.{on,off}`. `MAT.make(hex, metal, rough)` is still used
  by `buildTruck`.
* `aoMap` uses UV channel 0 in three r169, so no `uv1` attribute is needed.
* The loft's station table runs **t = 0 at the tail, t = 1 at the nose**
  (`z = (t - 0.5) * L`, +Z is the nose). Every shut-line position depends on
  this.
* The 404 in every harness log predates this work (a favicon); it is not an
  error introduced here.

## Build and verify

```bash
ln -s /home/leo/devel/autobahn/node_modules node_modules   # do not npm install
npx vite --port 5201 --strictPort &                        # dev server
npm run build                                              # must pass

node dev/shot.mjs "http://localhost:5201/dev/carsx.html?cars=turbo,m5,rs6,amg&mode=side" out.png
node dev/shot.mjs "http://localhost:5201/dev/carsx.html?cars=turbo&mode=front34&env=studio" out.png
node dev/race-shot.mjs "http://localhost:5201/" out.png 12 0
node dev/prod-check.mjs "http://localhost:5201/" out.png   # trisPerFrame / callsPerFrame
node dev/lang-check.mjs "http://localhost:5201/" /tmp/lang
```
