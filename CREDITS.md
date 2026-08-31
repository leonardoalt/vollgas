# Credits

Vollgas began with no art assets at all — every mesh, texture and sign was
generated at load time. That is still true of the world, the signage and most
of the traffic. It is no longer true of the cars, and this file records exactly
what came from where.

The in-game attribution required by CC BY is rendered in the car-select panel
(`src/credits.js`), not only here.

## 3D models

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

### Generic passenger car pack — used for traffic (`taxi`, `kombi`, `hatch`, `van`)

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
`asset.extras` attribution, so where such an export has been mirrored in a
public GitHub repository the CC BY grant travels with it and remains valid
regardless of the host repository's own licence. That is how both models above
were obtained.

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
| `mmcworks`, `mk2design`, `anserkon` generic sedans/coupés/estates | CC BY, excellent provenance and fit | **Unusable: no public mirror exists**, and Sketchfab needs OAuth to download. The best-fit authors found. |
| Poly Pizza branded realistic cars | CC BY 3.0 via the Google Poly archive; chain is real | Rejected on trademarks: Nissan GTR, Ferrari F40 etc. are marque names *and* recognisable trade dress. |
| TurboSquid / CGTrader "free" | Royalty-free terms require the model be **non-extractable** — "proprietary formats that cannot be extracted, exported, or decompiled" | Rejected, and specifically incompatible with a browser game: serving a `.glb` over HTTP is the prohibited case. |
| Free3D, Pixabay 3D | Per-model "personal use"; Pixabay forbids standalone redistribution | Rejected. |
| Stunt Rally, VDrift, TORCS (GPL); Speed Dreams (Free Art Licence); SuperTuxKart (CC BY-SA) | Copyleft | Rejected: viral, would infect the repository. |
| Blender BMW27 (Mike Pan) | CC BY-SA | Rejected: copyleft, badged, and a render scene rather than a game asset. |
| Poly Haven, ambientCG | CC0 | No vehicles. |

**Gaps that remain.** There is no credibly-licensed, well-authored, high-detail
**fast estate** or **four-door coupé** available. Every candidate for those two
body styles failed the provenance check. `m5`, `rs6` and `amg` therefore still
use the procedural bodies, and will until a legitimate model appears.
