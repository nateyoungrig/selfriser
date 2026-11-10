# Scale model

A tabletop self-rising roof: a wooden frame on four legs, each corner lifted by a small worm-gear
motor spooling line over a pulley at the top of its leg. A laser on every sleeve measures height, and
each tower has its own controller. One hub on the laptop or phone's USB relays for all of them, so the
app's **Lab** drives the real thing (Menu → Lab, with **Scale model** picked as the stage):

- **GO** and the ▲ / OFF / ▼ switches run the real motors, each at whatever speed it really turns.
- A tap on a switch **bumps** that tower ⅛" (Sim settings), closed-loop on its own laser.
- **BUMP LIST → RUN THESE ON THE MODEL** sends every tower to its level height at once.
- The lasers fill in the heights (green dot after each height), so the contour plot, the worst pair and
  the load shift you see are what the model is actually doing.

The same app, hub and wire format work on a full-size roof in **monitor only** mode: a laser and a
controller on each real tower report heights, and nothing in the app can run a hoist (see
[Full size: monitor only](#full-size-monitor-only)).

```
 phone / laptop ──USB──▶ HUB (ESP32-C3) ··· ESP-NOW radio ···▶ TOWER 1..16 (ESP32-C3 + laser + motor)
   the app               JSON lines ⇄ radio packets             each one closes its own safety loop
```

## Parts

Per tower (×4):

| Part | Notes | ~$ |
|---|---|---|
| ESP32-C3 SuperMini | The controller. Any ESP32 works if you change the pins at the top of `firmware/src/tower/main.cpp`. | 3 |
| VL53L1X laser ToF breakout | 4-pin I2C (VIN, GND, SDA, SCL). Pololu #3415 or a generic one. Reads 4 cm to 3 m to within a few mm. | 6-15 |
| DRV8833 dual motor driver breakout | Channel A runs the motor; channel B a second motor on a two-motor tower. | 2 |
| N20 worm-gear motor, 6 V, 30-40 rpm | The worm makes it self-locking, like a winch brake: the frame stays up with the power off. | 6 |
| Spool | ¾" dia, about ½" between the flanges: a slice of dowel with washers glued on, or 3D printed, on the 3 mm D shaft. | - |
| Head pulley | 3×10×4 mm bearing or a small V-groove pulley on a screw at the top of the leg. | 1 |
| Line | 20-50 lb braided fishing line (PE braid; it doesn't stretch like mono). | - |
| Top limit switch (optional) | Small microswitch at the top of the leg, normally open to GND. A backstop for the laser's soft limit. | 1 |

Once for the model:

| Part | Notes |
|---|---|
| One more ESP32-C3 SuperMini | The hub. Needs no other parts. |
| USB-C cable (+ OTG adapter for an Android phone) | Hub to the device running the app. |
| 5 V 3 A supply | USB-C power bank or wall adapter, to a 5 V / GND bus run past every tower. Motors draw about 0.25 A each. |
| Frame | 1×2 pine or ¾" square dowel. The scale model's stage design assumes leg centers 24" × 18", 36" legs, 30" max trim. |

## Mechanics

Each corner of the frame is fixed to a **sleeve**: a short box (four strips of wood or a printed part) that
slides on its leg with about 1/32" of clearance. That clearance is what binds when neighbouring corners
get out of level, just like a sleeve block racking on a real tower.

```
          ◯  head pulley at the top of the leg
          │╲
          │ ╲ line
          │  │
   frame ─┼──┤ sleeve (eye for the line on its top)
          │  └──┐
          │   laser on a 2" outrigger, looking DOWN at the base plate
          │  ┆
          │  ┆   (keep the leg out of the laser's cone: 2" off the leg is plenty with roi 8)
          │  ┆
   ═══════╧══▼═══ white base plate  ── motor + spool + controller at the foot of the leg
```

- **Line:** from the spool, up over the head pulley, down to the eye on the sleeve (one part of line). For
  two parts like full-size pulley winches, dead-end the line at the top, run it down around a pulley on the
  sleeve and back up; set *Parts of line* to 2 in the Lab's Sim settings.
- **Laser:** looking down at a flat, matte, light-coloured target (paper on the base plate is ideal). It needs
  at least 4 cm to the target with the frame on the deck. Distance grows as the roof rises, like a laser on
  a real roof looking at the ground. If you'd rather mount it at the top of the leg looking down at the
  sleeve, type `reverse` on that tower's console.
- **Cable:** the laser rides the sleeve, so give it about a metre of four-conductor ribbon or servo wire with a
  loop to the controller at the base.

## Wiring (ESP32-C3 SuperMini or Seeed XIAO ESP32C3)

Both boards use the same GPIOs (the XIAO's pin names in `firmware/include/board.h`), except the XIAO has
no GPIO 1: its top limit switch goes on **D0** (GPIO 2), and it has no status LED.

| From | To |
|---|---|
| 5 V bus | SuperMini **5V**, DRV8833 **VM** (VCC) |
| GND bus | SuperMini **G**, DRV8833 **GND**, laser **GND**, limit switch |
| SuperMini **3.3** | laser **VIN**, DRV8833 **SLP / EEP** (if your board doesn't pull it high) |
| GPIO **6** | laser **SDA** |
| GPIO **7** | laser **SCL** |
| GPIO **3** / **4** | DRV8833 **AIN1** / **AIN2** → **AOUT1 / AOUT2** to the motor |
| GPIO **5** / **10** | DRV8833 **BIN1** / **BIN2** → second motor (only on a two-motor tower) |
| GPIO **1** | top limit switch, other leg to GND (optional; open = not hit) |

The on-board LED (GPIO 8) is solid while the motor runs, blinks slowly when linked to the hub, and fast while
it's looking for the hub or hasn't been given a tower number.

## Firmware

[PlatformIO](https://platformio.org/) (VS Code extension or `pip install platformio`), from `hardware/firmware/`:

```
pio run -e tower -t upload      # each tower controller
pio run -e hub -t upload        # the hub
pio device monitor              # 115200 baud console
```

Then on each tower's console (plug it in on its own, `pio device monitor`):

```
tower 1        # its number in the app: 1-2 downstage SR→SL, 3-4 upstage
info           # laser reading, settings
up / down      # half-second bench jog. If "up" lowers it: invert
zero           # with the frame on the deck
```

Everything is stored on the board. Other settings: `motors 2`, `duty 80` (slow the whole tower down),
`minduty 45` (slowest crawl at the end of a bump; raise it if bumps stall short), `max 30` (top soft limit;
the app also sends its max trim on connect), `roi 4-16` (laser cone, narrower if it sees the leg),
`net 2` (a second model in the same room; the hub needs `-DHUB_NET=2`).

## Using it

1. Power the model, plug the hub into the laptop or Android phone.
2. In Chrome or Edge, open the app, pick **Scale model** in the stage picker, Menu → **Lab**, then the lasers pill → **CONNECT USB HUB**, choose the hub's port.
   Each tower row should say *ready* with a laser reading.
3. Frame sitting on the deck: **ZERO ALL**.
4. Hold **GO**. Watch the slow corners fall behind; the run stops itself (the *interlock*) if two neighbours
   reach the stop tolerance and are still getting worse. Bump them back, or run the bump list.
5. **■ STOP** in the header stops every tower at once. Letting go of GO stops them too, and so does closing
   the tab, pulling the USB cable or the phone going to sleep: towers stop 0.4 s after the app goes quiet.

### iPhone / Wi-Fi

iOS browsers have no Web Serial. Build the hub with Wi-Fi instead:

```
SELFRISER_SSID=myWifi SELFRISER_PASS=secret pio run -e hub-wifi -t upload
```

The hub joins that network and serves the same JSON on `ws://selfriser-hub.local:81` (the towers follow it
to the router's channel on their own). Browsers only let an **http** page open `ws://`, so run the app from
a laptop on the same Wi-Fi with `npm run dev` and open `http://<laptop>:5173` on the phone, then
**lasers pill → CONNECT WI-FI HUB** (use the hub's IP from the laptop's USB console if `.local` doesn't resolve).

### No hardware yet

```
npm run fake-hub          # 4 pretend towers on ws://localhost:8181
npm run dev
npm run fake-hub -- 12 8181 --monitor   # or 12 full-size monitor-only towers for the demo roof
```

Open `http://localhost:5173`, pick **Scale model**, Menu → **Lab**, lasers pill → **CONNECT WI-FI HUB** with `ws://localhost:8181`. The pretend
towers run at slightly different speeds, with laser noise, the deadman, soft limits and GOTO, like the
firmware. With `--monitor` they ignore the app and a pretend crew runs a 16 fpm lift, stopping every 20 s to
bump the high towers back.

## Full size: monitor only

On a real roof the hoists or winches stay on their own rated controls and pendant (ANSI E1.6-1). The app
and this hardware only **measure**: live height at every tower, the level picture, the worst pair, the bump
list for the crew to call, and an alarm at the stop tolerance. Three layers keep it that way:

1. **Firmware:** the `monitor` build has no motor outputs at all. The motor pins are never set up, and
   RUN / GOTO / STOP from the hub are ignored. Each tower tells the app it is monitor-only.
2. **Stage design:** only a design marked as a bench model (the scale model) may drive motors, and only in the
   Lab. A full-size stage, or anything on the field screen, is always monitor only.
3. **App:** the field screen has no motion controls at all, and no run or goto command leaves the app unless
   the Lab, a bench-model design and the link all allow it. The model has a **DRIVE THE MODEL / MONITOR ONLY**
   switch on the Tower lasers page (in the Lab) to rehearse the full-size workflow.

When two neighbouring towers with live lasers are at the stop
tolerance, the app shows **STOP: 3-4 are 8" apart** full-width, beeps and vibrates the phone every 3 s until
they're back inside. That is a prompt for the operator to stop the hoists, not a stop itself.

### Parts per tower, about $110-130

| Part | Notes | ~$ |
|---|---|---|
| [DFRobot SEN0366](https://www.dfrobot.com/product-2108.html) laser | Red-dot phase-shift laser, 80 m indoors / 50 m outdoors, ±1 mm, UART. Also at DigiKey and Mouser. | 70 |
| [Seeed XIAO ESP32C3](https://www.seeedstudio.com/Seeed-XIAO-ESP32C3-p-5431.html) | Thumbnail-size ESP32-C3 with a U.FL antenna jack, for range across a site. Seeed, DigiKey, Amazon (Seeed's store), some Micro Centers. Get one more for the hub. Pre-soldered headers if you don't want to solder. | 5-11 |
| Antenna | The XIAO has **no usable antenna on the board**: without one the range is a few feet. Resellers' packs don't always include it. For the box: a U.FL to RP-SMA bulkhead pigtail and an RP-SMA 2.4 GHz rubber-duck antenna. For the bench: a U.FL flex antenna. | 5-10 |
| IP65 box, cable gland, vent plug, silica gel | See [Weatherproof box](#weatherproof-box). | 15-20 |
| Power | 12 V battery with a 5 V buck, or a small 120 V to 5 V supply. Never tap the hoist's 480 V. | 10-15 |
| Bracket and target | Laser on the sleeve block looking down; a matte white or orange target plate on the deck under it. Outdoors in sun the plate makes the difference. | 10 |

Wiring: SEN0366 **VCC** to 3.3 V (it runs on 3.3-5 V; at 3.3 V its logic matches the ESP32), **GND**,
its **TX** to GPIO **20** (XIAO pin **D7 / RX**), its **RX** to GPIO **21** (XIAO **D6 / TX**). It's a Class 2
visible laser: aim it away from people's eyes.

```
pio run -e monitor-xiao -t upload   # SEN0366 on a XIAO ESP32C3, monitor only
pio run -e hub-xiao -t upload       # the hub on a XIAO
pio run -e monitor -t upload        # SEN0366 on a SuperMini, monitor only
pio run -e monitor-vl53 -t upload   # the model's VL53L1X towers as monitor only
```

### Range across a site

Every board talks ESP-NOW in Espressif's **long-range mode** (250 kbit/s, several times the reach of
normal 2.4 GHz Wi-Fi). We send about 20 bytes a few times a second per tower, so the slower rate costs
nothing. Only ESP32s can hear it, and every board in a system has to match: to turn it off, add
`-DRADIO_STANDARD` to `[env]` in `platformio.ini` and reflash everything.

Mounting matters as much as the board:

- **Antenna outside metal.** A plastic box, or the antenna on the outside of a metal one.
- **Clear of the steel,** on the side of the tower that faces the hub.
- **Hub up high** with a clear view of the towers, not under the roof. It can sit on a USB extension.
- **Test first:** walk one tower to the farthest point on site, up on the steel if you can, and watch its
  row on the Tower lasers page before buying for every tower.

### Relaying through towers

A tower the hub can't hear directly still gets through if a neighbour can. Twice a second the hub's beacon
says which towers it hears directly and which it doesn't. A tower that hears a missing neighbour, and is
itself heard by the hub, repeats that neighbour's reports after a random few milliseconds; if another tower
repeats the same report first, it stands down, so one hidden tower costs about one extra report, not five.
Repeats are never repeated again (one hop), and the hub drops duplicate copies using each report's counter.
ZERO ALL and the max-trim setting are passed on the same way, so they reach hidden towers too.

When everything has line of sight nothing is relayed. Tower lasers shows **via tower 4** in yellow on any tower that
depends on a neighbour. The rules are in `firmware/include/relay.h`; `firmware/test/run.sh` runs their tests
on a computer.

To see it on the bench you need three boards: flash the third as `tower 2` too, then put the hub behind a
wall or a car from one tower while the other tower can see both. `npm run fake-hub -- 12 8181 --monitor
--hide 7` shows what it looks like in the app without hardware.

If 2.4 GHz still won't reach, 915 MHz LoRa boards (Heltec WiFi LoRa 32, LilyGO T-Beam) get through steel
and crowds far better; that would mean replacing `include/radio.h`, and the app wouldn't change.

Set the tower number the same way (`tower 7`). With the roof on the deck, **ZERO ALL** on the Tower lasers page. The
SEN0366 reports a few times a second, which at 16 fpm is a few inches of travel between readings; fine to
watch, and the reason this is not a control loop.

### Before the laser arrives: bench test with two XIAOs

Everything but the laser can be proven with two XIAO ESP32C3s, antennas, a jumper wire and a power bank:
flashing, the long-range radio, the hub, the app's Tower lasers page, and how far the radio reaches on site.

1. **Tools, once:** [VS Code](https://code.visualstudio.com/) with the PlatformIO extension, [Node.js](https://nodejs.org/)
   LTS, and this repo on the `claude/robotic-winch-scale-model-vifz9h` branch. Snap an antenna onto each XIAO
   (the gold U.FL plug) before powering it.
2. **Hub:** plug XIAO #1 into the computer and run `pio run -e hub-xiao -t upload` from `hardware/firmware/`.
   If the upload can't find the board, hold the XIAO's **B** (boot) button while plugging it in, then retry.
3. **Tower:** plug in XIAO #2, `pio run -e monitor-xiao-loopback -t upload`, then `pio device monitor` and type
   `tower 1` then `info`. The laser line says **NOT READING**: nothing is wired yet.
4. **Stand-in laser:** a female-female jumper from **D6** to **D7** on the tower XIAO. `info` now says
   **reading**, with a distance that sweeps between 1 m and 10 m every two minutes (`sim 3000` pins it at
   3 m, `sim sweep` goes back). Those frames go through the same parser the SEN0366's will.
5. **App:** in the repo, `npm install` then `npm run dev`, and open `http://localhost:5173` in **Chrome or
   Edge**. Plug the hub into the computer and the tower into a power bank. Pick **Demo roof - 12 towers** in the stage
   picker (any full-size stage is monitor only), lasers pill → **CONNECT USB HUB**, pick the hub's port. Tower 1 shows *ready · monitor* with a live height,
   and the tower 1 card on the main screen has the green dot. **ZERO ALL** makes the current reading 0.
6. **Failure check:** pull the jumper. Within a couple of seconds the card says **NO LASER**. Put it back.
7. **Range walk:** carry the tower (on its power bank) away from the hub, ideally around a real site and up
   against steel, and watch its row on the Tower lasers page. The **Signal** column is the share of the tower's reports
   reaching the hub (it reports 5 times a second): green 80-100% is solid, yellow means you're near the
   edge, red is about to drop. Note where it turns yellow and where it drops out. That distance decides whether the
   plain XIAO antennas are enough or you need the rubber-duck antennas or a better hub spot.
8. **Current draw (optional):** a USB-C inline meter between the power bank and the tower tells you the real
   draw, and so how big a battery a show day needs. Add the laser's draw once it arrives.

When the SEN0366 comes, flash the tower with `monitor-xiao` instead (no stand-in), wire the laser (VCC 3.3 V,
GND, laser TX to D7, laser RX to D6) and repeat step 5.

### Stand-in sensor: Garmin LIDAR-Lite v3

Micro Center carries it (SparkFun part SF14032, about $53). 40 m range, about ±2.5 cm (±1") per reading,
invisible Class 1 beam. With the 4" / 8" tolerances that is accurate enough to monitor a lift, and the
firmware averages its fast readings to take out most of the jitter.

```
pio run -e monitor-xiao-lidarlite -t upload
```

| LIDAR-Lite wire | XIAO |
|---|---|
| Red (5 V) | **5V** pin (the XIAO passes USB power through; needs a USB power bank or supply) |
| Black (GND) | **GND** |
| Blue (SDA) | **D4** |
| Green (SCL) | **D5** |
| Orange (power enable), yellow (mode) | leave unconnected |

Garmin's manual calls for a **680 µF electrolytic capacitor** across 5 V and GND at the sensor (stripe side
to GND); it draws current in pulses. It runs on 5 V: before connecting blue and green, power it up and check
with a multimeter that blue and green sit at about 3.3 V to GND, not 5 V. If they read 5 V, put a small I2C
level shifter between it and the XIAO. The beam is invisible, so aim it by the housing: square to the target
plate, and check `info` on the console shows a sensible distance.

### Weatherproof box

```
        rubber-duck antenna (outside, pointing up, toward the hub)
              │  RP-SMA bulkhead through the lid or the hub-facing side
   ┌──────────┴──────────┐  IP65 box, light coloured (stays cooler in sun)
   │  XIAO on standoffs  │
   │  or foam tape       │══ cable gland ── power in, drip loop outside
   │  silica gel         │
   │  SEN0366 bolted to  │
   │  the floor, lenses  │
   │  over an open hole  │
   └──────┤ hole ├───────┘  bottom face, pointing straight down at the deck
          ╵ short hood ╵    a stub of PVC pipe keeps sun and splash off the lenses
               ↓ laser
```

- **Box:** an IP65 ABS or polycarbonate junction box about 4×4×2" (100×100×60 mm), or a grey PVC
  weatherproof box from the hardware store. Light coloured: a black box in the sun gets hot, and the SEN0366
  has an operating temperature range (check its datasheet).
- **Laser:** on the bottom face, pointing straight down, lenses over a hole drilled through the box. Seal
  around its edge with foam gasket or a bead of silicone. **No window over the hole:** plastic or glass
  reflects part of the beam back into the sensor and ruins the readings. Facing down, rain doesn't get in; a
  short hood blocks spray and glare. Mount it **plumb**: a tilted laser reads long.
- **Board:** nylon standoffs, or double-sided foam tape on a scrap of plastic. Hot glue where the wires meet
  the board, so vibration doesn't break the joints.
- **Antenna outside:** through an RP-SMA bulkhead, never inside a metal box.
- **Power:** through a cable gland (PG7 suits thin cable) with a drip loop. A USB power bank inside is fine
  for a test; run power in for a show day.
- **Condensation:** sealed boxes breathe and collect water as the temperature swings. A silica gel pack, and
  a vent plug (breathable membrane) or a pinhole drain at the lowest corner away from the electronics.
- **On the sleeve block:** stainless hose clamps, U-bolts or a strut clamp onto the steel, antenna on the side
  of the tower facing the hub. **It hangs over people:** a positive mechanical attachment plus a secondary
  safety cable, like anything else rigged overhead. Never magnets or zip ties alone.
- **Build one first.** Take it to a site or a big yard and check on the Tower lasers page that the readings are steady and
  the tower stays live at your farthest distance, then build the rest.

## Safety rules in the tower firmware

- **Hold to run.** RUN frames must keep arriving (the app sends 10 a second while GO is held); 400 ms without
  one and the tower stops.
- **Soft limits** from the laser: never below 0, never above max trim. Plus the optional top switch.
- **Stall:** driving for 1.5 s without the laser seeing 1 mm of travel (jammed sleeve, slack or snapped line,
  dead motor) stops and latches until the next STOP. Let go of GO and press again to retry.
- **No laser, no motion.**

## Protocol

App ⇄ hub is one JSON object per line over USB serial (115200) or the WebSocket; `src/hw/protocol.ts` is the
reference. Hub ⇄ towers is packed structs over ESP-NOW broadcast, `firmware/include/wire_format.h`.

| app → hub | |
|---|---|
| `{"t":"run","d":[1,0,-1,1]}` | direction per tower, index = tower number - 1; resend every 100 ms |
| `{"t":"stop"}` | all stop, clears stalls |
| `{"t":"goto","n":2,"h":12.5}` | tower 2 to 12.5" and stop |
| `{"t":"zero","n":0}` | tower n (0 = all): this reading is 0 |
| `{"t":"cfg","n":0,"max":30}` | top soft limit, inches |

| hub → app | |
|---|---|
| `{"t":"tel","n":1,"h":12.345,"mm":456,"s":"run","d":1,"q":0,"max":30}` | per tower, 20 Hz moving / 5 Hz idle. `s`: idle, run, goto, limit, stall, nosensor. `"mon":1` from a monitor-only build, `"via":4` when tower 4 relayed it |
| `{"t":"hub","fw":"0.1.0","net":1,"ch":1,"towers":[1,2,3,4]}` | once a second |
| `{"t":"log","m":"..."}` | hub messages |
