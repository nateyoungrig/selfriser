# Selfriser

A field tool for lifting self-rising outdoor roofs. A laser on every tower reports its height over the
radio, and the app shows the whole roof live: each tower's height, how far it sits off average, the worst
neighbouring pair, a contour plot of the roof in 3D over the stage's own plan drawing, and an alarm when two
neighbours reach the stop tolerance. The hoists run from their own controls; the app only ever watches.

A simulator and a tabletop bench model live behind it in the **Lab**, kept out of the way of the field.

## The field screen (what opens)

- **Stage picker** (top left): the stage design on screen, and every other design on the device.
- **Lasers pill** (top right): `● 11/12` = 11 of the stage's 12 towers reporting right now. Tap it for the
  Tower lasers page: connect the hub (USB or Wi-Fi), each tower's signal and raw reading, ZERO, the stop alarm.
- **Tower cards**, laid out like the plan (on a phone, the plan turned on its side). Each says where its height
  comes from: **LIVE** (laser, with signal % when it's weak), **TAPE** (typed in), a time like `12s ago` (last
  laser reading), or **NO DATA**. A controller fault spells itself out (NO LASER, AT LIMIT).
- No laser on a tower, or no hub yet: tap the card and type the tape (`23'4 1/2`, `23 4.5`, `280.5"` all work).
  A live laser always wins over a tape.
- **Menu** (☰): Tower lasers, Level & bump list (who to bump which way, every neighbouring pair), Lift log
  (record a lift's laser heights; export as JSON), Stage designs, and the Lab.

## Stage designs

Stage designs are data on the device, not code. A made-up 12-tower demo roof and the tabletop scale model
ship as examples; they can be edited or removed like any other, and **RESTORE EXAMPLES** brings back removed
ones. Real roofs measured off drawings you can't publish can live in `src/model/examples/private/`
(gitignored): an `index.ts` there exporting `rigs: Rig[]` is seeded in place of the demo roof.

**Import a stage drawing (PDF)** from the stage picker or Stage designs. The importer doesn't try to read the
drawing's text (Vectorworks sheets often have it outlined); it shows the sheet and you point:

1. **Drawing**: pick the sheet with the plan view, rotate it so upstage is at the top.
2. **Scale**: tap both ends of a dimension you can read (the overall width is best) and type it. Two more taps
   measure anything, to check.
3. **Towers**: tap each tower center. Taps snap to rows and columns already placed; drag to move; SQUARE UP
   lines up near-misses; RENUMBER numbers them the crew way (downstage row first, stage right to left). Each
   tower's **Laser #** is the number set on its controller, which is how a laser finds its tower.
4. **Roof**: tap two corners of the outline. Truss runs go through every row and column automatically, or tap
   them in yourself.
5. **Details**: name, lifter type, tower height, max trim, watch / stop tolerances, display precision.

On save the plan is cut from the sheet and drawn under the roof in 3D. The PDF stays on the device (IndexedDB)
so the design can be edited later. **EXPORT** shares a design as a `.selfriser.json` file (with its plan picture,
never the PDF) that another phone opens with **OPEN A DESIGN FILE**.

A design without a drawing (**NEW, NO DRAWING**) uses the same board over a feet grid; type exact positions in
the tower panel or the Details table. An existing design can be given a drawing later: attach the PDF, set the
scale, then TOWERS → MOVE ALL slides its towers onto the sheet.

## The Lab

Menu → **Lab**. The header turns purple and stays that way; nothing in the Lab is a live reading, and nothing
in it reaches the field screen.

- **Simulator**: hold **GO** and every winch or motor runs in its switch direction at its own modeled speed,
  so you watch the heavy towers fall behind. ▲ / OFF / ▼ per tower, tap = one bump, hold = run alone. Bump list
  with seconds on the button and APPLY IN SIM. Undo / redo. Loads per tower against their rating.
- **Sim settings**: lifter specs, power, per-tower feeders and parts of line, the load estimate. Everything
  marked ASSUMED in a design is a starting guess.
- **Teach the sim**: a lift recorded in the field shows how each tower really tracks its neighbours on a run;
  TEACH THE SIM turns that into per-tower speed corrections.
- **Bench model**: on a design marked as a bench model (the scale model), with the hub linked, GO, the switches
  and RUN THESE ON THE MODEL drive its motors, closed-loop on its lasers, with an interlock at the stop tolerance.

### Monitor only, by construction

The app only sends a motor command when all of these hold: it's in the Lab, the stage design on screen is a bench
model, the link isn't switched to MONITOR ONLY, and no tower reports a monitor-only build. The field screen has
no motion controls at all, and the full-size firmware has no motor outputs (`hardware/README.md`).

| Lab keys | |
|---|---|
| `Space` / `Enter` (hold) | GO |
| `↑` `↓` (hold) | master: flips every switch that isn't off to that direction and runs |
| `↑` `↓` with a tower picked | tap = one bump that way, hold = run it alone |
| `←` `→` | pick previous / next tower, `Esc` back to master |
| `T` / `Shift+T` | cycle the picked switch ▲ ○ ▼ / all off |
| `Ctrl+Z`, `Ctrl+Y` or `Ctrl+Shift+Z` | undo, redo |

Everywhere: `W` `A` `S` `D`, `Q` `E`, `Shift` fly the camera; left-drag pans, right-drag orbits, wheel zooms
(touch: one finger pans, two fingers zoom + orbit); `←` `→` pick a tower, digits `'` `.` `/` type its height.

### Reading the picture

- **Contour plot** on the roof: green = on average, yellow → red = high, cyan → blue = low. The scale tops out
  at the stop tolerance.
- **Arrows** at each tower run from the dashed average outline to the sleeve block.
- **Glowing runs and sleeve blocks**: yellow at the watch tolerance (default 4") between neighbouring towers,
  pulsing red at the stop tolerance (default 8"). That differential is what racks a sleeve block.
- **MAGNIFY STRESS** stretches the out-of-level so inches show on a 264 ft roof. Average height stays true.
- Tower columns: field = where the height comes from (blue live, lavender tape, grey stale); Lab = load picked
  up (red) or shed (blue) versus the tower's level-roof share.

## The sim math (`src/lib`)

Fixed-speed 3-phase winches all get the same "go", but they don't turn the same speed:

- **Slip vs load**: induction motor slip is proportional to torque. Lowering, the load overhauls the motor and it
  runs above synchronous speed, so heavy towers lag going up and lead coming down.
- **Voltage drop**: slip also scales with 1/V². Feeder length and gauge set the volts at each motor.
- **Drum layers**: each layer of rope on the drum raises line speed a step.
- **Load sharing**: a tower riding above its neighbours picks up load through the truss (and slows down).
- **Tower loads**: truss, roof and point loads are spread to towers with shape functions that keep force and
  moment equilibrium, so cantilevers lever weight onto the right towers.

## Code

```
src/model    stage designs: types, plan geometry, the library (localStorage + IndexedDB blobs), examples
src/field    the field screen, live readings, tape fallback, lift log, stop alarm
src/lab      simulator store, run loop and bench-model driving, sim settings
src/designs  stage design manager and the PDF importer (pdf.js, loaded only when importing)
src/hw       hub link (Web Serial / WebSocket), wire protocol, link quality, interlock, alarm sound
src/lib      units, level analysis, loads, winch and sim math
src/ui       shared pieces: header, 3D scene, keypad, tower grid
```

## Develop

```
npm install
npm run dev        # http://localhost:5173, also on your LAN
npm test           # math, geometry, library, readings, lift log, protocol, the motion safety rule
npm run fake-hub   # pretend hub on ws://localhost:8181 (see hardware/README.md)
npm run build      # static site in dist/selfriser/
```

### Live: https://pickplayground.com/selfriser/

Open it on the phone once with signal and "Add to Home Screen". After that it is an installed, offline app
(the PDF importer included), and stage designs and lifts live on the device.

```
npm run deploy     # build + push to Cloudflare (wrangler must be logged in)
```

It runs as its own static-assets Worker (`wrangler.toml`) routed at `pickplayground.com/selfriser*`, separate
from the marketing site's Pages project. Pages are sent with `noindex`; the URL is unlisted but public.

Vendor drawings (`*.pdf`) are gitignored on purpose; imported ones never leave the device.
