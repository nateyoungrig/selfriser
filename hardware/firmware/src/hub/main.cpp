// The hub: plugged into the laptop / phone running the app, it turns the app's JSON lines into
// ESP-NOW broadcasts for the towers and sends their telemetry back the same way.
//
//   USB serial, 115200 baud, one JSON object per line both ways (see src/hw/protocol.ts):
//     app -> hub  {"t":"run","d":[1,0,-1,1]}   {"t":"stop"}   {"t":"goto","n":2,"h":12.5}
//                 {"t":"zero","n":0}            {"t":"cfg","n":0,"max":30}
//     hub -> app  {"t":"tel",...} per tower report, {"t":"hub",...} once a second, {"t":"log","m":...}
//
// Build with HUB_WIFI_SSID / HUB_WIFI_PASS (env hub-wifi) and the same JSON also runs over a
// WebSocket on port 81 at ws://selfriser-hub.local:81, for a phone on the same Wi-Fi.

#include <Arduino.h>
#include <ArduinoJson.h>

#include "board.h"
#include "radio.h"
#include "relay.h"
#include "wire_format.h"

#ifdef HUB_WIFI_SSID
#include <ESPmDNS.h>
#include <WebSocketsServer.h>
WebSocketsServer ws(81);
#endif

#ifndef FW_VERSION
#define FW_VERSION "0.1.0"
#endif
#ifndef HUB_NET
#define HUB_NET 1
#endif
#ifndef HUB_CHANNEL
#define HUB_CHANNEL 1
#endif

constexpr uint32_t STATUS_MS = 1000;
constexpr uint32_t BEACON_MS = 500;

uint8_t seq = 0;
uint32_t lastStatusMs = 0, lastBeaconMs = 0, lastActivityMs = 0;
uint32_t towerSeenMs[wire::MAX_TOWERS + 1] = {0};
relay::Dedupe dedupe;
relay::DirectMap directMap;

// Radio callbacks run on the Wi-Fi task: copy telemetry into a small queue and print from loop().
constexpr int QUEUE = 32;
wire::Telemetry queue[QUEUE];
volatile int qHead = 0, qTail = 0;

void onPacket(const uint8_t *data, int len) {
  if (!wire::valid(data, len, HUB_NET) || len < (int)sizeof(wire::Telemetry)) return;
  if (reinterpret_cast<const wire::Header *>(data)->type != wire::TELEMETRY) return;
  int next = (qHead + 1) % QUEUE;
  if (next == qTail) return;  // full: drop, another report is 50 ms away
  memcpy(&queue[qHead], data, sizeof(wire::Telemetry));
  qHead = next;
}

void emit(const String &line) {
  Serial.println(line);
#ifdef HUB_WIFI_SSID
  String copy = line;
  ws.broadcastTXT(copy);
#endif
}

void hubLog(const String &message) {
  JsonDocument doc;
  doc["t"] = "log";
  doc["m"] = message;
  String out;
  serializeJson(doc, out);
  emit(out);
}

/** GOTO / ZERO / CONFIG are broadcast three times; towers act once per seq. */
template <typename T>
void sendReliably(T &msg) {
  msg.h.seq = ++seq ? seq : ++seq;  // never 0, the towers' initial "last seq"
  for (int i = 0; i < 3; i++) {
    radio::send(msg);
    delay(8);
  }
}

void handleLine(const char *text) {
  JsonDocument doc;
  if (deserializeJson(doc, text)) return;
  const char *t = doc["t"] | "";
  lastActivityMs = millis();

  if (!strcmp(t, "run")) {
    wire::Run m = {};
    m.h = wire::header(HUB_NET, wire::RUN);
    JsonArrayConst d = doc["d"].as<JsonArrayConst>();
    int i = 0;
    for (JsonVariantConst v : d) {
      if (i >= wire::MAX_TOWERS) break;
      int dir = v | 0;
      m.dir[i++] = dir > 0 ? 1 : dir < 0 ? -1 : 0;
    }
    radio::send(m);
  } else if (!strcmp(t, "stop")) {
    wire::Stop m = {};
    m.h = wire::header(HUB_NET, wire::STOP);
    for (int i = 0; i < 3; i++) {
      radio::send(m);
      delay(5);
    }
  } else if (!strcmp(t, "goto")) {
    wire::Goto m = {};
    m.h = wire::header(HUB_NET, wire::GOTO);
    m.tower = doc["n"] | 0;
    m.targetIn = doc["h"] | 0.0f;
    if (m.tower) sendReliably(m);
  } else if (!strcmp(t, "zero")) {
    wire::Zero m = {};
    m.h = wire::header(HUB_NET, wire::ZERO);
    m.tower = doc["n"] | 0;
    sendReliably(m);
  } else if (!strcmp(t, "cfg")) {
    wire::Config m = {};
    m.h = wire::header(HUB_NET, wire::CONFIG);
    m.tower = doc["n"] | 0;
    m.maxIn = doc["max"] | 0.0f;
    sendReliably(m);
  }
}

void readSerial() {
  static char buf[512];
  static size_t n = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      buf[n] = 0;
      if (n) handleLine(buf);
      n = 0;
    } else if (n < sizeof(buf) - 1) {
      buf[n++] = c;
    }
  }
}

#ifdef HUB_WIFI_SSID
void onSocket(uint8_t client, WStype_t type, uint8_t *payload, size_t len) {
  if (type == WStype_DISCONNECTED) {
    // The app went away mid-run: the towers' deadman stops them, but say it out loud too.
    wire::Stop m = {};
    m.h = wire::header(HUB_NET, wire::STOP);
    radio::send(m);
  }
  if (type != WStype_TEXT) return;
  // A message may carry several lines.
  String text((const char *)payload, len);
  int start = 0;
  while (start < (int)text.length()) {
    int end = text.indexOf('\n', start);
    if (end < 0) end = text.length();
    String line = text.substring(start, end);
    line.trim();
    if (line.length()) handleLine(line.c_str());
    start = end + 1;
  }
}
#endif

void flushTelemetry() {
  while (qTail != qHead) {
    wire::Telemetry t = queue[qTail];
    qTail = (qTail + 1) % QUEUE;
    if (t.tower == 0 || t.tower > wire::MAX_TOWERS) continue;
    uint32_t now = millis();
    directMap.heard(t.tower, t.via, now);  // before dedupe: a late direct copy still proves the direct link
    if (!dedupe.accept(t.tower, t.h.seq, now)) continue;
    towerSeenMs[t.tower] = now;
    JsonDocument doc;
    doc["t"] = "tel";
    doc["n"] = t.tower;
    doc["h"] = roundf(t.heightIn * 1000) / 1000;
    doc["mm"] = t.rawMm;
    doc["s"] = wire::stateName(t.state);
    doc["d"] = t.dir;
    doc["q"] = t.rangeStatus;
    doc["max"] = roundf(t.maxIn * 100) / 100;
    if (t.flags & wire::FLAG_MONITOR) doc["mon"] = 1;
    if (t.via) doc["via"] = t.via;
    String out;
    serializeJson(doc, out);
    emit(out);
  }
}

void sendStatus() {
  JsonDocument doc;
  doc["t"] = "hub";
  doc["fw"] = FW_VERSION;
  doc["net"] = HUB_NET;
  doc["ch"] = radio::channel();
#ifdef HUB_WIFI_SSID
  if (WiFi.status() == WL_CONNECTED) doc["ip"] = WiFi.localIP().toString();
#endif
  JsonArray seen = doc["towers"].to<JsonArray>();
  for (int n = 1; n <= wire::MAX_TOWERS; n++)
    if (towerSeenMs[n] && millis() - towerSeenMs[n] < 2000) seen.add(n);
  String out;
  serializeJson(doc, out);
  emit(out);
}

void setup() {
  Serial.begin(115200);
  ledBegin();
  WiFi.mode(WIFI_STA);
  uint8_t ch = HUB_CHANNEL;
#ifdef HUB_WIFI_SSID
  // On Wi-Fi the radio sits on the router's channel; the towers hop until they find the beacon.
  WiFi.begin(HUB_WIFI_SSID, HUB_WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  if (WiFi.status() == WL_CONNECTED) {
    ch = 0;
    MDNS.begin("selfriser-hub");
    ws.begin();
    ws.onEvent(onSocket);
  } else {
    WiFi.disconnect();
  }
#else
  WiFi.disconnect();
#endif
  if (!radio::begin(onPacket, ch)) hubLog("ESP-NOW init failed");
  hubLog(String("hub up, channel ") + radio::channel());
}

void loop() {
  readSerial();
#ifdef HUB_WIFI_SSID
  ws.loop();
#endif
  flushTelemetry();
  uint32_t now = millis();
  if (now - lastBeaconMs >= BEACON_MS) {
    lastBeaconMs = now;
    wire::Beacon b = {};
    b.h = wire::header(HUB_NET, wire::BEACON);
    b.channel = radio::channel();
    b.direct = directMap.direct(now);
    b.missing = directMap.missing(now);
    radio::send(b);
  }
  if (now - lastStatusMs >= STATUS_MS) {
    lastStatusMs = now;
    sendStatus();
  }
  // LED: flickers with app traffic, slow blink idle.
  bool busy = now - lastActivityMs < 150;
  led(busy ? (now / 40) % 2 : (now / 1000) % 2);
}
