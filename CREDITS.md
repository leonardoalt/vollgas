# Credits

Vollgas began with no art assets at all — every mesh, texture and sign was
generated at load time. That is still true of the world, the signage and most
of the traffic. It is no longer true of the cars, and this file records exactly
what came from where.

The in-game attribution required by CC BY is rendered in the car-select panel
(`src/credits.js`), not only here.

## 3D models

### How these were obtained, and why that is legitimate

Sketchfab's own download endpoint needs OAuth, which made it look like a dead
end. It is not the only place its files exist. **Objaverse 1.0** — a public
research dataset published by the Allen Institute for AI on HuggingFace — is a
December 2022 snapshot of CC-licensed Sketchfab models, served without an
account, a token or a referrer:

```
https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/<shard>/<uid>.glb
```

(the shard for a uid comes from `object-paths.json.gz` in the same dataset).

The files are Sketchfab's own glTF exports, so each one carries the author, the
licence and the original model URL inside `asset.extras`, written by Sketchfab's
exporter. That is the evidence quoted below, and it is read **out of the file we
actually ship** — run `node dev/glb-licence.mjs src/assets/models/*.glb` to see
it. A CC BY grant is irrevocable and travels with the work, so redistribution
through the mirror is legitimate and so is our use, provided we credit.

Two consequences worth knowing:

* The snapshot is from **December 2022**. Anything uploaded to Sketchfab after
  that is not in it.
* Daniel Zhabotinsky later renamed many of his models to invented marques. The
  2022 snapshot therefore carries the **original titles**, and some of those
  originals are recognisable real cars. Titles that name a real vehicle were
  rejected on trademark grounds regardless of licence — see "Rejected".

### The first two

Both are **CC BY 4.0**: commercial use allowed, attribution required. The
licence text quoted below is the `license.txt` shipped inside each model's own
distribution, and the same attribution is embedded in `asset.extras` of the
GLBs we ship.

### FREE 1975 Porsche 911 (930) Turbo — used for `turbo`

* Author: **Lionsharp Studios** — <https://sketchfab.com/lionsharp>
* Source: <https://sketchfab.com/3d-models/free-1975-porsche-911-930-turbo-8568d9d14a994b9cae59499f0dbed21e>
* Licence: **CC BY 4.0** — <https://creativecommons.org/licenses/by/4.0/>
  > `* license type:	CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)`
  > `* requirements:	Author must be credited. Commercial use is allowed.`
* Required credit, verbatim:
  > This work is based on "FREE 1975 Porsche 911 (930) Turbo"
  > (https://sketchfab.com/3d-models/free-1975-porsche-911-930-turbo-8568d9d14a994b9cae59499f0dbed21e)
  > by Lionsharp Studios (https://sketchfab.com/lionsharp) licensed under
  > CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
* Shipped as `src/assets/models/car-930.glb` (2.58 MB).
* **What we changed:** optimised with `@gltf-transform/cli` (textures to WebP at
  1024 px, meshopt compression), 241 k → 150 k triangles. Then, at load time in
  `src/carModels.js`: the `930_stickers` and `plate` materials are dropped
  (badges, model lettering and the modeller's licence plate — we fit a German
  one), the `930_wunderbaum` hanging air freshener is dropped as it is another
  party's trademark, the modeller's ground-shadow quad is dropped, and the
  duplicated `coat` shell is dropped because we apply a real clearcoat. The
  remaining paint material is tinted to the player's chosen colour and given
  our environment map. Net in game: ~124 k triangles.

### Generic passenger car pack — no longer shipped

* Author: **Comrade1280** — <https://sketchfab.com/comrade1280>
* Source: <https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5>
* Licence: **CC BY 4.0** — <https://creativecommons.org/licenses/by/4.0/>
  > `* license type:	CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)`
  > `* requirements:	Author must be credited. Commercial use is allowed.`
* Required credit, verbatim:
  > This work is based on "Generic passenger car pack"
  > (https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5)
  > by Comrade1280 (https://sketchfab.com/comrade1280) licensed under
  > CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
* Shipped as `src/assets/models/car-generic-pack.glb` (1.68 MB).
* **What we changed:** same optimisation pass. At load time we take one body out
  of the ten in the file per traffic type, drop a stray cylinder, and fit our
  own procedurally generated wheels because the pack's wheel designs are laid
  out beside the bodies rather than mounted on them.
* This pack carries **no marque badges of any kind** — it is deliberately
  trademark-free, which is why it was chosen for traffic.
* **Removed in Phase B and no longer in the repository.** Two reasons, neither
  of them a complaint about the licence: its bodies are 2.7 k triangles next to
  a 39 k triangle 911, and each one has its colour baked into the material, so
  tinting a car blue produced a dark green car and every saloon in the traffic
  would have been the same shade. The entry stays here because the record of
  what was shipped, and under what terms, should not be edited away.

### Generic sedan 2010 — used for `m5`

* Author: **Daniel Zhabotinsky** — <https://sketchfab.com/DanielZhabotinsky>
* Source: <https://sketchfab.com/3d-models/generic-sedan-2010-low-poly-model-7fd6e15785fa4aa9bfd6e31eb7c97ba6>
* Mirror used: <https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-107/7fd6e15785fa4aa9bfd6e31eb7c97ba6.glb>
* Licence: **CC BY 4.0**, from the file's own `asset.extras`:
  > `"license": "CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)"`
  > `"author": "Daniel Zhabotinsky (https://sketchfab.com/DanielZhabotinsky)"`
* Required credit:
  > This work is based on "Generic sedan 2010 - Low poly model"
  > (https://sketchfab.com/3d-models/generic-sedan-2010-low-poly-model-7fd6e15785fa4aa9bfd6e31eb7c97ba6)
  > by Daniel Zhabotinsky (https://sketchfab.com/DanielZhabotinsky) licensed
  > under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
* Shipped as `src/assets/models/car-sedan10.glb` (215 kB, 12.9 k triangles).
* **What we changed:** `dev/optimise-model.sh` (textures to 512 px WebP, meshopt),
  1.32 MB → 215 kB with the geometry untouched. At load time the rims are
  measured and then not drawn — carFactory's wheels go on instead — and the
  paint material is tinted to the player's chosen colour.
* The marque is invented and the model carries **no badge and no plate**.

### Bmw M5 F90 — used for `m5`

* Author: **RES1N** — <https://sketchfab.com/Res1n>
* Source: <https://sketchfab.com/3d-models/bmw-m5-f90-5478e978bd634337adc8e3dc413fbfa3>
* Licence: **CC BY 4.0**, from the file's own `asset.extras` and confirmed
  against the live Sketchfab API (`"label": "CC Attribution", "slug": "by"`).
  The handle inside the file is the older `Resinnnn`; the live profile is
  `Res1n`. Both are recorded so the trail is complete, as with the lorry.
* Required credit:
  > This work is based on "Bmw M5 F90"
  > (https://sketchfab.com/3d-models/bmw-m5-f90-5478e978bd634337adc8e3dc413fbfa3)
  > by RES1N (https://sketchfab.com/Res1n) licensed under CC-BY-4.0
  > (http://creativecommons.org/licenses/by/4.0/)
* Shipped as `src/assets/models/car-m5f90.glb` (1.27 MB, 47.9 k triangles),
  down from 37.6 MB and 259,936.
* **What we changed:** the `INT_`/`int_` interior, the engine block and the
  motion-blur rim variants are dropped, and so are seven badge meshes the
  author had already separated — `bmwlogo`, `logo_bmw_m`, `M_Badge_Max`,
  `M_RimBadge_Max`, `badgeext` and two `BMW_M5CompetitionReward` pieces. The
  model's own plate and stickers go too; the game fits a German plate.
* **Not decimated by `dev/optimise-model.sh`.** See the note on the RS6 below —
  the same split-vertex problem, the same fix.
* This model is visibly assembled from several sources: `Carpaint` and
  `EXT_Tyre` sit alongside `5___Default`, `h4343` and `0rewrewrwe`. That is
  cosmetically untidy but harmless, and the wheels are cleanly named, which is
  all the measuring pass needs.

### Audi RS6 — used for `rs6`

* Author: **3DCars4U** — <https://sketchfab.com/3dcarsforyou>
* Source: <https://sketchfab.com/3d-models/audi-rs6-b2e41d08880a4e72b31cf366f2e0dd2b>
* Licence: **CC BY 4.0**, in the file and on the live API.
* Required credit:
  > This work is based on "Audi RS6"
  > (https://sketchfab.com/3d-models/audi-rs6-b2e41d08880a4e72b31cf366f2e0dd2b)
  > by 3DCars4U (https://sketchfab.com/3dcarsforyou) licensed under CC-BY-4.0
  > (http://creativecommons.org/licenses/by/4.0/)
* Shipped as `src/assets/models/car-rs6c8.glb` (0.68 MB, 54.6 k triangles),
  down from 37.0 MB and 1,204,335.
* **What we changed:** `interior.001` and the two licence-plate materials are
  dropped; the game fits its own plate. No badge geometry to remove — there is
  none, and no rings appear in the render.
* **Why gltfpack and not `dev/optimise-model.sh`.** Both this and the M5 are
  exported with split vertices — hard normals on every triangle — and
  `gltf-transform weld` merges only *bitwise identical* vertices, so
  meshoptimizer had no shared edges to collapse. The M5 would not go below
  193 k triangles at any ratio, with `--error` unconstrained and
  `--lock-border false`. gltfpack welds with a tolerance first and both then
  decimate normally. **Texture passes must run before gltfpack**: running
  gltf-transform `meshopt` over gltfpack's already-quantised output corrupts
  the positions and the car loads flat, with a bounding box of 32767 x 0 x 0.

### A note on where these two came from

Neither is in the Objaverse mirror, which is why the earlier searches never
found them; both were fetched from Sketchfab directly with the owner's API
token. That opens a much larger pool, and a hazard with it. Several CC-BY
listings for these exact cars are re-uploads of other people's NonCommercial
work with a licence the uploader had no right to grant — one candidate matched
a known BY-NC-SA model's triangle count to within a single triangle, and
another's own description admitted its textures came out of Assetto Corsa.
Both were rejected. The two above were chosen partly because their authors
have coherent catalogues of their own work.

### 2010 Mercedes SLS AMG — used for `amg`

Obtained directly from Sketchfab with the owner's API token rather than through
the Objaverse mirror, which does not contain it. That is the only reason the
earlier searches never surfaced it: they were searching the mirror's 798,759
objects, not Sketchfab.

* Author: **Dave Love** — <https://sketchfab.com/Tyler_Dave>
* Source: <https://sketchfab.com/3d-models/2010-mercedes-sls-amg-fa3fd5eeea674f37bb03283f2c53d563>
* Licence: **CC BY 4.0**, checked twice.

  From the file's own `asset.extras`:
  > `"license": "CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)"`

  And from Sketchfab's live model API, which is the licence of record:
  > `"license": { "label": "CC Attribution", "slug": "by",`
  > `  "requirements": "Author must be credited. Commercial use is allowed." }`

  `CC Attribution`, not ShareAlike and not NonCommercial.
* Required credit:
  > This work is based on "2010 Mercedes SLS AMG"
  > (https://sketchfab.com/3d-models/2010-mercedes-sls-amg-fa3fd5eeea674f37bb03283f2c53d563)
  > by Dave Love (https://sketchfab.com/Tyler_Dave) licensed under CC-BY-4.0
  > (http://creativecommons.org/licenses/by/4.0/)
* Shipped as `src/assets/models/car-sls.glb` (0.61 MB, 16.5 k triangles),
  down from 13.7 MB and 178,369 triangles.
* **What we changed**, all offline so that load time is unaffected:
  * The interior is prefixed `INT_` throughout and came to 105,797 triangles —
    59% of the model. Dropped: this is a closed coupé, so nothing of the cabin
    reads through the glass at the distance the car is seen from. The blurred
    motion-rim variants and the damage-glass state went with it.
  * The branding atlas on `Details.005` carried a MERCEDES-BENZ laurel roundel,
    the AMG wordmark and a plain star in one 512 px map, with a matching
    embossed normal map. Both were painted flat, so those three read as blank
    chrome bosses.
  * `dev/optimise-model.sh … 512 0.35 0.006`.
  * At load `EXT_PLATE_plastic` is dropped — the modeller's plate reads
    ASSETTO CORSA — and a German one is fitted in its place. The model's own
    wheels are measured but not drawn, as with the rest of the fleet.
* **The grille star is still there, knowingly.** It is modelled into
  `Chrome.005`, a mesh that also carries the window and grille trim, so it
  cannot be dropped wholesale; it survived a spatial cut of the 332 triangles
  at the nose centreline, and it is not in any texture — every map on that
  material is absent. The owner chose to keep it rather than spend more time on
  it. `dev/scratch/glb.js` has the isolation harness that established this, and
  the SL 63 below is a fully de-badged alternative if that decision changes.
* The brake calipers carry a small `AMG` wordmark in their texture
  (`baseColor_15`), legible only in a wheel close-up, not at driving distance.

### Mersedes-Benz SL63 AMG — evaluated, not shipped

Prepared to the same standard and fully de-badged, kept as the fallback if the
SLS's grille star is ever judged unacceptable.

* Author: **Black Snow** — <https://sketchfab.com/BlackSnow02>
* Source: <https://sketchfab.com/3d-models/mersedes-benz-sl63-amg-free-f7a625e6f5de425e89e84ae2e92cad65>
* Licence: **CC BY 4.0**, from the file's own `asset.extras` and the live API.
* 431,595 → 36,902 triangles, 0.52 MB. The star, the "AMG" and "SL 63" boot
  lettering and a rear logo all came off cleanly: the visible star is *not* the
  28-triangle mesh called `SL63_badge-F-AMG`, it is a 3,130-triangle mesh inside
  the grille group called `Sl63_grille-F-AMG_SL63_silver`.
* Not shipped because it is a roadster modelled roof-down, so the stripped
  cabin is a visible hollow. Keeping its seats would cost a few thousand
  triangles and make it usable.

### Modern Hatchback — used for `zivi_kompakt` and `hatch`

* Author: **Daniel Zhabotinsky** — <https://sketchfab.com/DanielZhabotinsky>
* Source: <https://sketchfab.com/3d-models/modern-hatchback-low-poly-model-055ff8a21b8d4d279debca089e2fafcd>
* Mirror used: <https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-125/055ff8a21b8d4d279debca089e2fafcd.glb>
* Licence: **CC BY 4.0**, from the file's own `asset.extras`:
  > `"license": "CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)"`
* Required credit:
  > This work is based on "Modern Hatchback - Low Poly model"
  > (https://sketchfab.com/3d-models/modern-hatchback-low-poly-model-055ff8a21b8d4d279debca089e2fafcd)
  > by Daniel Zhabotinsky (https://sketchfab.com/DanielZhabotinsky) licensed
  > under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
* Shipped as `src/assets/models/car-hatch11.glb` (248 kB, 10.1 k triangles).
* **What we changed:** `dev/optimise-model.sh`, 3.18 MB → 248 kB. Three
  materials for the whole car, which is why it is cheap to put several on the
  road at once. Its rims share the body material, so they are found by node
  name and then not drawn.
* Invented marque; no badges, no plate.

### Light Commercial Truck '07 — used for `messwagen` and `van`

* Author: **Daniel Zhabotinsky** — <https://sketchfab.com/DanielZhabotinsky>
* Source: <https://sketchfab.com/3d-models/light-commercial-truck-07-low-poly-model-3be03b6a43aa41898c9ca806b8787052>
* Mirror used: <https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-149/3be03b6a43aa41898c9ca806b8787052.glb>
* Licence: **CC BY 4.0**, from the file's own `asset.extras`.
* Shipped as `src/assets/models/car-lcv07.glb` (322 kB, 13.3 k triangles).
* **What we changed:** `dev/optimise-model.sh`, 4.52 MB → 322 kB. The body is a
  flat untextured material, so it takes the fleet's paint tinting cleanly.
* Invented marque; no badges.

### Generic USA/EU Station wagon — used for `rs6`, `zivi_touring`, `zivi_avant`, `kombi`

The estate the fictional-marque catalogue could not supply.

* Author: **Anserkon** — <https://sketchfab.com/anserkon>
* Source: <https://sketchfab.com/3d-models/generic-usaeu-station-wagon-c14f271c9d414b8e8d25e7cec3bb44f5>
* Mirror used: <https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-133/c14f271c9d414b8e8d25e7cec3bb44f5.glb>
* Licence: **CC BY 4.0**, from the file's own `asset.extras`:
  > `"license": "CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)"`
  > `"author": "Anserkon (https://sketchfab.com/anserkon)"`
* Required credit:
  > This work is based on "Generic USA/EU Station wagon"
  > (https://sketchfab.com/3d-models/generic-usaeu-station-wagon-c14f271c9d414b8e8d25e7cec3bb44f5)
  > by Anserkon (https://sketchfab.com/anserkon) licensed under CC-BY-4.0
  > (http://creativecommons.org/licenses/by/4.0/)
* Shipped as `src/assets/models/car-wagon-eu.glb` (149 kB, 18.5 k triangles).
* **What we changed:** its materials were named `.001`, `.002`, `material`,
  `Material` and its node names were Cyrillic, so `dev/rename-glb.mjs` renamed
  them offline before optimisation — every fitting decision keys off names, and
  encoding mojibake in a recipe works until somebody opens the file. Then
  `dev/optimise-model.sh`, 677 kB → 149 kB. At load time the modeller's rear
  plate quad is dropped and the wheels are measured but not drawn.
* No badges, no marque in the title, no logo modelled anywhere.
* **Trade-dress caveat — read this.** The title is generic and the model is
  clean, but the author's own Sketchfab description says:
  > "Un-copyrighted VW passat 2010 with basic interior"

  The body is a de-badged Volkswagen Passat B6 Variant. The licence is not in
  question; the *shape* is recognisable, in the same way the 930 is. This is a
  deliberate, flagged choice rather than an oversight, and the alternatives were
  worse:

  | option | trade dress | tintable | detail |
  |---|---|---|---|
  | Anserkon estate (**shipped**) | de-badged Passat B6 | yes | 18.5 k tris |
  | Comrade1280 pack `Wagon Body` | invented, clean | **no** — colour is baked into the texture, so every estate on the road would be the same shade | 4.6 k tris |
  | Zhabotinsky `Fairheaven SW '84` | invented, clean | yes | 23.6 k tris, but 1980s American, and 15% too long when scaled on the wheelbase |

  Reversing it is a two-line change in the `rs6` recipe in `src/carModels.js`.
  Daniel Zhabotinsky's *Shvan 92 Traveller* is the model that would settle this
  properly and is not reachable — see the note above about the 2022 snapshot.
* Anserkon was identified in the earlier search as one of the best-fitting
  authors available and written off as unreachable because no mirror existed.
  Objaverse is that mirror.

### Generic SUV — used for `taxi`

* Author: **Daniel Zhabotinsky** — <https://sketchfab.com/DanielZhabotinsky>
* Source: <https://sketchfab.com/3d-models/generic-suv-low-poly-model-2866efdfa943484391ef8313768e074d>
* Mirror used: <https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-005/2866efdfa943484391ef8313768e074d.glb>
* Licence: **CC BY 4.0**, from the file's own `asset.extras`.
* Required credit:
  > This work is based on "Generic SUV - Low poly model"
  > (https://sketchfab.com/3d-models/generic-suv-low-poly-model-2866efdfa943484391ef8313768e074d)
  > by Daniel Zhabotinsky (https://sketchfab.com/DanielZhabotinsky) licensed
  > under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
* Shipped as `src/assets/models/car-suv10.glb` (263 kB, 17.7 k triangles).
* **What we changed:** `dev/optimise-model.sh`, 1.53 MB → 263 kB. Flat
  untextured body material, so it tints cleanly.
* `taxi` keeps its id and its rig, but is now an SUV: traffic made only of
  saloons, estates and hatchbacks has nothing tall in it and does not read as a
  motorway.
* Invented marque; no badges.

### Truck — used for `truck`, the lorry

The last vehicle to come off the procedural loft, and the only one that is not
a car. A cab-over box lorry on four axles: steer, drive and a tandem rear
bogie on twinned tyres.

* Author: **ROY** — <https://sketchfab.com/roy.3dartist>
* Source: <https://sketchfab.com/3d-models/truck-eda924f23ba04cd5b1e5160abf2320fa>
* Mirror used: <https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-086/eda924f23ba04cd5b1e5160abf2320fa.glb>
* Licence: **CC BY 4.0**, and here checked twice over.

  From the file's own `asset.extras`, which is what we ship
  (`node dev/glb-licence.mjs src/assets/models/car-lorry.glb`):
  > `"license": "CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)"`
  > `"author": "ROY (https://sketchfab.com/roy.gearloft.in)"`
  > `"source": "https://sketchfab.com/3d-models/truck-eda924f23ba04cd5b1e5160abf2320fa"`

  And independently from Sketchfab's live model API, which is the licence of
  record rather than a string an exporter wrote into a file in 2022 —
  <https://api.sketchfab.com/v3/models/eda924f23ba04cd5b1e5160abf2320fa>:
  > `"license": { "label": "CC Attribution", "slug": "by",`
  > `  "fullName": "Creative Commons Attribution",`
  > `  "requirements": "Author must be credited. Commercial use is allowed.",`
  > `  "url": "http://creativecommons.org/licenses/by/4.0/" }`

  `CC Attribution`, not `CC Attribution-ShareAlike`: commercial use allowed,
  no copyleft, attribution required. Published 2022-08-30, inside the
  Objaverse snapshot.
* Required credit:
  > This work is based on "Truck"
  > (https://sketchfab.com/3d-models/truck-eda924f23ba04cd5b1e5160abf2320fa)
  > by ROY (https://sketchfab.com/roy.3dartist) licensed under CC-BY-4.0
  > (http://creativecommons.org/licenses/by/4.0/)

  **The handle in the file is stale.** `asset.extras` records the author as
  `sketchfab.com/roy.gearloft.in`, which is what the profile was called when
  Objaverse took its snapshot; it 404s today. The same account is now at
  `roy.3dartist` — same uid, same model, same author — so the credit above
  points at where the author actually is, which is what the attribution is
  for. Both handles are recorded here so the trail is complete.
* Shipped as `src/assets/models/car-lorry.glb` (129 kB, 17.9 k triangles).
* **What we changed:** `dev/optimise-model.sh in.glb out.glb 512 0.35 0.005`,
  1.30 MB → 129 kB and 36.3 k → 17.9 k triangles, which reproduces the shipped
  file byte for byte. Two thirds of the original count was in the wheels — the
  tractor rims alone were 3 052 triangles each — and the default 0.0012 error
  bound will not touch them, because on a 1.4 m wheel that is under two
  millimetres. At 0.005 the rims lose a ring of wheel-nut detail nobody can
  resolve from a car and the body is untouched. At load time `src/carModels.js`
  squares it up, turns it to face +Z, splits the wheels out of the body,
  scales it to the rig and tucks the steer axle 9.5 cm inboard so the tyres do
  not stand proud of the cab. The cab material (`head_paint`) and the box
  material (`bodycolour`) are tinted separately, which is what the traffic
  director was already asking `buildTruck` for.
* No badges, no marque. The title is "Truck", the author's description names
  no manufacturer, and nothing is modelled in the middle of the grille where a
  badge would go — see `dev/shots/after-lorry-front.png`. This is a cleaner
  case than the estate below, where the author's own description named the car.
* **Not an articulated lorry.** The rig is called a Sattelzug in the source and
  the physics is a 38 t artic's, but this model is a rigid box lorry: the body
  runs straight back from the cab with no fifth wheel and no articulation.
  That was a deliberate trade. Every full tractor-and-semitrailer in the mirror
  under an acceptable licence is an **American conventional** — a long-nose
  Peterbilt/Kenworth shape with a US flatbed or reefer behind it — which is the
  wrong vehicle for a German Autobahn in a way nobody would miss. Eight were
  downloaded and rendered side-on before this call was made
  (`Truck Trailer` cmitche1, `Semi Truck` Burhan / rio3dstudios / Urdons /
  Ervinas, `Semi-Truck Lowpoly Model` Syed.Irfan, `18 Wheeler` Kyle Valadez,
  `Semi Truck (5 Axles)` MiriamJardine — all CC BY, all conventionals). A
  four-axle cab-over box lorry is ordinary on the A81; a long-nose American
  tractor is not. Nothing user-facing says "Sattelzug", so the only cost is a
  comment in `src/carFactory.js`, now corrected.

### Provenance note

Both were checked for signs of being re-uploaded rips of commercial game
assets, which a large fraction of "free CC" car models are. Lionsharp Studios
is a studio with a coherent commercial portfolio and the model description is a
first-person account of its own mid-poly/clearcoat workflow; Comrade1280 has a
consistent original portfolio of trademark-free vehicles. Candidates that
failed this check were rejected — see "Rejected" below.

## Photographs

`src/assets/*-hero.webp` — the four car-select hero images.

Made by the project owner (Leo Alt) and supplied for this use. Not third-party
works; no external licence applies. Re-encoded from 1672×941 PNG (~1.5 MB each)
to 1440 px WebP (~58 kB each) and, for the 911, the two wheel-centre crests
were blanked so the set carries no marque badges, consistent with the rest of
the project. Bonnet and grille emblems on the M5 and AMG images had already
been removed by the owner before they reached this branch.

## Fonts

**Barlow Condensed** and **JetBrains Mono**, loaded from Google Fonts in
`index.html`, both under the SIL Open Font License 1.1. This is the only
external network request the game makes at runtime.

## Software

Three.js (MIT), Vite (MIT). `@gltf-transform/cli` (MIT) was used offline to
optimise the models; it is not a runtime dependency.

---

# Rejected sources — the research record

The question "can we just use real car models?" was investigated properly in
August 2026 against these requirements: licence permissive **and verifiable**
(CC0 / CC-BY / MIT), downloadable without an account, badge-free or trivially
de-badgeable, and plausibly authored by the uploader rather than ripped. This
record exists so nobody has to repeat the search.

**Structural finding:** Sketchfab's `/v3/models/{uid}/download` endpoint returns
HTTP 401 without OAuth, so Sketchfab is not directly usable as a source. Its
*search* API is open, and Sketchfab glTF exports carry `license.txt` plus
`asset.extras` attribution, so wherever such an export has been mirrored the
CC BY grant travels with it and remains valid regardless of the host's own
licence.

**The mirror that solved it:** AllenAI's **Objaverse 1.0** on HuggingFace, a
December 2022 snapshot of CC-licensed Sketchfab models, fetchable by uid with
no account. Described at the top of this file. This is what turned "no usable
realistic car models exist" into a catalogue of them, and it is the single most
useful thing to know when the fleet next needs extending.

| Source | Licence as actually stated | Verdict |
|---|---|---|
| Kenney Car Kit, OpenGameArt "Ultimate 3D Car Assets Pack", Quaternius cars | Genuinely CC0 | Clean licences, rejected on looks: stylised toy geometry, a visual downgrade on the procedural bodies. |
| three.js `examples/models/gltf/ferrari.glb` | **No licence.** three.js's MIT licence covers the software, not example media ([three.js#23089](https://github.com/mrdoob/three.js/issues/23089)) | Rejected. The credited Sketchfab source has since been disabled, i.e. taken down. Unverifiable licence, bad provenance, badged. |
| Khronos `CarConcept.glb` | CC BY 4.0, clean | Viable but 11.8 MB for one concept car that matches none of our four. Kept in reserve. |
| Khronos `VirtualCity` | *"3DRT license with allowances for glTF Testing"* | Testing only. Rejected. |
| Sketchfab CC0 filter | — | Returns **no cars at all** — museum scans, boats, a bicycle. |
| Sketchfab "CC0" realistic cars | Description says CC0, structured licence field says "Free Standard" (Sketchfab's own proprietary licence) | Rejected as unverifiable: the two statements contradict each other. |
| BMW M3 Touring G81 (`Car2022`) | Tagged CC BY | **Rejected — rip.** Description is a Forza car-list stat block (`Years: 2023 / Class: A / Weight: Medium`); tags `unity, unity3d`. This was the best fast-estate candidate. |
| Hyundai i20 (`ANDREO12`) | Tagged CC BY | **Rejected — rip.** Description links a ZModeler group; ZModeler is the GTA vehicle-rip toolchain. |
| 2000 Audi A4 (`tonielpro520`) | Tagged CC BY | **Rejected.** Description says "Free REUPLOAD". |
| BMW M8 F92, Audi A5 Sportback | Tagged CC BY | **Rejected.** Descriptions are copy-pasted manufacturer marketing copy; the A5 is 950 k faces, i.e. manufacturer CAD. |
| Mercedes-Benz AMG CLS, Audi A7 Quattro | Was CC BY | Both now 404 on Sketchfab — taken down. |
| Porsche 911 Carrera 4S (Lionsharp) | **CC BY-SA** | Rejected: share-alike. Note `Tresjs/tres` ships tempting pre-compacted `porsche-911.glb` files — triangle counts confirm these are the ShareAlike Carrera 4S, **not** the CC BY 930. Do not use them. |
| Mercedes E-Class W212 (`Peter_D`), BMW M3 E30 (`Bexxie`) | CC BY 4.0, provenance good | Genuinely usable. Not used here only because neither fits a super-saloon, fast estate or four-door coupé well. Real options if the roster changes. |
| `mmcworks`, `mk2design`, `anserkon` generic sedans/coupés/estates | CC BY, excellent provenance and fit | Not needed in the end — Objaverse made Zhabotinsky's catalogue reachable, which fits better. |
| Zhabotinsky models whose 2022 title names a real car — Mazda Cosmo AP, Smart ForTwo w451, Ford Mustang SVT Cobra R, DMC-12, VW Corrado VR6, Toyota AE86, Datsun 510 Bluebird, Jeep CJ6, Ford F700, ZAZ 968, Opel Speedster, Chaparral 2J, VW Golf | CC BY 4.0, provenance excellent | **Rejected on trademark, not licence.** He has since renamed these to invented marques, but the shape is still the shape. Only his generically-titled models are used. |
| Poly Pizza branded realistic cars | CC BY 3.0 via the Google Poly archive; chain is real | Rejected on trademarks: Nissan GTR, Ferrari F40 etc. are marque names *and* recognisable trade dress. |
| TurboSquid / CGTrader "free" | Royalty-free terms require the model be **non-extractable** — "proprietary formats that cannot be extracted, exported, or decompiled" | Rejected, and specifically incompatible with a browser game: serving a `.glb` over HTTP is the prohibited case. |
| Free3D, Pixabay 3D | Per-model "personal use"; Pixabay forbids standalone redistribution | Rejected. |
| Stunt Rally, VDrift, TORCS (GPL); Speed Dreams (Free Art Licence); SuperTuxKart (CC BY-SA) | Copyleft | Rejected: viral, would infect the repository. |
| Blender BMW27 (Mike Pan) | CC BY-SA | Rejected: copyleft, badged, and a render scene rather than a game asset. |
| Poly Haven, ambientCG | CC0 | No vehicles. |

**Gaps that remain.** None for the cars. Every vehicle in `CARS` is now on a
licensed model; only the articulated lorry is still procedural.

The estate was the last gap and the hardest. Daniel Zhabotinsky has exactly the
right one — *Shvan 92 Traveller* — but his catalogue is 133 models of which
only 47 are in the December 2022 Objaverse snapshot, and the Traveller is not
one of them; nor is *Urban '10 Cop Enforcer*. Both were uploaded later. His only
mirrored estates are 1980s American station wagons, whose wheelbase is short
enough relative to their length that scaling on the wheelbase overshoots a
modern estate by 15%, and whose styling would not sit next to a modern coupe.
Anserkon's *Generic USA/EU Station wagon* is mirrored, modern, and fits.
