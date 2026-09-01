# HANDOFF — car visuals

Branch: `worktree-agent-ab87f7790c1fb62c5` (Phase C). Phase A and B were on
`worktree-agent-a6340a3413cc4f8e9`.

## Phase C — the lorry (done)

**All fourteen vehicles are now on licensed glTF models.** The artic was the
last procedural one and the weakest thing on the road; it is now ROY's cab-over
box lorry.

| id | model | author | tris | file |
|---|---|---|---|---|
| `truck` | Truck | ROY | 17.9 k | `car-lorry.glb` 129 kB |

CC BY 4.0, checked twice: `asset.extras` inside the file we ship, and
Sketchfab's live model API (`"label": "CC Attribution", "slug": "by"`).
CREDITS.md has both, plus the author's stale handle.

### The dead end, and why it was not one

The note below in Phase B said the wheels would not decompose: tyres 1.39 m
across, trailer axles ~1.5 m apart, so no clustering radius separates two axles
without cutting one tyre into three. **All of that is true, and it is the wrong
question.** Distance is not what distinguishes two adjacent wheels. Connectivity
is: no triangle of one wheel shares an edge with a triangle of the next, however
close they sit.

So `src/carFit.js` gained:

* `componentLabels(geo, tol)` — weld vertices by quantised position at 0.2 mm
  (a glTF export carries one vertex per face corner, and an unwelded index
  buffer has no connectivity in it at all), then union-find over the index
  buffer.
* `wheelIslands(geo)` — the components, as triangle lists with extents.
* `groupWheels(islands)` — islands into wheel units.
* `trianglesToGeometry(geo, tris)` — rebuild a wheel from its islands with
  every attribute intact.
* `squaredYaw(geos, tolDeg)` — see below.

**One island per wheel is false, and knowing why matters.** A wheel is a tyre,
a rim, a dish, a hub cap and ten separate wheel nuts: this lorry's eighteen
wheels come to eighty-two islands in the raw file, seventy-nine after `dedup`.
Labelling components and calling each one a wheel gives you eighty-two wheels.

What makes it work anyway is that **every island of one wheel is concentric with
it.** Their centroids sit within a hub's width of each other — 0.42 m of spread,
mostly the wheel nuts — while two axles are 1.67 m apart. So clustering island
*centroids* has two orders of separation where clustering triangles had none,
and it cannot fragment a wheel, because a wheel's islands are not spread out.
`groupWheels` splits left from right on the sign of the centroid's x (no road
wheel straddles the centreline) and then single-links along z with a gap of
0.42 × tyre diameter. Eight units, first try, nothing to tune.

It also drops anything that is not round in side elevation and standing up,
which is how the spare lashed flat under the bed — sharing the `tyres` material
with the road wheels — stays part of the body instead of becoming a ninth wheel
mounted sideways.

### Two other things that had to be true

* **`squareYaw` is exact and still not good enough on a 16 m body.** The
  minimum-area rectangle is fitted to the whole silhouette, and this model's
  mirror arms drag it 1.13° off true on a body that was exported axis-aligned.
  1.13° is nothing on a 4 m car. On the lorry it moved the steer axle 15 cm
  sideways relative to the tail and the wheels came out visibly staggered —
  the left and right of the same axle landed at x = −0.728 and +0.565.
  `squaredYaw` snaps to a right angle when the answer is within 3° of one.
  It is used only by the lorry; the thirteen cars still go through `squareYaw`
  unchanged, and their fleet-check rows are byte-identical to before.
* **A lorry is not scaled on its wheelbase.** A car is, because a wheel in the
  wrong place is the error you cannot stop seeing. A lorry has four axles and
  nothing that answers to "the wheelbase", and its wheels are tucked under a
  slab-sided box where nobody can read one anyway. What does show is whether it
  is as long as the lane markings and as wide as the lane, so it is scaled on
  the geometric mean of the length and width ratios — which splits the error
  between the two instead of putting all of it into one. 15.00 × 2.69 × 4.09
  against a declared 15.8 × 2.55 × 4.0, so −5 / +5 / +2 %, all inside
  fleet-check's 10 / 10 / 20 % tolerance.

### What the model is, and what it is not

It is a **rigid four-axle box lorry**, not a tractor and semitrailer. That was
a deliberate trade and it is the one thing to argue with if you want to.

Every full artic in the Objaverse mirror under an acceptable licence is an
**American conventional** — long-nose Peterbilt/Kenworth cab, US flatbed or
reefer. Eight were downloaded and rendered side-on before the call was made
(`Truck Trailer` cmitche1, `Semi Truck` Burhan / rio3dstudios / Urdons /
Ervinas, `Semi-Truck Lowpoly Model` Syed.Irfan, `18 Wheeler` Kyle Valadez,
`Semi Truck (5 Axles)` MiriamJardine — all CC BY, all conventionals). A
four-axle cab-over box lorry is ordinary on the A81; a long-nose American
tractor is not, and it is the sort of wrong that a German player sees
instantly. Nothing user-facing ever says "Sattelzug" — it was a comment in
`carFactory.js` and a line in the README, both now corrected. The physics,
the collision box and `dims` are untouched: still 38 t, 15.8 m, 2.55 m wide.

If a European cab-over artic ever turns up in a mirror, swapping it in is a
recipe change in `LORRY` plus a new file. Nothing else needs to move.

### Wiring

* `carFactory.js`: `setTruckProvider` — the same hook `buildCar` already had —
  and `plateMesh` is now exported. `buildTruck` falls straight through to the
  procedural lorry if the model is missing, still loading, or `?nomodels=1`.
* `carModels.js`: `fitTruck` and `assembleTruck`, plus `truckFit()` and
  `hasTruckModel()` for the harnesses. The truck does **not** go through
  `fitTemplate`: it is not in `CARS`, it has no spec, no wheelbase and no four
  corners, and every step of the fit differs.
* The cab (`head_paint`) and the box (`bodycolour`) are separate materials and
  are tinted separately per lorry, which is exactly what the traffic director
  was already passing to `buildTruck` as `{cab, box}` and the procedural body
  already honoured. Brake lights are cloned per lorry too, or the whole convoy
  brakes together.
* Steer axle wheels get `userData.front = true`, so they turn. The procedural
  lorry's never did — `buildWheel` does not set it and `buildTruck` did not
  either.

### Numbers

Headless Chromium / SwiftShader, same machine as the Phase B figures.

| | tris/frame | calls/frame | scene | load |
|---|---|---|---|---|
| Phase B — procedural lorry | 1,193,472 | 1,809 | 675 k | ~11 s |
| **now — model lorry** | **1,425,394** | **1,880** | **718 k** | ~17 s |

The lorry itself: 7.5 k → 17.9 k triangles, 34 meshes against the procedural
body's ~50. Four of them ride at once (16 % of the traffic mix), so unique
scene geometry is +43 k, or +6.4 %. Load time on this machine is noise — the
same build measured 8.0 s and 17.3 s in different sessions.

Getting from 36.3 k to 17.9 k is worth knowing about. Two thirds of the raw
count was wheels — the four tractor rims were 3 052 triangles *each* — and
`--ratio` does nothing about it, because meshoptimizer stops at the error
bound first: `--ratio 0.45` and `--ratio 0.30` produced **byte-identical**
files. The default `--error 0.0012` is relative to the mesh's own size, and on
a 1.4 m wheel that is under two millimetres. `dev/optimise-model.sh` now takes
the error as a fifth argument; the lorry ships at `512 0.35 0.005`, which
reproduces the committed file byte for byte.

### Also changed

* `dev/credits-check.mjs` now distinguishes a **quoted** URL from an
  **asserted** one. ROY renamed his Sketchfab account after Objaverse
  snapshotted the file, so the handle inside the GLB (`roy.gearloft.in`) 404s
  while the account lives at `roy.3dartist`. CREDITS.md quotes `asset.extras`
  verbatim, as it does for every other model, and rewriting that quote to
  please a link checker would be falsifying evidence. A URL that appears only
  inside an inline code span is listed as `quot` and not fetched; a URL
  asserted in prose anywhere in the file is still fetched; and the rule with
  actual teeth — every shipped GLB's own `source` must be cited in CREDITS.md —
  is untouched.
* `dev/fleet-check.mjs` prints `wheels=8` instead of `wb=undefined/undefined`
  for a vehicle with no wheelbase. No assertion changed.
* `dev/fleet.js` reports the lorry in `window.__fit` and `window.__model`.

### Screenshots

`dev/shots/after-lorry-{side,front,f34,r34}.png` from the bench, and
`after-lorry-road-{pass,convoy,mirror}.png` in the game: overtaking one on the
A81, a convoy of three in the right-hand lane, and one filling the rear-view
mirror. `after-lorry-front.png` is the badge evidence — nothing modelled in the
middle of the grille.

### Still open

* The lorry's rear overhang is long — the bogie sits about 3.8 m forward of the
  tail. That is the model's own proportion and fixing it means cutting up
  somebody else's geometry.
* Its tyres are 1.31 m across after scaling, where a real truck tyre is about
  1.05 m. The model exaggerates them; scaling them down on their own would
  leave the arches empty.
* The box sides are smooth. Real curtainsiders and box bodies have rails and
  ribs, and a decal or two would make a convoy read as three hauliers instead
  of three of the same lorry in different colours. Cheapest win available here.

---

## Phase A — the backwards cars (fixed)

Shipped state was: three of the four traffic cars pointed the wrong way and
several had wheels outside the arches. `dev/shots/after-model-traffic.png` on
the previous commit shows it. Root causes, all in the fitting stage:

1. **`principalYaw` was approximate and sometimes wrong by 18 degrees.** It
   sampled yaw at one-degree steps over a *subsample* of vertices, and
   subsampling misses the extreme points that define a bounding box. The estate
   squared up 18 degrees out and measured 2.78 m wide. Replaced by `squareYaw`
   in the new `src/carFit.js`: exact minimum-area rectangle via the convex hull
   (the optimum always has a side flush with a hull edge). Sign convention was
   also inverted, which only showed on bodies that were not already axis-aligned.
2. **Nothing decided which end was the nose.** The recipe applied a flat
   `yaw: Math.PI` to all four pack cars, on the assumption that a pack lays its
   models out facing one way. This one arranges ten cars in a ring. Replaced by
   `noseSign`, which votes on four cues: bonnet run, roof position,
   side-elevation area centroid, and — decisively — **where the wing mirrors
   are**, since mirrors are always at the front even on a rear-engined car,
   which is the case the other three cues get wrong on the 911.
3. **The pack merges wheels by material, not by car.** The saloon and the
   estate share a wheel design, so "the estate's wheel set" was eight wheels
   belonging to two cars, and splitting it into quadrants gave a 1.48 m
   wheelbase on a 4.4 m car. Everything scaled from that was wrong. Wheels are
   now clipped to the body's own footprint before being measured.
4. **Wheels were bolted to the rig's track**, which is wider than some model
   bodies. They now go just inside the arch, measured on the body at that axle.
5. **The artic's dual tyres stood 23 cm proud of its own trailer.** Moved in.

`dev/fleet-check.mjs` exists so this cannot happen again — see below.

Also fixed while measuring: `envelopeOf` and `roofHeight` in `carFit.js` size a
vehicle from z-slice and y-slice profiles rather than a bounding box, because
the 911 wears a radio aerial 43 cm above its roof and the artic carries fuel
tanks wider than its trailer, and neither should define the vehicle. All
profiles are taken over **triangles**, not vertices: a procedural box has eight
corners and nothing in between, so a 13 m trailer otherwise contributes to two
z-slices out of forty-eight.

Two things happened here. The cars got a real rendering pipeline — HDR
environment, clearcoat paint, panel gaps, better geometry, bloom — and then
they got **real glTF bodies** under a licence we can actually ship.

## What ships

All fourteen vehicles are on licensed glTF models. The lorry was the last one
and is covered in Phase C above.

| id | model | author | tris | file |
|---|---|---|---|---|
| `turbo` | FREE 1975 Porsche 911 (930) Turbo | Lionsharp Studios | 38.8 k | `car-930.glb` 1035 kB |
| `m5`, `zivi_limo` | Generic sedan 2010 | Daniel Zhabotinsky | 8.1 k | `car-sedan10.glb` 215 kB |
| `amg` | '07 Generic Coupe | Daniel Zhabotinsky | 12.9 k | `car-coupe07.glb` 277 kB |
| `rs6`, `zivi_touring`, `zivi_avant`, `kombi` | Generic USA/EU Station wagon | Anserkon | 8.2 k | `car-wagon-eu.glb` 149 kB |
| `zivi_kompakt`, `hatch` | Modern Hatchback | Daniel Zhabotinsky | 9.4 k | `car-hatch11.glb` 248 kB |
| `messwagen`, `van` | Light Commercial Truck '07 | Daniel Zhabotinsky | 9.4 k | `car-lcv07.glb` 322 kB |
| `taxi` | Generic SUV | Daniel Zhabotinsky | 12.0 k | `car-suv10.glb` 263 kB |
| `truck` | Truck | ROY | 17.9 k | `car-lorry.glb` 129 kB |

All CC BY 4.0. Every marque is invented or generic, so nothing had to be
de-badged. 2.6 MB of models in total.

Reusing one file across several vehicles is deliberate: the second template
costs no bytes and shares its textures on the GPU, and an unmarked patrol car
that looks like the hatchback beside it is the point of an unmarked patrol car.

Licences, the required attribution strings and the full rejection record are in
`CREDITS.md`. The CC-BY credit is also rendered in the menu (`src/credits.js`),
because that licence requires it visibly wherever the work is shared.

## Where the models come from — read this before hunting for more

Sketchfab's download endpoint needs OAuth. The previous research recorded that
as the end of the road. It is not.

**AllenAI's Objaverse 1.0** on HuggingFace is a public snapshot of CC-licensed
Sketchfab models, fetchable by uid with no account, token or referrer:

```
https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/<shard>/<uid>.glb
```

The shard for a uid comes from `object-paths.json.gz` in the same dataset
(798,759 entries; a local copy is at `/tmp/carhunt/github/`). Sketchfab's *search*
API is open and is how you find uids:

```
https://api.sketchfab.com/v3/search?type=models&q=<query>&downloadable=true&count=24&cursor=0
https://api.sketchfab.com/v3/search?type=models&user=DanielZhabotinsky&downloadable=true&count=24
```

Do **not** pass `&licenses=<uid>`. The uuids are easy to get wrong and the API
400s the whole query when you do — and worse, the one commonly copied around,
`b9ddc40b93e34cdca1fc152f39b9f375`, is CC-BY-**SA**, not CC-BY. Either use the
slugs (`&licenses=by`, `&licenses=cc0`) or read `license.label` off each result
and keep `CC Attribution`, rejecting anything with `Share Alike`.

Paging the search API is also the slow way round. Objaverse publishes per-shard
metadata, so the whole snapshot can be indexed offline once and queried locally;
a 65,851-row index of every CC-BY/CC0 vehicle-ish object in it was built during
this work and left at `/tmp/carhunt2/work/idx2.json`.

The files are Sketchfab's own exports, so each carries author, licence and
source URL in `asset.extras`. `node dev/glb-licence.mjs <file>` prints it. A
CC BY grant is irrevocable and travels with the work.

Three things that cost time to learn:

* **The snapshot is December 2022.** Anything uploaded later is not in it. Of
  the four Zhabotinsky models originally named as targets, two are (Ace '11,
  Saba V12 '95) and two are not (Shvan 92 Traveller, Urban '10 Cop Enforcer).
* **Zhabotinsky's catalogue is 133 models, 47 of which are mirrored, and all 47
  are already downloaded** to `/tmp/carhunt/zhabotinsky*`. That seam is fully
  mined; `dev/scratch/zhabcat.mjs` in the branch history is the script that
  proves it. For more of his work you need a different mirror.
* He later **renamed** many models to invented marques, so the 2022 snapshot
  carries the original titles — and some of those are recognisable real cars.
  Titles naming a real vehicle are rejected on trademark grounds regardless of
  licence. CREDITS.md lists them.

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
| `src/carFit.js` | **New.** The fitting geometry, as pure functions over `BufferGeometry` — no assets, no DOM, no renderer, so it can be exercised straight from Node. `squareYaw`, `noseSign`, `archAxles`, `envelopeOf`, `roofHeight`, `sliceProfile`, `clipToFootprint`, `wheelCorners`, `halfWidthAt` — and from Phase C `squaredYaw`, `componentLabels`, `wheelIslands`, `groupWheels`, `trianglesToGeometry`. |
| `dev/fleet.html`, `dev/fleet.js` | **New.** Builds every id in `CARS` plus the truck through the real path. `?ids=&mode=&layout=row\|grid\|stack&env=&grid=1&paint=`. |
| `dev/fleet-check.mjs` | **New.** The gate. Asserts facing, wheels-in-arches, wheels-on-ground, envelope and the `userData` contract for all 14 vehicles; `--shots <dir>` also writes the contact sheets. Exits non-zero on any failure. |
| `dev/optimise-model.sh` | **New.** Prepare a downloaded GLB for shipping. 1.3–4.5 MB → 150–330 kB with the geometry untouched. |
| `dev/rename-glb.mjs` | **New.** Rewrite a model's material and node names in place, for authors who ship `.001`, `material`, `Material` and Cyrillic node names. `--list` first. |
| `dev/glb-licence.mjs` | **New.** Print the author/licence/source a GLB carries in `asset.extras`. |
| `dev/credits-check.mjs` | **New.** Gate for provenance: every shipped GLB must declare an acceptable licence *and* have its source URL cited in CREDITS.md, and every URL in CREDITS.md must resolve. |

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
| main, before any of this | 516,772 | 1,428 | 4.2 s |
| `?nomodels=1` (procedural fallback) | 558,632 | **1,152** | 8.0 s |
| end of Phase A — 5 vehicles on models | 1,062,814 | 1,751 | ~11 s |
| **now — 13 vehicles on models** | **1,188,376** | **1,799** | ~11 s |

Eight more real vehicles cost +126 k triangles and **+48 draw calls**, because
`fitTemplate` merges bodies per material and these models carry few materials.
Unique scene geometry is 675 k.

Frame counts include the shadow pass and the 30 Hz mirror pass, so they are
roughly 2–3× the scene's unique geometry (590 k). Load time on this machine is
inflated — the no-models figure was 4.9 s earlier in the session and 8.0 s at
the end, on identical code.

**fps is not measured here and cannot be** — SwiftShader renders this at about
1 fps. Use the in-game readout (F) on real hardware.

## Gaps and known issues

* **The lorry is done** — see Phase C at the top of this file. The dead end
  recorded here through Phase B was real but mis-diagnosed: the wheels do not
  decompose by distance and never will, and they do not need to. They
  decompose by connected component. The full reasoning, including why "one
  island per wheel" is also false, is in Phase C and in the long note at the
  bottom of `src/carFit.js`.
* **The estate is a de-badged VW Passat B6 Variant.** The title is generic and
  no badge is modelled, but the author's description says so outright. Same
  category of decision as the 930, and flagged the same way — CREDITS.md has
  the reasoning and the two alternatives, both worse. Reversing it is a two-line
  recipe change.
* **Four vehicles share the estate body** (`rs6`, `kombi`, both Zivi estates)
  and three pairs share other files. Traffic paint is randomised so it reads as
  variety on the road, but a fifth traffic shape would be an easy win if a
  modern generic saloon that tints turns up.
* `zivi_touring` and `zivi_avant` are the same model at 1.10× and 1.07× scale.
  Side by side in a contact sheet that is obvious; in a mirror at speed it is
  not. A different estate for one of them would fix it.
* The 930 is a **1975 car** wearing 992 performance figures. It is the only
  legitimately-licensed 911 available. Flagged for the owner.
* The menu still shows the owner's photographs of real M5 / RS6 / AMG cars on
  the FOTO toggle, which no longer match the 3D models behind them. Left alone
  — they are the owner's own photographs, supplied deliberately.
* `dev/lang-check.mjs` referenced `hud-rear-title`, which exists neither here
  nor on main; it now reads such ids defensively instead of throwing.
* `vite preview` could not serve the built bundle on this machine — it answered
  404 for an asset `curl` fetched happily from the same URL. `prod-check` is run
  against a plain static server instead; see "Running the gates".

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


## Running the gates

```
npx vite --port 5301 --strictPort &          # dev
npx vite build
python3 -m http.server 4374 --bind 127.0.0.1 --directory /tmp/prodroot &   # /tmp/prodroot/vollgas -> dist

node dev/fleet-check.mjs    http://localhost:5301/ --shots dev/shots
node dev/lang-check.mjs     http://localhost:5301/ /tmp/langshots
node dev/phys.mjs           http://localhost:5301/
node dev/arrest-check.mjs   http://localhost:5301/ /tmp/arrest.png
node dev/busted-check.mjs   http://localhost:5301/ /tmp
node dev/physics2-check.mjs http://localhost:5301/ /tmp/p2.png
node dev/penalty-check.mjs  http://localhost:5301/ /tmp/pen.png
node dev/prod-check.mjs     http://127.0.0.1:4374/vollgas/ /tmp/prod.png
node dev/credits-check.mjs
```

`vite preview` could not be used for `prod-check` on this machine — it answered
404 for an asset that `curl` fetched happily from the same URL. A plain static
server rooted so that `/vollgas/` maps to `dist/` works, and is what the numbers
below were measured on.
