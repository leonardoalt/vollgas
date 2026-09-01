# HANDOFF — driving feel (lateral model)

Branch: `worktree-agent-adc552dbc4b50430f`. Worktree:
`/home/leo/devel/autobahn/.claude/worktrees/agent-adc552dbc4b50430f`.

## Goal

Owner's complaint, verbatim:

> "When we move left and right, it moves in a very 'square' arcade-y way. The
> way the car moves when we accelerate (backend goes down), break/lift (backend
> goes up), and one side goes down when left/right is already great, but there's
> something robotic about the car just sliding around."

So the visual weight transfer is liked and must be preserved; the *lateral
motion* is the problem. Balance figures (0–100, top speed, braking, police
escape margins) must not drift.

## Continuation after merging `main` (2026-09-01)

- Synced local `main` to `origin/main` at `c832622` and merged it as `2f69799`.
  The handling implementation merged automatically with the newer real-car
  bodies; this handling-specific handoff won the only add/add conflict.
- Found the reported "drifts left/right instead of turning" regression at the
  rendering boundary. Physics uses positive `psi` for a right turn, while
  THREE's positive `rotation.y` turns local +Z left. `sync()` added those two
  angles, so the car moved right with its nose visibly pointing left. It now
  converts conventions with `head - psi * dir`; the same correction also keeps
  oncoming cars consistent.
- Extended `dev/feel.mjs` to compare the rendered nose with the actual velocity
  vector. All four player cars now pass at 0.98–1.25 degrees of ordinary tyre
  sideslip (limit 6 degrees). The step-response and straight-line figures did
  not change.
- The harness fixes described below (pinned open-loop tests and a sub-limit
  step steer) are now applied. The remaining feel-harness failures concern the
  unfinished balance/lane-controller tuning, not the corrected visual yaw.
- Follow-up play testing found four control issues and they are now covered by
  feel-harness cases 8–11. Handbrake yaw is capped at a catchable 27.5 deg/s
  instead of reaching the model's 149 deg/s guard; steering crosses from full
  left to full right in 0.25 s at the rack (was 0.34 s), reaches half-lock in
  0.23 s, and produces visible yaw in 0.14 s; a police stop from 223 km/h brakes
  in-lane before merging, peaks at 14.8 deg/s yaw, and parks in 13.6 s without
  a scrape; and 80 % braking retains a stable 27–36 deg/s turn response instead
  of exhausting the front axle. `physics2-check` and all three `busted-check`
  endings pass with no page errors.

## Diagnosis — what is actually wrong in the old code

All line references are to `src/vehicles.js` **before** my changes (commit
`a14d2ed`).

1. **No yaw inertia at all.** `stepLat()` computed
   `yawRate = (v / wheelbase) * tan(delta)` and used it immediately. The car's
   rotation was an algebraic function of the steering angle, so it changed
   direction in the same frame the input did. There is no rotational mass
   anywhere in the old model. *This is the main cause of "robotic".*

2. **The steer angle was hard-clamped to the friction circle:**
   ```js
   const maxDelta = Math.atan(latMax * this.wheelbase / (v * v));
   delta = Math.max(-maxDelta, Math.min(maxDelta, delta));
   ```
   Above ~100 km/h this clamp binds for any meaningful input, so **full lock
   always produced exactly maximum cornering, instantly, at every speed**. That
   is the single biggest reason the car reads as "translated sideways by a
   script" — the mapping from key to lateral acceleration was a step function
   pinned to the grip limit.

3. **`psi` was force-decayed every frame:**
   `this.psi *= 1 - Math.min(0.9, dt * 2.4)` (τ = 0.42 s). This teleports the
   heading back towards parallel-with-the-road regardless of what the tyres are
   doing. Because `u` advanced as `v·sin(psi)`, decaying psi also killed the
   sideways *motion* — hence "the car just sliding around" and then snapping
   straight.

4. **`psi` hard-clamped to ±0.7 rad.**

5. **No front/rear distinction.** One lateral grip number for the whole car, so
   no understeer/oversteer balance. `awd`/`launch` only affected straight-line
   traction.

6. **Roll and pitch in `sync()` were instantaneous** functions of `aLat`/`aLong`
   — the body attitude changed in the same frame as the input.

7. **`input.js`** used an exponential approach to the steer target, which moves
   fastest at the instant of key-down and then creeps. A hand does the opposite:
   roughly constant rate.

### The load-bearing insight (read this before changing anything)

The `psi` decay in (3) is *also* what makes every AI and harness lane
controller stable. They are all bare proportional gains on lateral error, e.g.
`steer = (LANES[0] - p.u) * 0.25 - p.psi * 2` in `dev/arrest-check.mjs`, and
`err * 0.30 - p.psi * 2.2` in `dev/drive.mjs`. Without the psi decay that is an
undamped second-order loop (I computed ζ ≈ 0.19 at 58 m/s; with the decay it is
ζ ≈ 0.62). **The "robotic feel" and the "harnesses pass" are the same hack.**

Consequence: you cannot remove the psi decay without giving the automated
drivers a properly damped controller. That is what `laneAssist()` in
`src/steering.js` is for.

## Approach chosen, and what I rejected

**Chosen: two lateral models.** The player runs a new *dynamic* single-track
model with real yaw inertia; traffic and patrol cars keep the original
*kinematic* model verbatim.

Rejected alternatives:

- *Dynamic model for everything.* Would require re-tuning the lane controllers
  in `src/police.js` (which I do not own) and all ~26 traffic cars per frame,
  and risks the `arrest-check` / `busted-check` pull-over sequences. The
  complaint is about the player's car; traffic is only ever seen from outside at
  distance. Kept as a deliberate, documented choice.
- *Weakening the psi decay instead of removing it.* I costed this: even at
  0.5/s the harness loops sit at ζ ≈ 0.28, so it does not save the harnesses,
  and the unphysical heading teleport (the actual complaint) is still there.
- *Keeping the friction-circle clamp on `delta`.* That clamp is item (2), the
  main "arcade" cue. Removed; the tyres decide now.

## What is implemented and working

### New files (all mine, zero merge risk)

- **`src/tyres.js`** — chassis derivation + lateral tyre model.
  - `TUNE` table keyed by car id, for the 4 player cars only: `wdF` (front
    weight fraction), `hCog`, `di` (dynamic index, so `Iz = di·m·a·b`),
    `rearDrive`, `csF`/`csR` (normalised cornering stiffness, `Cα = cs·Fz`),
    `rollF` (front share of the roll couple).
    **Note: this is why I did NOT need to edit `src/carFactory.js` at all.**
    Weight distributions are the real cars' (911 39/61, C63 53/47, RS6 56/44,
    M5 52/48).
  - `curve(x) = sin(1.45·atan(2.6·x))` — Pacejka-shaped, peak at x = 0.71,
    settles to 0.76 of peak. `x = cs·α/μ`, so the shape is load-independent and
    only the peak scales, which is what makes combined slip fall out of one
    scalar `mu`.
  - `axleFy`, `muLeft` (per-axle friction circle), `loadMul` (lateral load
    sensitivity, `LOAD_SENS = 0.13`, ≈4 % of grip at the limit).
  - `steerLock(ch, v)` — replaces the old `0.52/(1+0.055v)` taper *and* the
    removed hard clamp. Lock = `dOver·(L·ayMax/v² + kus·ayMax) + dCatch`, i.e.
    scaled to the lock the car actually needs, so full lock over-drives the
    front by roughly 2:1 (greed → understeer) while always leaving authority to
    catch the back end. Understeering cars automatically get more lock.
  - `HAND_LAT_CUT = 0.07` — handbrake lateral cut, **rear axle only** (see
    Gotchas).
- **`src/steering.js`** — `Rack` (second-order, hand rate limit 4.0 full-lock/s,
  self-aligning-torque feedback with pneumatic trail collapse so the steering
  goes light as the front saturates) and `laneAssist()` (damped lane keeping,
  designed in acceleration space + curvature feed-forward, so one gain set works
  at 30 and at 300 km/h).
- **`src/suspension.js`** — `Spring` (damped harmonic oscillator, sub-stepped so
  `w·h < 0.4`; stable at the 0.05 s dt clamp) and the `BODY` frequencies
  (roll 1.30 Hz/ζ0.44, pitch 1.55 Hz/ζ0.52, heave 1.20 Hz/ζ0.38).
- **`dev/feel.mjs`** — the feel harness. 11 sub-tests with numeric verdicts:
  step steer, keyboard lane change, skidpad, tightest-corner-flat-out, balance
  (throttle/brake shift), timestep robustness (1/120…1/20), stability (yaw kick).
  Drives the real `Player` through the real `input.js` with real key presses.

### `src/vehicles.js`

- `stepLat()` is now a dispatcher: `_latDynamic` (player) or `_latKinematic`
  (the old code, verbatim), then the shared `_surface()`.
- `_latDynamic()`: per-axle vertical load from longitudinal transfer, per-axle
  friction circle + load sensitivity, slip angles
  `αf = atan((vy + a·r)/v) − δ`, `αr = atan((vy − b·r)/v)`, saturating tyre
  curve, integrate `vy` from total side force and `r` from the yaw **moment**.
  Sub-stepped (`ceil(dt/0.006)`, capped at 14). Nothing forces `psi`.
  Adds cornering drag (`|Fy·sin α|`), exactly zero in a straight line so it
  cannot touch `phys.mjs`. `psi` clamp widened to ±1.05 for the dynamic path
  only; kinematic keeps ±0.7.
- `stepLong()`: **arithmetically unchanged** (verified byte-identical
  `phys.mjs`). Only addition is booking the same newtons to axles as
  `this.fxF` / `this.fxR`, using `BRAKE_FRONT = 0.70`; road-car ABS charges
  35 % of braking force to lateral capacity and ESC damps excess braking yaw.
- `sync()`: roll/pitch now sprung (same steady-state gain as before, so the
  look is preserved), plus small player-only heave over crests (±0.038 m).
- Barrier scrape now also damps `r` and `vy`, not just `psi`.
- Player pull-over brakes in-lane first, then uses a lower-acceleration
  `laneAssist()` shoulder manoeuvre with automated-stop-only stability damping.
- Re-exports `laneAssist` for harness use.

### `src/input.js`

Steering is now a true rate limit (linear ramp): `WIND_ON = 4.2`,
`WIND_OFF = 7.0` full-lock/s, where "releasing" includes reversing through
centre. Throttle/brake shaping untouched.

### `dev/drive.mjs`

Repaired one pre-existing break: it called `g.standings()`, which no longer
exists anywhere in `src/` (rivals were switched off). The harness crashed on
`main` before I touched anything. I dropped the `place:` field from the log.

## Before/after `dev/phys.mjs` — ZERO DRIFT

`diff` of the two full outputs is **empty**. Both runs (before my changes and
after the dynamic model landed):

```
CARS YOU DRIVE            quoted  top  t100   t200   brake100_0
Zuffenhausen 9 Turbo S    330     323  2.73   7.76   2.17
Bayern M-Sport M5 CS      305     298  3.10   9.22   2.29
Ingolstadt RS-6 Avant     305     296  3.53  10.91   2.23
Affalterbach AMG 63 S     290     282  3.87  11.67   2.36

UNMARKED PATROL CARS      quoted  top  t100   t200   brake100_0
Zivilstreife 5er Touring  285     273  3.92  16.59   2.44
Zivilstreife E-Klasse     295     284  3.71  14.53   2.47
Zivilstreife 3er          300     290  3.33  12.68   2.33
Zivilstreife A6 Avant     290     278  3.74  15.41   2.40

fastest patrol car: 290 km/h
  turbo margin +33 -> 340 m clear in 37 s;  m5 +8 -> 153 s;
  rs6 +6 -> 204 s;  amg -8 -> cannot out-drag them
```

This is expected and is the point of the design: `stepLong()` was not altered.

Baselines captured before my changes (all passing, files in `/tmp/base`):
- `arrest-check`: tunnel 0 warns; flat-out caught; lifting saves you; bar never
  fills off-radar; final park gap 8 m, both at u = 11.3.
- `physics2-check`: handbrake 200→5 in 9.98 s @0.63 g peak; footbrake 4.18 s
  @1.40 g; pull-over `worstInTheWay` 0, damage 0, u 11.3; van ram → GERAMMT.
- `busted-check`: all three cards, park gaps 7.2 / 7.3 m, visible in mirror.
- `drive.mjs 200 fast`: ends at km 3.43, t≈87 s, §315d STRAFTAT, damage 0.

## Where I left off — NEXT STEPS IN PRIORITY ORDER

1. **Re-run `dev/feel.mjs`.** The first run was mostly *invalid*: with the
   friction-circle clamp gone, full lock at 200 km/h drives the car off the road
   in under a second, so nearly every sub-test was measuring a barrier collision
   (giveaways: `exit_kmh` 106–155 from 300, `ss_delta_deg` 20°+ when
   `dMax` ≈ 7°, `psi_after_5s = 0` exactly).
   **The harness still needs the fix**: pin `p.u` to a constant at the *top* of
   `stepWith()` (before `p.control`), which makes it an infinitely wide test
   track. `u` is a pure output of the lateral state — it feeds back only through
   `offroad`/barrier — so pinning it is legitimate and leaves `vy`, `r`, `psi`,
   `v` untouched. Pin before, not after, so the barrier clamp never runs.
2. **`stepSteer` should use a sub-limit amplitude** (e.g. `steer = 0.25` held)
   for the classic rise/overshoot/settling numbers, and keep the keyboard tap as
   the lane-change test. Full lock always saturates the front, so it measures
   tyre saturation rather than yaw response.
3. **Then tune, against numbers.** Targets I set: yaw rise 10–90 % between 0.10
   and 0.75 s; yaw overshoot 0.5–45 %; release decay to 10 % > 0.12 s; peak
   lateral > 0.95 g at 300 (tightest corner needs 0.87 g); tightest corner flat
   out with 0 scrape frames; AMG `throttle_shift` > RS6 `throttle_shift` and
   > 0; all cars `brake_shift` < 0; lane-change spread across dt 1/120…1/20
   < 0.60 m; heading error must survive the stability test (`psi_retained`).
4. **Re-run every existing harness** and compare against `/tmp/base`. Expect to
   have to re-tune the inline autopilot steer expressions — see Gotchas. They
   are at `arrest-check.mjs:57,98,142`, `cop-shot.mjs:29`, `finish.mjs:40`,
   `drive.mjs:61`, `race-shot.mjs:53`.
5. **Camera** (`src/game.js`, minimal additive, NOT DONE YET): planned chase
   yaw-follow (offset the camera position around the car by a fraction of
   `psi`), a small lateral lead on the look point, and use the sprung `p.roll`
   instead of `p.aLat` for `camera.rotateZ` so the camera lags the body. Also
   planned: replace the countdown steer at `game.js:593` with `laneAssist`.
   **`src/game.js` is currently UNTOUCHED.**
6. Update `README.md`'s "Driving model" section.

## Gotchas discovered the hard way

- **The psi-decay / harness-damping coupling.** See "load-bearing insight"
  above. If a harness starts weaving or hitting barriers, the fix is the
  controller, not the car: the psi feedback gain needs to be ~3.6× higher
  relative to the position gain, or just use `laneAssist`. Adding a yaw-*rate*
  term makes it worse, not better — it is a gain reduction on the whole
  controller, so it lowers ω and ζ together.
- **Harnesses that inject `steer: 0`** (`best-check`, `penalty-check`,
  `busted-check`, `physics2-check:90`) rely on the car tracking straight. With
  no psi decay the car drifts with road curvature. `physics2-check` part 3 aims
  at a van 140 m away with `steer: 0`, so it is the most fragile — check it.
- `dev/phys.mjs` and `dev/physics2-check.mjs` build a **stub** via
  `Object.create(Vehicle.prototype)` with no `this.ch` and no `this.hand`. Any
  new `stepLong()` code must tolerate both being `undefined`. Mine does
  (`this.ch ? ... : fallback`).
- `node_modules` in the worktree is a **symlink**, and `.gitignore` has
  `node_modules/` with a trailing slash, which does not match a symlink. Do not
  `git add -A` blindly — add paths explicitly.
- `sample()`'s `grade` is only piecewise smooth, so differentiating it for the
  heave term spikes. It is clamped and low-passed in `sync()`.
- Sign conventions: positive `steer`/`delta`/`psi`/`r`/`vy`/`aLat` are all
  "to the car's right"; `u` increases to the right for `dir = +1`.
  `u += (v·sin ψ + vy·cos ψ)·dir·h`.

## Build and verify

```bash
ln -s /home/leo/devel/autobahn/node_modules node_modules   # do NOT npm install
npx vite --port 5203 --strictPort &                        # dev server
npm run build                                              # must pass

node dev/phys.mjs          "http://localhost:5203/"        # must not drift
node dev/feel.mjs          "http://localhost:5203/"        # the new feel harness
node dev/arrest-check.mjs  "http://localhost:5203/" /tmp/a.png
node dev/physics2-check.mjs "http://localhost:5203/" /tmp/p.png
node dev/busted-check.mjs  "http://localhost:5203/" /tmp/out de
node dev/drive.mjs         "http://localhost:5203/" /tmp/out 200 fast
```

## Risk register / do-not-merge-blind

- `dev/feel.mjs` numbers are **not yet validated**; the first run was invalid.
  Do not trust any feel claim until step 1 above is done.
- The handbrake's full longitudinal retardation is preserved, but only 45 % of
  that force is charged to the simplified rear friction circle and its extra
  lateral cut is 7 %. A soft yaw/sideslip guard keeps sustained keyboard input
  at a catchable drift instead of allowing a full spin; feel test 8 exercises
  30 % steering demand on all four cars.
- Removing the `delta` friction-circle clamp means full lock at speed now
  over-drives the front. `steerLock()` is tuned to make that ratio ~2:1, but
  that ratio is the main driveability knob and is unvalidated.
