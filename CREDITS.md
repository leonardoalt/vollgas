# Credits

## Third-party art assets: none

Vollgas ships **no external art assets**. Every mesh, texture, sign, plate and
environment map in the game is generated procedurally at load time from code in
`src/`. There is nothing to attribute because nothing was imported.

This was re-verified deliberately in August 2026, when the question was asked
whether open-source badge-free replicas of a 911 / M5 / RS6 / C63 could be
dropped in instead of the procedural bodies. The answer was no. The findings are
recorded here so nobody has to redo the search.

## Why no third-party car models (research record, 2026-08)

The requirement was: permissive **and verifiable** licence (CC0 / CC-BY / MIT),
trademark-free, four cars under 8 MB total, downloadable without a login wall.

| Source | Licence, as actually stated | Verdict |
|---|---|---|
| [Kenney Car Kit](https://kenney.nl/assets/car-kit) | CC0, stated on [kenney.nl/support](https://kenney.nl/support), `License.txt` in the zip | **Licence is clean.** 4 cars ≈ 690 kB raw / ~115 kB gzip, one shared 12 kB atlas, direct download. Rejected on *looks*: it is deliberately stylised toy geometry and is a visual downgrade from the current procedural bodies. |
| [OGA "Ultimate 3D Car Assets Pack"](https://opengameart.org/content/ultimate-3d-car-assets-pack-w-interiors-and-animations) (Lyricsz) | OGA licence field: CC0 | Clean, 20 cars incl. glTF in 1.68 MB. Same problem: stylised. |
| [Quaternius cars](https://quaternius.com/packs/cars.html) | Author's site says CC0; Poly Pizza labels the same model CC-BY 3.0 | Clean either way, ~430 tris per car. Far too simple. |
| three.js `examples/models/gltf/ferrari.glb` | **No licence.** three.js's [MIT LICENSE](https://raw.githubusercontent.com/mrdoob/three.js/dev/LICENSE) covers the software, not example media — see [three.js#23089](https://github.com/mrdoob/three.js/issues/23089) | **Rejected.** The credited source (Sketchfab model `57bf6cc5…` by vicent091036) is now *disabled* and its API entry 404s — i.e. taken down. Unverifiable licence, bad provenance, and a badged Ferrari. |
| [Poly Haven](https://polyhaven.com/license) | Genuinely CC0 | No vehicles at all — [/models/vehicles-transport](https://polyhaven.com/models/vehicles-transport) returns zero results. |
| [Khronos glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) | `CarConcept.glb` CC-BY 4.0; `ToyCar.glb` CC0 | Rejected on size: 11.8 MB and 5.4 MB respectively, for one car. |
| Sketchfab CC0 filter | — | `license=cc0&downloadable=true&categories=cars-vehicles` returns 11 models and **not one is a car** (boats, wagons, a bicycle). `GET /v3/models/{uid}/download` unauthenticated returns HTTP 401: hard login wall. |
| Sketchfab "CC0" realistic cars | Description says CC0, structured licence field says "Free Standard" (Sketchfab's own proprietary licence) | **Rejected as unverifiable** — the two statements contradict each other. Also 480 k faces. |
| Sketchfab CC-BY realistic cars | Tagged CC Attribution by uploaders | **Rejected on provenance.** The same search returns a *Cyberpunk 2077 Quadra V-Tech* tagged CC-BY: a straight rip from CD Projekt. A CC tag on Sketchfab says nothing about whether the uploader had the right to grant it. |
| [Daniel Zhabotinsky](https://sketchfab.com/DanielZhabotinsky) | API licence field: `CC Attribution` / CC BY 4.0, plus an explicit grant in each description | **The one genuinely viable realistic option.** ~20 low-poly cars, 15–28 k faces, and crucially **fictional marques** (Phoenix 455, Tiara GT, LCT 3000 …) so trademark-clean by design rather than by de-badging. Rejected here only because each needs a manual authenticated download and texture downscaling, which this change could not do unattended — worth revisiting. |
| Poly Pizza branded realistic cars | CC-BY 3.0 via the Google Poly archive; licence chain is real | **Rejected on trademarks.** Nissan GTR, Ferrari F40, Camaro ZL1 are marque names *and* recognisable body shapes; trade dress does not care what you rename the file. |
| TurboSquid / CGTrader | Royalty-free licences require the model be **non-extractable** — "proprietary formats that cannot be extracted, exported, or decompiled" ([TurboSquid](https://blog.turbosquid.com/royalty-free-license/)), "the 3rd party cannot retrieve it on its own" ([CGTrader](https://help.cgtrader.com/hc/en-us/articles/360015124437-Royalty-Free-License)) | **Rejected, and specifically incompatible with a browser game**: serving a `.glb` over HTTP is exactly the prohibited case. |
| Free3D, Pixabay 3D | Per-model "personal use" / [Pixabay licence](https://pixabay.com/service/license-summary/) forbids standalone distribution | Rejected. |
| Stunt Rally, VDrift, TORCS | GPL v2/v3 | Rejected: viral, not permissive. |
| Speed Dreams | GPLv2+ code, **Free Art License** for the car data | Rejected: share-alike copyleft. |
| SuperTuxKart | [Mixed GPL / CC-BY / CC-BY-SA](https://supertuxkart.net/Licensing), CC-BY-SA preferred | Rejected: viral, mixed-licence tree, and the karts are cartoon animals. |
| Blender BMW27 (Mike Pan) | [BlendSwap](https://blendswap.com/3d/bmw): CC-BY-SA | Rejected: copyleft, badged BMW, and a render scene rather than a game asset. |

**Conclusion.** There is a clean CC0 set (Kenney, OGA, Quaternius) but it is
stylised low-poly that would look worse than what the game already has, and the
realistic options are all either illegally re-uploaded, licence-ambiguous,
copyleft, trademark-encumbered, forbidden in open web formats, or far too heavy.
So the cars stayed procedural and the effort went into lighting, materials and
geometry instead.

The one option worth reopening if photoreal bodies ever become the goal is
Daniel Zhabotinsky's CC-BY fictional-marque cars — genuinely permissive,
genuinely trademark-free, and the right polygon count. That would need
`CREDITS.md` to carry "Car models by Daniel Zhabotinsky, CC BY 4.0" and a link
to <https://sketchfab.com/DanielZhabotinsky>.

## Fonts

The UI loads **Barlow Condensed** and **JetBrains Mono** from Google Fonts
(`index.html`). Both are licensed under the SIL Open Font License 1.1. This is
the only external network request the game makes.

## Software

Three.js (MIT), Vite (MIT). See `node_modules/*/LICENSE`.
