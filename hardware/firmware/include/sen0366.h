// DFRobot SEN0366 red-dot laser (50 m outdoors, +-1 mm), UART 9600 8N1. Continuous mode answers
// with 11-byte frames: 80 06 83 'D' 'D' 'D' '.' 'D' 'D' 'D' CS  (metres, 1 mm resolution), or
// 'E' 'R' 'R' in the digits when it has no return. CS makes the sum of all 11 bytes 0.
// Plain C++ so the parser can be tested on a computer.
#pragma once
#include <stdint.h>

namespace sen0366 {

static const uint8_t CONTINUOUS[4] = {0x80, 0x06, 0x03, 0x77};

struct Reading {
  bool ok;      // a distance (false = the laser reported ERR: out of range, no return)
  uint32_t mm;  // distance when ok
};

/** One continuous-mode frame for a distance, as the laser sends it (for the loopback stand-in and tests). */
inline void makeFrame(uint32_t mm, uint8_t out[11]) {
  if (mm > 999999) mm = 999999;
  out[0] = 0x80;
  out[1] = 0x06;
  out[2] = 0x83;
  uint32_t m = mm / 1000, frac = mm % 1000;
  out[3] = '0' + m / 100 % 10;
  out[4] = '0' + m / 10 % 10;
  out[5] = '0' + m % 10;
  out[6] = '.';
  out[7] = '0' + frac / 100;
  out[8] = '0' + frac / 10 % 10;
  out[9] = '0' + frac % 10;
  uint8_t sum = 0;
  for (int i = 0; i < 10; i++) sum += out[i];
  out[10] = (uint8_t)(~sum + 1);
}

/** Feed bytes one at a time; returns true when a whole checksummed frame has landed in `out`. */
class Parser {
 public:
  bool feed(uint8_t b, Reading &out) {
    static const uint8_t HEAD[3] = {0x80, 0x06, 0x83};
    if (n < 3) {
      if (b == HEAD[n]) buf[n++] = b;
      else n = b == HEAD[0] ? (buf[0] = b, 1) : 0;
      return false;
    }
    buf[n++] = b;
    if (n < 11) return false;
    n = 0;
    uint8_t sum = 0;
    for (int i = 0; i < 11; i++) sum += buf[i];
    if (sum != 0) return false;
    if (buf[3] == 'E' && buf[4] == 'R' && buf[5] == 'R') {
      out = {false, 0};
      return true;
    }
    static const int DIGITS[6] = {3, 4, 5, 7, 8, 9};
    uint32_t mm = 0;
    for (int i : DIGITS) {
      if (buf[i] < '0' || buf[i] > '9') return false;
      mm = mm * 10 + (buf[i] - '0');
    }
    if (buf[6] != '.') return false;
    out = {true, mm};
    return true;
  }

 private:
  uint8_t buf[11] = {0};
  int n = 0;
};

}  // namespace sen0366
