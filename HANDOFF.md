# HANDOFF — car visuals

Branch: `worktree-agent-a6340a3413cc4f8e9` (pushed to `origin`).

Two things happened here. The cars got a real rendering pipeline — HDR
environment, clearcoat paint, panel gaps, better geometry, bloom — and then
they got **real glTF bodies** under a licence we can actually ship.

## What ships

| | before | now |
|---|---|---|
| player's car | procedural loft, ~14 k tris | **CC-BY Porsche 930 Turbo**, 38.8 k tris + our wheels |
| traffic (taxi/kombi/hatch/van) | procedural loft | **CC-BY generic pack** bodies, ~2.7 k tris each |
| Zivilstreifen, trucks, `m5`/`rs6`/`amg` | procedural | procedural (see "gaps") |

Licences, the required attribution strings and the full rejection record are in
`CREDITS.md`. The CC-BY credit is also rendered in the menu (`src/credits.js`),
because that licence requires it visibly wherever the work is shared.

## New files

| file | what |
|---|---|
| `src/carEnv.js` | Procedural **HDR** equirect environments → PMREM. `roadEnv()` has a real sun disc ~200× the sky, aureole, cloud banding, a crisp horizon and a dark ground half. `studioEnv()` is three softboxes and an overhead strip. Half-float, because an 8-bit canvas cannot make the sun brighter than the sky and then clearcoat has nothing to glint off. |
| `src/carPaint.js` | Material set: clearcoat paint, tinted glass, tread-mapped tyres, two rim finishes, lamp/DRL materials, contact shadow. Plus `retargetEnv()`. |
| `src/carTextures.js` | Panel gaps drawn in **loft UV space** (door shut lines, bonnet and boot outlines, sill shading), flake/orange-peel normal, tyre tread, car-shaped contact shadow. |
| `src/carModels.js` | The glTF pipeline. Loads meshopt GLBs, strips badges/plates/decals, bakes world transforms into float geometry, auto-detects each body's yaw, fits to the rig, and hands off to `finishCar`. Registers itself with carFactory so the procedural path has no dependency on it. |
| `src/postfx.js` | Five-pass bloom with a GPU self-test. |
| `src/carHero.js` | The four car-select photographs, with a FOTO/3D toggle. 3D is the default. |
| `src/credits.js` | CC-BY attribution line in the menu. |
| `src/perfHud.js` | fps / frame-time / draw-call readout. **F**, or `?stats=1`. |
| `dev/model.html`, `dev/model.js` | glTF bench (`?cars=&mode=&env=&grid=1`). |
| `dev/carsx.html`, `dev/carsx.js` | Car bench lit the way the game lights them. |
| `dev/tricheck.mjs`, `dev/netcheck.mjs`, `dev/probe.mjs`, `dev/timecheck.mjs` | Per-vehicle triangle breakdown, failed-request log, in-page probe, load timing. |

## `src/game.js` — every line touched

Additive only, all marked `[car visuals]`:

* imports: `roadEnv`, `createPostFX`, `mountHero`, `mountCredits`,
  `preloadCarModels`, `createPerfHud`
* `initMaterials(this.world.env)` → `this.carEnv = roadEnv(renderer); initMaterials(this.carEnv);`
* `await preloadCarModels(...)` reporting into the existing `setText`
* `this.post = createPostFX(...)`, `this.perf = createPerfHud(...)`
* `onResize`: `if (this.post) this.post.setSize(...)`
* `buildMenu`: `mountHero(...)`
* after `applyDom()`: `mountCredits($('car-detail'))`
* language button also re-mounts the credits
* render loop: `this.post ? this.post.render(...) : this.renderer.render(...)`, and
  `this.perf.update(dt, this.frameStats)`

It deliberately does **not** touch `scene.environment`, so world.js's own
materials keep exactly the env they had.

## Numbers (all on headless Chromium / SwiftShader, same session)

| | tris/frame | calls/frame | load |
|---|---|---|---|
| main | 516,772 | 1,428 | 4.2 s |
| this branch, `?nomodels=1` | 558,632 | **1,152** | 8.0 s |
| this branch, with models | 1,062,814 | 1,751 | ~11 s |

Frame counts include the shadow pass and the 30 Hz mirror pass, so they are
roughly 2–3× the scene's unique geometry (590 k). Load time on this machine is
inflated — the no-models figure was 4.9 s earlier in the session and 8.0 s at
the end, on identical code.

**fps is not measured here and cannot be** — SwiftShader renders this at about
1 fps. Use the in-game readout (F) on real hardware.

## Gaps and known issues

* **No good body for `m5`, `rs6`, `amg`.** No credibly-licensed, well-authored
  modern German super-saloon, fast estate or four-door coupé exists — every
  candidate failed provenance (see `CREDITS.md`). They stay procedural.
* **Zivilstreifen stay procedural.** Putting them on the pack saloon/estate
  saved 222 k tris and 264 calls, but the rig's wheelbase-to-length ratio for
  those four cars does not match the pack's, so the wheels sat outside the
  arches. Reverted deliberately.
* The 930 is a **1975 car** wearing 992 performance figures. It is the only
  legitimately-licensed 911 available. Flagged for the owner.
* `dev/lang-check.mjs` referenced `hud-rear-title`, which exists neither here
  nor on main; it now reads such ids defensively instead of throwing.
* The 404 in every harness log is `favicon.ico` and predates this work.

## Rebuilding the models

Sources and licences are in `CREDITS.md`. The optimisation used was:

```bash
npx @gltf-transform/cli simplify in.glb a.glb --ratio 0.42 --error 0.0012
npx @gltf-transform/cli resize   a.glb  b.glb --width 512 --height 512
npx @gltf-transform/cli meshopt  b.glb  out.glb
```

meshopt rather than Draco on purpose: `MeshoptDecoder` is an ES module that
bundles, so there is no extra decoder file to fetch at runtime.

## Gotchas paid for the hard way

* Rollup rejects `-x ** 2`; write `-(x ** 2)`.
* meshopt gives **normalised int16, interleaved** attributes.
  `BufferGeometry.applyMatrix4` writes floats straight back into that array and
  ignores the `normalized` flag, so baking a world matrix turns the car into a
  cube of confetti. Convert via `getX/getY/getZ` first (`toFloat`).
* GLTFLoader replaces spaces in node names with underscores.
* An asset pack does not lay bodies out in a row facing one way — this one uses
  a ring, each at its own yaw. Always square a body up before measuring it.
* `.glb` is not in Vite's default `assetsInclude`; without it the import 500s.
* Three injects `colorspace_pars_fragment` into ShaderMaterial prologues
  already — including it again fails to compile, and a full-screen pass that
  fails to compile is a black frame with no error.
* External contracts that must not break: `userData.paintMat.color`,
  `tailMat.emissiveIntensity`, `headMat.emissiveIntensity` (0.4/2.2/16),
  `glows[].material.opacity`, `wheels[].userData.spin` (rotated about **X**)
  and `.radius`, `blues[].material`, `led.userData.{on,off}`.
  `MAT.make(hex, metal, rough)` is still used by `buildTruck`.
