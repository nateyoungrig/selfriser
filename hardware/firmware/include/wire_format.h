// Radio format between the hub and the tower controllers (ESP-NOW broadcast, channel shared with
// the hub). Everything is little-endian packed structs; both ends are ESP32s built from this file.
#pragma once
#include <stdint.h>

namespace wire {

constexpr uint8_t MAGIC = 'S';
constexpr uint8_t VERSION = 3;  // 2: 32-bit mm and flags. 3: relaying (report counter, via, beacon masks)
constexpr int MAX_TOWERS = 16;

enum Type : uint8_t {
  // hub -> towers
  RUN = 1,     // every tower's direction; towers stop if these stop arriving (deadman)
  STOP = 2,    // everybody stop now, clear latched stalls
  GOTO = 3,    // one tower: run to a height and stop (bumps, bump list)
  ZERO = 4,    // one tower (or 0 = all): the reading right now is height 0 (roof on the deck)
  CONFIG = 5,  // one tower (or 0 = all): top soft limit
  BEACON = 6,  // hub is here on this channel
  // towers -> hub
  TELEMETRY = 20,
};

// What a tower is doing, sent back in telemetry. Order matches TOWER_STATES in src/hw/protocol.ts.
enum State : uint8_t { IDLE = 0, RUNNING, GOTO_RUN, AT_LIMIT, STALLED, NO_SENSOR };
inline const char *stateName(uint8_t s) {
  static const char *names[] = {"idle", "run", "goto", "limit", "stall", "nosensor"};
  return s < sizeof(names) / sizeof(names[0]) ? names[s] : "idle";
}

struct __attribute__((packed)) Header {
  uint8_t magic;
  uint8_t version;
  uint8_t net;  // keeps two models in one room from driving each other
  uint8_t type;
  uint8_t seq;  // GOTO / ZERO / CONFIG: repeats share a seq so towers act once. TELEMETRY: the tower's
                // own report counter, so the hub can drop relayed copies
};

struct __attribute__((packed)) Run {
  Header h;
  int8_t dir[MAX_TOWERS];  // index = tower number - 1: 1 up, 0 hold, -1 down
};

struct __attribute__((packed)) Stop {
  Header h;
};

struct __attribute__((packed)) Goto {
  Header h;
  uint8_t tower;
  float targetIn;
};

struct __attribute__((packed)) Zero {
  Header h;
  uint8_t tower;  // 0 = every tower
};

struct __attribute__((packed)) Config {
  Header h;
  uint8_t tower;  // 0 = every tower
  float maxIn;    // top soft limit, inches above zero
};

struct __attribute__((packed)) Beacon {
  Header h;
  uint8_t channel;
  uint16_t direct;   // bit n-1: the hub hears tower n directly (include/relay.h)
  uint16_t missing;  // bit n-1: it doesn't, so a neighbour should repeat tower n's reports
};

struct __attribute__((packed)) Telemetry {
  Header h;
  uint8_t tower;
  uint8_t state;
  int8_t dir;           // what the motor is doing right now
  uint8_t rangeStatus;  // VL53L1X range status of the last reading (0 = good)
  float heightIn;       // filtered, zeroed
  uint32_t rawMm;       // last raw distance
  float maxIn;
  uint8_t flags;        // FLAG_*
  uint8_t via;          // 0 = straight from the tower; n = repeated by tower n (one hop only)
};

constexpr uint8_t FLAG_MONITOR = 1;  // built MONITOR_ONLY: measures, never drives a motor

inline Header header(uint8_t net, Type type, uint8_t seq = 0) { return Header{MAGIC, VERSION, net, type, seq}; }

inline bool valid(const uint8_t *data, int len, uint8_t net) {
  if (len < (int)sizeof(Header)) return false;
  const Header *h = reinterpret_cast<const Header *>(data);
  return h->magic == MAGIC && h->version == VERSION && h->net == net;
}

}  // namespace wire
