# Vollgas

A browser racing game on the **Bundesautobahn 81, Stuttgart → Singen (Bodensee)**,
built with Three.js and no art assets — every mesh, texture and sign is generated
at load time.

It is a **time trial** against your own best. You join the A81 from the slip road
at Zuffenhausen and run to the Bodensee. The catch is that a third of the route
is posted, and the posted bits are watched: unmarked patrol cars run in the
traffic stream taking **ProViDa** video measurements, and mobile **Blitzer** vans
sit in the hard shoulder. Going fast where it is legal is free. Going fast where
it is not is how you take time out — and how you end up with a Bußgeldbescheid.

**▶ Play it: https://leonardoalt.github.io/vollgas/**

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static bundle in dist/
npm run deploy     # build and publish to the gh-pages branch
```

`vite.config.js` sets a production-only `base` of `/vollgas/`, because Pages
serves from a subpath while the dev server must stay on `/` or every local URL
and every harness in `dev/` breaks. `npm run deploy` pushes `dist/` as an orphan
history on `gh-pages`; rename the repo and that base path has to change with it.

## Controls

| | |
|---|---|
| `W` / `↑` | throttle |
| `S` / `↓` | brake |
| `A` `D` / `←` `→` | steer |
| `Space` | handbrake — a locked rear axle: ~0.5 g and 42 % less cornering grip |
| `C` | cycle camera (chase / close / cockpit / bonnet / cinematic) |
| `M` | mute · `P` pause · `R` restart |

The interface is available in **German or English** — the `DE`/`EN` button sits in
the menu header and the choice is remembered. It defaults to German if your
browser prefers German, English otherwise.

The road signs, gantries, licence plates and place names stay German in both.
A German Autobahn has German signage, and reading *Ausfahrt*, *Ende aller
Streckenverbote* and *Raststätte Neckarburg* off the verge is most of what makes
the route feel like the A81.

## The route

26 km compressed from the real A81, in the real running order, with the real
place names, speed regime and landmarks:

| km | Section | Limit | |
|---|---|---|---|
| 0.0 | Stuttgart-Zuffenhausen | 100 | you start on the Auffahrt; Porsche works alongside |
| 2.4 | Engelbergbasistunnel | 100 | bored tunnel, lit crown, dimmed inside |
| 5.1 | Sindelfingen-Ost | 120 | Mercedes plant |
| 6.6 | Böblingen-Hulb | **frei** | *Ende aller Streckenverbote* |
| 11.3 | Rottenburg · Neckartal | **frei** | blue *Richtgeschwindigkeit 130* board |
| 13.1 | Horb am Neckar | 120 | the curviest stretch |
| 14.6 | Empfingen | 80 | Baustelle: yellow markings, Leitbaken, plant |
| 17.7 | Raststätte Neckarburg | **frei** | services, filling station |
| 19.2 | Rottweil | **frei** | thyssenkrupp lift test tower |
| 21.1 | Villingen-Schwenningen | 120 | Baar plateau, wind farm |
| 24.3 | Engen · Hegau | 120 | volcanic cones |
| 25.4 | Singen (Bodensee) | 100 | finish |

Stage length is one constant: `STAGE_KM` in `src/track.js`. Everything —
sections, elevation profile, signage, landmarks, camera placement — scales with it.

## Enforcement

**Unmarked patrol cars (Zivilstreifen).** 5-series Tourings, E-Klassen, A6
quattros and 3-series in dull fleet grey, running with the traffic. The blue LEDs
sit behind the radiator grille and on the parcel shelf; the rear window holds a
dark LED matrix. You can spot one if you look.

They are **not slow** — the Autobahnpolizei runs fast cars with trained drivers,
and these top out at 273–290 km/h, only just below the cars you drive. Only the
911 can out-drag one, and even then gaining 340 m takes about 37 seconds flat
out. Your real advantage is acceleration: 0–200 in 7.8–11.1 s against their
12.7–16.6 s. Escapes are earned through traffic, braking and corners.

If you pass one well over the limit it drops in behind you and starts a ProViDa
measurement, which needs a **sustained follow** to be valid:

- brake back to near the limit → measurement aborted
- pull more than ~340 m clear → measurement void
- let the bar fill → Anzeige. Blue lights come out, the rear window lights up
  **STOP POLIZEI**, and if it holds within 30 m of you for 4.5 s you are pulled
  onto the hard shoulder for 20 s.

The ProViDa panel shows the live gap, and the **rear-view mirror** at the top of
the screen is how you actually see who is back there — its surround turns red
while you are being measured. A measurement is only valid inside 190 m, which is
also the radar range: whenever that bar is filling, the car doing it is on your
screen.

Let it complete and the pursuit starts. If they hold you, both of you pull onto
the hard shoulder, they stop behind you, and the run is over.

Nobody flashes you about an unmarked car — oncoming drivers cannot spot one
either. The Lichthupe only ever warns about cameras, and there is deliberately
**no message** when it happens: the headlights coming at you are the warning, and
spelling it out gives the game away.

**Mobile speed cameras.** Unmarked vans parked in the Seitenstreifen, clustered
where limits start and through the roadworks. No in-car warning — radar detectors
are illegal in Germany. The only warning you get is the real one: **Lichthupe**
from oncoming traffic on the far carriageway, once per hazard.

**Penalties** come in two tiers, because in Germany they genuinely do.

*Bußgeldkatalog* (administrative), outside built-up areas: €20 for 10 over up to
€700, **2 Punkte** and a 3-month Fahrverbot past 70 over. Note the ceiling — two
points is as bad as a speeding *Ordnungswidrigkeit* ever gets. 180 over is the
same entry as 71.

*§ 315d StGB* (criminal). Above roughly **twice the posted limit** it stops being
an administrative offence at all: since October 2017, § 315d Abs. 1 Nr. 3 covers
a driver alone travelling "mit nicht angepasster Geschwindigkeit und grob
verkehrswidrig und rücksichtslos … um eine höchstmögliche Geschwindigkeit zu
erreichen". That carries **3 Punkte**, a Geldstrafe in Tagessätze, revocation of
the licence under § 69 StGB — not a temporary ban — and confiscation of the car
under § 315f. In game it ends the run immediately, on its own card, and the
results sheet becomes a Strafverfahren rather than a Bußgeldbescheid.

So: 300 in a 120 is not two points. It is a criminal charge, your licence, and
your car. Eight points in Flensburg also ends a run.

## Cars

Four you drive, evocative rather than licensed — a rear-engined fastback, a
notchback super-saloon, a fast estate and a long-bonnet four-door coupé:

| | reference car | layout | V max | 0–100 |
|---|---|---|---|---|
| Zuffenhausen 9 Turbo S | 911 Turbo S (992) | AWD, 8-sp | 330 | 2.7 s |
| Bayern M-Sport M5 CS | M5 CS (F90) | AWD, 8-sp | 305 | 3.0 s |
| Ingolstadt RS-6 Avant | RS6 Avant (C8) | AWD, 8-sp | 305 | 3.6 s |
| Affalterbach AMG 63 S | C 63 S (W205) | **RWD, 7-sp** | 290 | 3.9 s |

Every figure is the real car's: power, kerb weight, top speed, gearbox, driven
axles, rev limit. Three of the four genuinely are 8-speed automatics with
all-wheel drive — that is real convergence among 300 km/h German saloons, not a
shortcut. The AMG is the outlier and drives like it.

In-engine measurements land within a tenth of the published 0–100 figures. That
needs a per-car `launch` factor in the drivetrain (the fraction of available grip
that reaches the road off the line), because a 2.1 t estate does not get away
like a rear-engined 911 on identical nominal grip.

Bodies are **lofted hulls**: a list of stations along the length, each giving a
lower-body half-width and beltline plus an optional narrower cabin tier, and each
tagging whether its top surface and flanks are sheet metal or glass. That one
generator produces a saloon, a long-roof estate and a rear-engined fastback that
are distinguishable from the driver's seat of the car behind. Wheel arches are cut
by lifting the section floor in a circular arc over each axle — the single biggest
cue that a shape is a car and not a brick.

## Driving model

Longitudinally a power-limited point mass: `min(P/v, μ·m·g·driveShare)` for
traction, real aerodynamic drag with the constant *derived from the quoted top
speed* so each car actually tops out where it should, rolling resistance, and
gradient from the road profile. Gears have a 5 % hysteresis band and a shift
torque cut.

Laterally a bicycle model in track coordinates, with the steer angle clamped by a
**friction circle** — so braking genuinely costs you cornering grip, and the 2.1 t
estate runs wide where the 911 does not. Minimum corner radius on the route is
815 m, which is 0.87 g at 300 km/h.

## Layout

```
src/
  track.js       the A81 alignment: curvature → heading → position, sections,
                 speed regime, (s,u) ↔ world projection. One tunable: STAGE_KM.
  textures.js    every canvas texture: StVO signs, German plates, LED matrix,
                 asphalt, ground, foliage, sky
  carFactory.js  lofted car bodies, archetype station tables, wheels, faces,
                 police kit, Sattelzug
  world.js       carriageways with crossfall, StVO markings, Stahlschutzplanken,
                 signage and gantries, Engelbergtunnel, bridges, Baustelle,
                 services, slip roads, sky/light/fog
  scenery.js     terrain ribbon on smoothed phantom centrelines, biome
                 patchwork, vegetation, landmarks
  vehicles.js    driving model, traffic AI with Rechtsfahrgebot, rival racers
  police.js      Zivilstreifen, ProViDa, mobile Blitzer, Lichthupe, BKat fines
  hud.js         canvas cluster, rear-space radar, alerts
  i18n.js        UI strings in German and English (world signage stays German)
  game.js        states, cameras, event pump, results
dev/             headless harnesses (see below)
```

### Cars on the menu

The pictures in the menu are **live renders of the same models you drive**, not
photographs — a turntable of the selected car plus stills for the list, drawn on
a small second WebGL context (`showroom.js`) and parked while you are driving.
That avoids the licensing question entirely: the geometry is ours and none of
the cars carries a real marque's badge.

### Endings

Traffic clears the hard shoulder while you are being pulled over. Anything in
the space you are about to occupy pulls left and slows, and anything actually
in the way is recycled far ahead — being dragged bodily through a Kombi looks
much worse than a car quietly no longer being there.


All three ways a run can end share one flow: let the situation come to rest,
hold on a full-screen card so you can see *why*, then show the numbers.

| | card | what happens |
|---|---|---|
| ProViDa stop | ERWISCHT / BUSTED | you and the patrol car both pull onto the shoulder |
| Eight points | FÜHRERSCHEIN WEG / LICENCE GONE | a patrol car closes in and stops you |
| 100 % damage | SCHROTT / WRECKED | you coast to a halt; no police involved |
| Hitting a camera van | GERAMMT / RAMMED | the vans are solid: €1000, 3 points, run over |
| Twice the limit, caught | STRAFTAT / CRIMINAL OFFENCE | § 315d StGB: licence revoked, car seized |

### Time trial

Best time is stored per car in `localStorage` and shown live in the HUD, so the
stage is run against your own previous lap rather than an AI field.

### Alerts

Alerts run down a column on the left, never across the middle — a burst of fines
stacked centre-screen buries the car exactly when you most need to see it. Each
alert also carries a category key: a second alert with a key already on screen
replaces that row in place, so three speed cameras in a row are one row that
updates rather than three that stack. Running totals live in the panel
top-right, which is where you look for them anyway.

### Rear-view mirror

Rendered to a 640×176 target with a narrow field of view, so most of the world
frustum-culls away, then drawn as a horizontally mirrored quad in a screen-space
overlay pass — mirrored via the quad rather than the camera, so no projection or
winding tricks are needed. Costs about 190 extra draw calls.

### Rendering notes

The terrain is one ribbon following the road, but a ribbon laid along the true
centreline folds over itself as soon as its half-width exceeds the radius of
curvature. Each lateral ring is therefore laid out along a **progressively
smoothed phantom centreline** — near rings hug every bend, the 3.2 km ring runs
almost straight. The mesh stays connected, nothing folds, and you get a horizon.

Which phantom centreline a ring follows has to be a *continuous* function of its
lateral distance. Snapping rings to discrete levels steps the ribbon sideways and
vertically wherever the level changes, which reads as cliff faces in the distance
and as a ridge in the grass right beside the road that the chase camera clips
through.

Road furniture is generated in 512 m chunks merged down to ~6 meshes each, so the
frustum throws away almost all of it. Delineators, tunnel lights and 10 k trees
are instanced.

## Headless harnesses

Driven with `puppeteer-core` against system Chromium; used throughout to catch
things that are invisible in code.

```bash
node dev/phys.mjs                                  # 0-100/0-200/0-300 and V max per car
node dev/shot.mjs  <url> out.png                   # single screenshot
node dev/drive.mjs <url> <outdir> <secs> [lawful]  # autopilot a race, log state + events
node dev/race-shot.mjs <url> out.png <km> <cam>    # in-race shot at a given km
node dev/cop-shot.mjs <url> out.png measure|pursue # ProViDa / pursuit
node dev/finish.mjs  <url> out.png [de|en]         # finish line + penalty notice
node dev/audio-check.mjs <url>                     # engine really goes silent on pause/results
node dev/lang-check.mjs  <url> <outdir>            # both languages, flags untranslated nodes
node dev/alert-check.mjs <url> out.png [de|en]     # alert burst: coalescing + placement
node dev/arrest-check.mjs <url> out.png            # tunnel warnings, escape balance, pull-over
node dev/flash-check.mjs  <url> out.png            # Lichthupe: visible, persists, then stops
node dev/busted-check.mjs <url> <outdir> [de|en]   # all three endings show their card
node dev/best-check.mjs   out.png                  # best-time persistence
node dev/start-check.mjs  out.png                  # you start on the slip road
```

`dev/cars.html?cars=turbo,m5&mode=side|front|rear|front34|rear34|top` is a car
bench; `dev/world.html?km=12&view=drive|cockpit|air|sign` is a world bench.

## Known limits

- Two lanes per direction throughout; the real A81 widens to three near Stuttgart.
- Rival racers exist in `vehicles.js` but are switched off (`RIVALS` in
  `game.js`); the stage is currently a time trial.
- The Engelbergtunnel is modelled as a single bore over your carriageway, and
  there is no hillside over it — you drive into a portal standing in open ground.
- Slip roads are visual — you cannot actually leave the Autobahn.
- Marque names and model designations are fictional stand-ins, and every badge is
  stripped from the models and menu images. Car *shapes* remain recognisable —
  that is deliberate. All third-party models are CC-BY and attributed in
  `CREDITS.md` and in the menu.
