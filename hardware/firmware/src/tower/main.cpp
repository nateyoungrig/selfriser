// One tower of the scale model: a laser under the sleeve, a gearmotor on the spool, and the rules
// that keep a wooden frame from getting racked or dropped.
//
//   The laser rides the sleeve looking down at the base plate (like a laser on a real roof looking
//   at the deck), so its distance grows as the roof rises: height = distance - zero.
//
//   - Hold-to-run: RUN frames from the hub have to keep coming. 400 ms without one and it stops,
//     so a closed laptop, a dead hub or a crashed tab parks the model.
//   - Soft limits from the laser: never below 0 (roof on the deck), never above maxIn.
//   - Stall: driving for 1.5 s without the laser seeing 1 mm of travel stops and latches until
//     the next STOP (let go of GO and press again to retry).
//   - No sensor, no motion.
//
// Build options (platformio.ini envs):
//   SENSOR_SEN0366  DFRobot SEN0366 red-dot laser on UART (50 m outdoors, +-1 mm) instead of the
//                   VL53L1X: the full-size laser.
//   SENSOR_LIDARLITE Garmin LIDAR-Lite v3 on I2C (40 m, about +-1") on the VL53L1X's pins.
//   LASER_LOOPBACK  bench test before the laser arrives: the board sends itself SEN0366 frames on TX.
//                   Jumper TX to RX (XIAO D6 to D7) and it reports a slowly sweeping height through the
//                   real parser; pull the jumper and it reports NO LASER. Console: sim <mm> | sim sweep.
//   MONITOR_ONLY    no motor outputs at all. The tower only measures and reports; RUN / GOTO / STOP
//                   are ignored and the motor pins are never configured. For real roofs, where the
//                   hoists stay on their own rated controls.
//
// Setup over this board's own USB serial at 115200 (type "help").

#include <Arduino.h>
#include <Preferences.h>

#include "board.h"
#include "radio.h"
#include "relay.h"
#include "wire_format.h"

#if defined(SENSOR_SEN0366)
#include "sen0366.h"
#elif defined(SENSOR_LIDARLITE)
#include "lidarlite.h"
#else
#include <VL53L1X.h>
#include <Wire.h>
#endif

#ifdef MONITOR_ONLY
constexpr bool MONITOR = true;
#else
constexpr bool MONITOR = false;
#endif

#ifndef FW_VERSION
#define FW_VERSION "0.1.0"
#endif

// Pins: include/board.h (SuperMini, or the XIAO with -DBOARD_XIAO_C3).

constexpr uint32_t DEADMAN_MS = 400;
constexpr uint32_t STALL_MS = 1500;
constexpr float STALL_MIN_TRAVEL_IN = 0.04f;  // ~1 mm
constexpr float GOTO_TOLERANCE_IN = 0.03f;
constexpr float GOTO_SLOW_IN = 0.5f;  // start slowing this far from the target
constexpr uint32_t GOTO_TIMEOUT_MS = 30000;
#if defined(SENSOR_SEN0366) || defined(SENSOR_LIDARLITE)
constexpr uint32_t SENSOR_TIMEOUT_MS = 1500;  // it reports a few times a second, slower in poor light
#else
constexpr uint32_t SENSOR_TIMEOUT_MS = 300;
#endif
constexpr uint32_t HUB_LOST_MS = 3000;
constexpr uint32_t HOP_MS = 250;

struct Settings {
  uint8_t tower = 0;  // 0 = not assigned yet: listens, never moves
  uint8_t net = 1;
  int32_t zeroMm = 0;
  bool invertMotor = false;
  bool reversed = false;  // laser at the top of the leg looking down at the sleeve: distance shrinks as the roof rises
  uint8_t roi = 8;        // laser field of view, SPADs square: 16 = 27 deg, 8 ~ 20 deg, 4 = 15 deg (narrower = fewer leg echoes, noisier)
  uint8_t motors = 1;
  uint8_t dutyPct = 100;
  uint8_t minDutyPct = 45;  // slowest a GOTO will crawl; below this N20s tend to stall
  float maxIn = 30;
  uint8_t channel = 1;
} cfg;

Preferences prefs;
#if defined(SENSOR_SEN0366)
sen0366::Parser laser;
uint32_t lastLaserByteMs = 0;
bool rawDump = false;  // console "raw": print the laser's bytes in hex, one frame per line
#elif defined(SENSOR_LIDARLITE)
lidarlite::Reader lidar;
uint32_t lastLidarTryMs = 0;
#else
VL53L1X sensor;
#endif
bool sensorOk = false;

// Latest filtered reading.
float heightIn = 0;
uint32_t rawMm = 0;
uint8_t rangeStatus = 255;
uint32_t lastGoodReadMs = 0;
uint32_t window[3] = {0, 0, 0};
uint8_t windowFill = 0;

enum class Mode { Idle, Run, Goto };
Mode mode = Mode::Idle;
int8_t runDir = 0;
uint32_t runUntilMs = 0;
float gotoTarget = 0;
uint32_t gotoStartMs = 0;
uint8_t gotoReversals = 0;
int8_t lastGotoDir = 0;

bool stalled = false;
int8_t motorDir = 0;
float stallRefIn = 0;
uint32_t stallRefMs = 0;
uint8_t lastState = wire::IDLE;

uint32_t lastHubMs = 0;  // last packet from the hub itself
uint32_t lastNetMs = 0;  // last packet from anyone on our net: hub, or a neighbour on the right channel
relay::Relayer relayer;
// Packets arrive on the Wi-Fi task and repeats go out from loop(): the relay queue is shared.
portMUX_TYPE relayLock = portMUX_INITIALIZER_UNLOCKED;
uint8_t telSeq = 0;
uint8_t relayedZeroSeq = 0, relayedConfigSeq = 0;
uint32_t lastHopMs = 0;
uint32_t lastTelemetryMs = 0;
uint8_t lastSeqGoto = 0, lastSeqZero = 0, lastSeqConfig = 0;

// ---------------------------------------------------------------------------------------------

void loadSettings() {
  prefs.begin("tower", true);
  cfg.tower = prefs.getUChar("tower", cfg.tower);
  cfg.net = prefs.getUChar("net", cfg.net);
  cfg.zeroMm = prefs.isKey("zeromm") ? prefs.getInt("zeromm", cfg.zeroMm) : prefs.getShort("zero", cfg.zeroMm);
  cfg.invertMotor = prefs.getBool("invert", cfg.invertMotor);
  cfg.reversed = prefs.getBool("reversed", cfg.reversed);
  cfg.roi = prefs.getUChar("roi", cfg.roi);
  cfg.motors = prefs.getUChar("motors", cfg.motors);
  cfg.dutyPct = prefs.getUChar("duty", cfg.dutyPct);
  cfg.minDutyPct = prefs.getUChar("minduty", cfg.minDutyPct);
  cfg.maxIn = prefs.getFloat("max", cfg.maxIn);
  cfg.channel = prefs.getUChar("ch", cfg.channel);
  prefs.end();
}

void saveSettings() {
  prefs.begin("tower", false);
  prefs.putUChar("tower", cfg.tower);
  prefs.putUChar("net", cfg.net);
  prefs.putInt("zeromm", cfg.zeroMm);
  prefs.putBool("invert", cfg.invertMotor);
  prefs.putBool("reversed", cfg.reversed);
  prefs.putUChar("roi", cfg.roi);
  prefs.putUChar("motors", cfg.motors);
  prefs.putUChar("duty", cfg.dutyPct);
  prefs.putUChar("minduty", cfg.minDutyPct);
  prefs.putFloat("max", cfg.maxIn);
  prefs.putUChar("ch", cfg.channel);
  prefs.end();
}

// ---------------------------------------------------------------------------------------------
// Motor: DRV8833, slow decay. Both inputs high = brake; the worm gear holds the load anyway.
// Every write goes through analogWrite: once a pin is on the PWM peripheral, digitalWrite can't reach it.

void driveBridge(int in1, int in2, int8_t dir, uint8_t duty) {
  if (dir == 0) {
    analogWrite(in1, 255);
    analogWrite(in2, 255);
  } else if (dir > 0) {
    analogWrite(in1, 255);
    analogWrite(in2, 255 - duty);  // drives while low, brakes while high
  } else {
    analogWrite(in1, 255 - duty);
    analogWrite(in2, 255);
  }
}

void drive(int8_t dir, uint8_t dutyPct) {
  if (MONITOR) {
    motorDir = 0;  // no motor outputs in this build: never touch the pins
    return;
  }
  if (dir != motorDir) {
    // Direction change or start: restart the stall window.
    stallRefIn = heightIn;
    stallRefMs = millis();
  }
  motorDir = dir;
  int8_t d = cfg.invertMotor ? -dir : dir;
  uint8_t duty = (uint8_t)(255 * constrain(dutyPct, 0, 100) / 100);
  driveBridge(PIN_MOTOR_A1, PIN_MOTOR_A2, d, duty);
  if (cfg.motors > 1) driveBridge(PIN_MOTOR_B1, PIN_MOTOR_B2, d, duty);
}

void halt() {
  mode = Mode::Idle;
  runDir = 0;
  drive(0, 0);
}

// ---------------------------------------------------------------------------------------------
// Sensor: median of the last three good readings, zeroed.

uint32_t median3(uint32_t a, uint32_t b, uint32_t c) {
  return max(min(a, b), min(max(a, b), c));
}

void acceptReading(uint32_t mm) {
  rawMm = mm;
  window[0] = window[1];
  window[1] = window[2];
  window[2] = mm;
  if (windowFill < 3) windowFill++;
  uint32_t filtered = windowFill < 3 ? mm : median3(window[0], window[1], window[2]);
  int32_t travel = cfg.reversed ? cfg.zeroMm - (int32_t)filtered : (int32_t)filtered - cfg.zeroMm;
  heightIn = travel / 25.4f;
  lastGoodReadMs = millis();
}

#if defined(SENSOR_SEN0366)

void startLaser() {
  Serial1.write(sen0366::CONTINUOUS, sizeof(sen0366::CONTINUOUS));
  lastLaserByteMs = millis();
}

void beginSensor() {
  Serial1.begin(9600, SERIAL_8N1, PIN_LASER_RX, PIN_LASER_TX);
  delay(300);  // let the laser boot
  startLaser();
  sensorOk = true;  // proven by frames arriving: sensorFresh() goes false if they stop
}

#ifdef LASER_LOOPBACK
// Stand-in laser: frames go out on TX five times a second and, through the jumper, back in on RX.
// Sweeps 1-10 m over two minutes unless pinned with "sim <mm>".
int32_t simMm = -1;  // -1 = sweep
uint32_t lastSimMs = 0;
void simLaser() {
  uint32_t now = millis();
  if (now - lastSimMs < 200) return;
  lastSimMs = now;
  uint32_t mm = simMm >= 0 ? (uint32_t)simMm : (uint32_t)(5500 - 4500 * cosf(now * 6.2832f / 120000.0f));
  uint8_t frame[11];
  sen0366::makeFrame(mm, frame);
  Serial1.write(frame, sizeof(frame));
}
#endif

void readSensor() {
#ifdef LASER_LOOPBACK
  simLaser();
#endif
  sen0366::Reading r;
  while (Serial1.available()) {
    lastLaserByteMs = millis();
    uint8_t b = Serial1.read();
    if (rawDump) Serial.printf(b == 0x80 ? "\n%02X " : "%02X ", b);
    if (!laser.feed(b, r)) continue;
    rangeStatus = r.ok ? 0 : 1;  // 1 = ERR: no return (out of range, bad target, sun)
    if (r.ok) acceptReading(r.mm);
  }
  // Laser power-cycled or never heard the command: ask again.
  if (millis() - lastLaserByteMs > 2000) startLaser();
}

#elif defined(SENSOR_LIDARLITE)

void beginSensor() {
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(100000);  // it rides a metre of cable on the sleeve
  sensorOk = lidar.begin();
}

void readSensor() {
  uint32_t now = millis();
  // Not found at boot (unplugged, or powered after the board): keep looking once a second.
  if (!sensorOk) {
    if (now - lastLidarTryMs > 1000) {
      lastLidarTryMs = now;
      sensorOk = lidar.begin();
    }
    return;
  }
  uint32_t mm;
  if (lidar.poll(mm, now)) {
    rangeStatus = 0;
    acceptReading(mm);
  }
}

#else

void beginSensor() {
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(100000);  // the laser rides a metre of ribbon cable on the sleeve
  sensor.setTimeout(100);
  sensorOk = sensor.init();
  if (!sensorOk) return;
  sensor.setDistanceMode(VL53L1X::Medium);  // good to ~3 m indoors
  sensor.setMeasurementTimingBudget(50000);
  sensor.setROISize(cfg.roi, cfg.roi);
  sensor.startContinuous(50);
}

void readSensor() {
  if (!sensorOk || !sensor.dataReady()) return;
  uint16_t mm = sensor.read(false);
  rangeStatus = sensor.ranging_data.range_status;
  if (rangeStatus == VL53L1X::RangeValid) acceptReading(mm);
}

#endif

bool sensorFresh() { return sensorOk && lastGoodReadMs && millis() - lastGoodReadMs < SENSOR_TIMEOUT_MS; }

void zeroHere() {
  if (!sensorFresh()) return;
  uint32_t filtered = windowFill < 3 ? rawMm : median3(window[0], window[1], window[2]);
  cfg.zeroMm = (int32_t)filtered;
  heightIn = 0;
  saveSettings();
}

// ---------------------------------------------------------------------------------------------

bool topLimitHit() { return digitalRead(PIN_TOP_LIMIT) == LOW; }

/** Is this direction allowed from here? */
bool allowed(int8_t dir) {
  if (dir > 0) return heightIn < cfg.maxIn && !topLimitHit();
  if (dir < 0) return heightIn > 0;
  return true;
}

/** Runs every loop: decide what the motor does and what state we report. */
uint8_t control() {
  uint32_t now = millis();
  if (MONITOR) return sensorFresh() ? wire::IDLE : wire::NO_SENSOR;
  if (cfg.tower == 0) {
    halt();
    return wire::IDLE;
  }
  if (!sensorFresh()) {
    halt();
    return wire::NO_SENSOR;
  }
  if (mode == Mode::Run && now > runUntilMs) halt();  // deadman
  if (mode == Mode::Goto && now - gotoStartMs > GOTO_TIMEOUT_MS) halt();

  int8_t want = 0;
  uint8_t duty = cfg.dutyPct;
  if (mode == Mode::Run) {
    want = runDir;
  } else if (mode == Mode::Goto) {
    float err = gotoTarget - heightIn;
    if (fabsf(err) <= GOTO_TOLERANCE_IN) {
      halt();
      return wire::IDLE;
    }
    want = err > 0 ? 1 : -1;
    if (lastGotoDir && want != lastGotoDir && ++gotoReversals > 3) {  // hunting: close enough
      halt();
      return wire::IDLE;
    }
    lastGotoDir = want;
    float k = min(1.0f, fabsf(err) / GOTO_SLOW_IN);
    duty = (uint8_t)(cfg.minDutyPct + k * (cfg.dutyPct - cfg.minDutyPct));
  }

  if (stalled) {
    drive(0, 0);
    return wire::STALLED;
  }
  if (want && !allowed(want)) {
    drive(0, 0);
    if (mode == Mode::Goto) halt();
    return wire::AT_LIMIT;
  }
  drive(want, duty);

  if (motorDir) {
    if (fabsf(heightIn - stallRefIn) >= STALL_MIN_TRAVEL_IN) {
      stallRefIn = heightIn;
      stallRefMs = now;
    } else if (now - stallRefMs > STALL_MS) {
      stalled = true;
      drive(0, 0);
      return wire::STALLED;
    }
    return mode == Mode::Goto ? wire::GOTO_RUN : wire::RUNNING;
  }
  return wire::IDLE;
}

// ---------------------------------------------------------------------------------------------
// Radio

/** A neighbour's report: repeat it if the hub can't hear that neighbour, or stand down if someone did. */
void onNeighbour(const uint8_t *data, int len) {
  if (len < (int)sizeof(wire::Telemetry)) return;
  const wire::Telemetry *t = reinterpret_cast<const wire::Telemetry *>(data);
  wire::Telemetry copy = *t;
  copy.via = cfg.tower;
  uint32_t rnd = esp_random();
  portENTER_CRITICAL(&relayLock);
  if (t->via) relayer.heardRelay(t->tower, t->h.seq);
  else if (relayer.shouldRelay(cfg.tower, t->tower, millis()))
    relayer.schedule(t->tower, t->h.seq, reinterpret_cast<const uint8_t *>(&copy), sizeof(copy), millis(), rnd);
  portEXIT_CRITICAL(&relayLock);
}

/** ZERO / CONFIG from the hub: pass each one on once, for a tower that can't hear the hub. */
void relayDownlink(const uint8_t *data, int len, uint8_t &lastRelayed) {
  const wire::Header *h = reinterpret_cast<const wire::Header *>(data);
  if (h->seq == lastRelayed || !cfg.tower) return;
  lastRelayed = h->seq;
  uint32_t rnd = esp_random();
  portENTER_CRITICAL(&relayLock);
  relayer.schedule(100 + h->type, h->seq, data, len, millis(), rnd);  // its own slot per kind, clear of tower numbers
  portEXIT_CRITICAL(&relayLock);
}

void onPacket(const uint8_t *data, int len) {
  if (!wire::valid(data, len, cfg.net)) return;
  const wire::Header *h = reinterpret_cast<const wire::Header *>(data);
  lastNetMs = millis();  // someone on our channel: no need to go looking for the hub
  if (h->type == wire::TELEMETRY) {
    onNeighbour(data, len);
    return;
  }
  lastHubMs = millis();
  // A monitor tower has nothing to run: it only listens for zero, config and the hub's channel.
  if (MONITOR && (h->type == wire::RUN || h->type == wire::STOP || h->type == wire::GOTO)) return;
  switch (h->type) {
    case wire::RUN: {
      if (len < (int)sizeof(wire::Run) || cfg.tower == 0 || cfg.tower > wire::MAX_TOWERS) return;
      int8_t d = reinterpret_cast<const wire::Run *>(data)->dir[cfg.tower - 1];
      mode = Mode::Run;
      runDir = d > 0 ? 1 : d < 0 ? -1 : 0;
      runUntilMs = millis() + DEADMAN_MS;
      break;
    }
    case wire::STOP:
      halt();
      stalled = false;
      break;
    case wire::GOTO: {
      if (len < (int)sizeof(wire::Goto)) return;
      const wire::Goto *g = reinterpret_cast<const wire::Goto *>(data);
      if (g->tower != cfg.tower || h->seq == lastSeqGoto) return;
      lastSeqGoto = h->seq;
      stalled = false;
      mode = Mode::Goto;
      gotoTarget = constrain(g->targetIn, 0.0f, cfg.maxIn);
      gotoStartMs = millis();
      gotoReversals = 0;
      lastGotoDir = 0;
      break;
    }
    case wire::ZERO: {
      if (len < (int)sizeof(wire::Zero)) return;
      relayDownlink(data, len, relayedZeroSeq);
      const wire::Zero *z = reinterpret_cast<const wire::Zero *>(data);
      if ((z->tower && z->tower != cfg.tower) || h->seq == lastSeqZero) return;
      lastSeqZero = h->seq;
      halt();
      zeroHere();
      break;
    }
    case wire::CONFIG: {
      if (len < (int)sizeof(wire::Config)) return;
      relayDownlink(data, len, relayedConfigSeq);
      const wire::Config *c = reinterpret_cast<const wire::Config *>(data);
      if ((c->tower && c->tower != cfg.tower) || h->seq == lastSeqConfig) return;
      lastSeqConfig = h->seq;
      if (c->maxIn > 0 && fabsf(c->maxIn - cfg.maxIn) > 0.01f) {
        cfg.maxIn = c->maxIn;
        saveSettings();
      }
      break;
    }
    case wire::BEACON: {
      if (len < (int)sizeof(wire::Beacon)) return;
      const wire::Beacon *b = reinterpret_cast<const wire::Beacon *>(data);
      portENTER_CRITICAL(&relayLock);
      relayer.onBeacon(b->missing, b->direct, millis());
      portEXIT_CRITICAL(&relayLock);
      uint8_t ch = b->channel;
      if (ch && ch != cfg.channel) {
        cfg.channel = ch;
        saveSettings();
      }
      break;
    }
  }
}

void sendTelemetry(uint8_t state) {
  wire::Telemetry t = {};
  t.h = wire::header(cfg.net, wire::TELEMETRY, ++telSeq);
  t.tower = cfg.tower;
  t.state = state;
  t.dir = motorDir;
  t.rangeStatus = rangeStatus;
  t.heightIn = heightIn;
  t.rawMm = rawMm;
  t.maxIn = cfg.maxIn;
  t.flags = MONITOR ? wire::FLAG_MONITOR : 0;
  radio::send(t);
}

/** Lost the hub (it may have joined Wi-Fi on another channel): walk the channels until it shows up. */
void followHub() {
  uint32_t now = millis();
  // Neighbours count: a tower that only reaches the hub through a relay is still on the right channel.
  if (now - lastNetMs < HUB_LOST_MS || now - lastHopMs < HOP_MS) return;
  lastHopMs = now;
  uint8_t next = radio::channel() % 13 + 1;
  radio::setChannel(next);
}

// ---------------------------------------------------------------------------------------------
// USB serial setup console

void printInfo() {
  Serial.printf("selfriser tower fw %s\n", FW_VERSION);
  Serial.printf("  tower %u  net %u  channel %u  mac %s\n", cfg.tower, cfg.net, radio::channel(), WiFi.macAddress().c_str());
#if defined(SENSOR_SEN0366)
  const char *laserName = "SEN0366";
#elif defined(SENSOR_LIDARLITE)
  const char *laserName = "LIDAR-Lite v3";
#else
  const char *laserName = "VL53L1X";
#endif
  Serial.printf("  laser %s %s  raw %lu mm  status %u  height %.3f in  zero %ld mm  %s  roi %u\n", laserName,
                sensorFresh() ? "reading" : "NOT READING", (unsigned long)rawMm, rangeStatus, heightIn, (long)cfg.zeroMm,
                cfg.reversed ? "reversed" : "normal", cfg.roi);
  if (MONITOR) {
    Serial.println("  MONITOR ONLY: no motor outputs, measures and reports");
    return;
  }
  Serial.printf("  motors %u  invert %s  duty %u%%  min duty %u%%  max %.2f in  top switch %s\n", cfg.motors,
                cfg.invertMotor ? "yes" : "no", cfg.dutyPct, cfg.minDutyPct, cfg.maxIn, topLimitHit() ? "HIT" : "open");
}

void console() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') {
      line += c;
      continue;
    }
    line.trim();
    if (!line.length()) continue;
    int sp = line.indexOf(' ');
    String cmd = sp < 0 ? line : line.substring(0, sp);
    String arg = sp < 0 ? "" : line.substring(sp + 1);
    line = "";
    cmd.toLowerCase();

    if (cmd == "tower") cfg.tower = constrain(arg.toInt(), 0, wire::MAX_TOWERS);
    else if (cmd == "net") cfg.net = constrain(arg.toInt(), 1, 255);
    else if (cmd == "zero") zeroHere();
    else if (cmd == "invert") cfg.invertMotor = !cfg.invertMotor;
    else if (cmd == "reverse") cfg.reversed = !cfg.reversed;
    else if (cmd == "roi") {
      cfg.roi = constrain(arg.toInt(), 4, 16);
#if !defined(SENSOR_SEN0366) && !defined(SENSOR_LIDARLITE)
      if (sensorOk) sensor.setROISize(cfg.roi, cfg.roi);
#endif
    }
#if defined(SENSOR_SEN0366)
    else if (cmd == "raw") {
      rawDump = !rawDump;
      Serial.printf("\nraw laser bytes %s\n", rawDump ? "on (type raw again to stop)" : "off");
      continue;
    }
#endif
#ifdef LASER_LOOPBACK
    else if (cmd == "sim") {
      simMm = arg == "sweep" ? -1 : max(0L, (long)arg.toInt());
      Serial.printf("stand-in laser: %s\n", simMm < 0 ? "sweeping 1-10 m" : (String(simMm) + " mm").c_str());
      continue;
    }
#endif
    else if (cmd == "motors") cfg.motors = constrain(arg.toInt(), 1, 2);
    else if (cmd == "duty") cfg.dutyPct = constrain(arg.toInt(), 10, 100);
    else if (cmd == "minduty") cfg.minDutyPct = constrain(arg.toInt(), 10, 100);
    else if (cmd == "max") cfg.maxIn = max(0.5f, arg.toFloat());
    else if ((cmd == "up" || cmd == "down") && MONITOR) {
      Serial.println("monitor-only build: there is no motor to jog");
      continue;
    } else if (cmd == "up" || cmd == "down") {
      // Bench jog: half a second, same limits as the hub path.
      stalled = false;
      mode = Mode::Run;
      runDir = cmd == "up" ? 1 : -1;
      runUntilMs = millis() + 500;
      continue;
    } else if (cmd == "stop") {
      halt();
      stalled = false;
      continue;
    } else if (cmd == "info") {
      printInfo();
      continue;
    } else {
      Serial.println("commands: info | tower <1-16> | zero | up | down | stop | invert | reverse | roi <4-16> | raw | motors <1|2> | duty <%> | minduty <%> | max <in> | net <id>");
      continue;
    }
    saveSettings();
    printInfo();
  }
}

// ---------------------------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  ledBegin();
  pinMode(PIN_TOP_LIMIT, INPUT_PULLUP);
  loadSettings();
  if (!MONITOR) {
    for (int p : {PIN_MOTOR_A1, PIN_MOTOR_A2, PIN_MOTOR_B1, PIN_MOTOR_B2}) pinMode(p, OUTPUT);
    halt();
  }

  beginSensor();

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  if (!radio::begin(onPacket, cfg.channel)) Serial.println("ESP-NOW init failed");
  delay(200);
  printInfo();
}

void loop() {
  console();
  readSensor();
  uint8_t state = control();
  followHub();

  // Repeats whose random wait is over.
  uint8_t repeat[relay::MAX_BYTES];
  portENTER_CRITICAL(&relayLock);
  int n = relayer.due(millis(), repeat);
  portEXIT_CRITICAL(&relayLock);
  if (n) radio::sendRaw(repeat, n);

  uint32_t now = millis();
  bool changed = state != lastState;
  lastState = state;
  if (cfg.tower && (changed || now - lastTelemetryMs >= (motorDir ? 50u : 200u))) {
    lastTelemetryMs = now;
    sendTelemetry(state);
  }

  // LED: solid while moving, slow blink linked, fast blink hunting for the hub or unassigned.
  bool linked = now - lastNetMs < HUB_LOST_MS;
  bool on = motorDir ? true : (cfg.tower && linked) ? (now / 1000) % 2 : (now / 150) % 2;
  led(on);
}
