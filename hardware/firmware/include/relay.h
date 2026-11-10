// One-hop relaying, so a tower the hub can't hear directly still gets through a neighbour that can.
// Plain C++ (no Arduino) so the rules can be tested on a computer.
//
//   Hub: its beacon (twice a second) says which towers it hears directly and which it doesn't.
//   Tower: when it hears a neighbour's report, and the hub says it's missing that neighbour, and the
//     hub hears *this* tower directly, it repeats the report once after a short random wait. If
//     another tower's repeat of the same report is heard during the wait, it cancels: one repeat is
//     enough. Repeats are never repeated again (one hop), so nothing floods.
//   Hub: every report carries the tower's own counter, so direct and repeated copies of the same
//     report collapse into one.
#pragma once
#include <stdint.h>
#include <string.h>

namespace relay {

constexpr uint32_t BEACON_FRESH_MS = 2000;  // a relay must be hearing the hub right now
constexpr uint32_t DIRECT_MS = 1500;        // hub: "hears directly" means a direct report this recently
constexpr uint32_t MIN_WAIT_MS = 2;
constexpr uint32_t MAX_WAIT_MS = 30;
constexpr int SLOTS = 4;
constexpr int MAX_BYTES = 64;

inline uint16_t towerBit(uint8_t tower) { return tower >= 1 && tower <= 16 ? (uint16_t)(1u << (tower - 1)) : 0; }

/** Tower side: which neighbours' reports to repeat, and when. */
class Relayer {
 public:
  void onBeacon(uint16_t missing, uint16_t direct, uint32_t now) {
    missing_ = missing;
    direct_ = direct;
    beaconMs_ = now;
    heardBeacon_ = true;
  }

  /** A direct (via 0) report from tower `from`: should `self` repeat it? */
  bool shouldRelay(uint8_t self, uint8_t from, uint32_t now) const {
    if (!self || !from || from == self || !heardBeacon_) return false;
    if (now - beaconMs_ > BEACON_FRESH_MS) return false;  // I can't hear the hub myself
    return (direct_ & towerBit(self)) && (missing_ & towerBit(from));
  }

  /** Queue a repeat of `len` bytes after a random wait (rnd: any random number). */
  void schedule(uint8_t from, uint8_t seq, const uint8_t *bytes, int len, uint32_t now, uint32_t rnd) {
    if (len > MAX_BYTES) return;
    int slot = -1;
    for (int i = 0; i < SLOTS; i++)
      if (slots_[i].used && slots_[i].from == from) slot = i;  // newer report replaces an older one
    for (int i = 0; slot < 0 && i < SLOTS; i++)
      if (!slots_[i].used) slot = i;
    if (slot < 0) return;  // busy: drop, another report is 200 ms away
    Slot &s = slots_[slot];
    s.used = true;
    s.from = from;
    s.seq = seq;
    s.len = len;
    s.dueMs = now + MIN_WAIT_MS + rnd % (MAX_WAIT_MS - MIN_WAIT_MS + 1);
    memcpy(s.bytes, bytes, len);
  }

  /** Someone else already repeated this report: don't. */
  void heardRelay(uint8_t from, uint8_t seq) {
    for (int i = 0; i < SLOTS; i++)
      if (slots_[i].used && slots_[i].from == from && slots_[i].seq == seq) slots_[i].used = false;
  }

  /** A repeat whose wait is over, copied into out; returns its length or 0. */
  int due(uint32_t now, uint8_t *out) {
    for (int i = 0; i < SLOTS; i++) {
      Slot &s = slots_[i];
      if (s.used && (int32_t)(now - s.dueMs) >= 0) {
        s.used = false;
        memcpy(out, s.bytes, s.len);
        return s.len;
      }
    }
    return 0;
  }

  int pending() const {
    int n = 0;
    for (int i = 0; i < SLOTS; i++) n += slots_[i].used;
    return n;
  }

 private:
  struct Slot {
    bool used = false;
    uint8_t from = 0, seq = 0;
    int len = 0;
    uint32_t dueMs = 0;
    uint8_t bytes[MAX_BYTES];
  };
  Slot slots_[SLOTS];
  uint16_t missing_ = 0, direct_ = 0;
  uint32_t beaconMs_ = 0;
  bool heardBeacon_ = false;
};

/** Hub side: pass each report once, however many copies arrive. */
class Dedupe {
 public:
  /** true = new report from this tower; false = a copy (or an older one) already passed. */
  bool accept(uint8_t tower, uint8_t seq, uint32_t now) {
    if (tower < 1 || tower > 16) return false;
    Seen &s = seen_[tower - 1];
    // Nothing for a while (or ever): take it, the tower may have rebooted and restarted its counter.
    bool fresh = !s.any || now - s.ms > 2000 || (int8_t)(seq - s.seq) > 0;
    if (!fresh) return false;
    s.any = true;
    s.seq = seq;
    s.ms = now;
    return true;
  }

 private:
  struct Seen {
    bool any = false;
    uint8_t seq = 0;
    uint32_t ms = 0;
  };
  Seen seen_[16];
};

/** Hub side: who it hears directly, for the beacon. */
class DirectMap {
 public:
  void heard(uint8_t tower, uint8_t via, uint32_t now) {
    if (via == 0 && tower >= 1 && tower <= 16) ms_[tower - 1] = now, any_[tower - 1] = true;
  }
  uint16_t direct(uint32_t now) const {
    uint16_t m = 0;
    for (int i = 0; i < 16; i++)
      if (any_[i] && now - ms_[i] <= DIRECT_MS) m |= (uint16_t)(1u << i);
    return m;
  }
  /** Everyone not heard directly, including towers never heard: a hidden tower may never have been. */
  uint16_t missing(uint32_t now) const { return (uint16_t)~direct(now); }

 private:
  uint32_t ms_[16] = {0};
  bool any_[16] = {false};
};

}  // namespace relay
