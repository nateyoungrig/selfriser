// Host test for the SEN0366 frame parser and frame builder: see run.sh.
#include "sen0366.h"
#include <cstdio>
#include <vector>

static std::vector<uint8_t> frame(const char *digits) {
  std::vector<uint8_t> f = {0x80, 0x06, 0x83};
  for (int i = 0; i < 7; i++) f.push_back(digits[i]);
  uint8_t s = 0;
  for (auto b : f) s += b;
  f.push_back((uint8_t)(~s + 1));
  return f;
}

int main() {
  int fails = 0;
  {
    // Junk, a false start, a reading, an ERR, a bad checksum, another reading.
    sen0366::Parser p;
    sen0366::Reading r;
    std::vector<uint8_t> in = {0x12, 0x80, 0x80};
    for (auto b : frame("012.345")) in.push_back(b);
    for (auto b : frame("ERR----")) in.push_back(b);
    auto bad = frame("001.000");
    bad[10] ^= 1;
    for (auto b : bad) in.push_back(b);
    for (auto b : frame("030.480")) in.push_back(b);
    uint32_t want[] = {12345, 0, 30480};
    bool ok[] = {true, false, true};
    int got = 0;
    for (auto b : in)
      if (p.feed(b, r)) {
        if (got > 2 || r.ok != ok[got] || r.mm != want[got]) fails++;
        got++;
      }
    if (got != 3) fails++;
  }
  {
    // makeFrame round-trips through the parser.
    sen0366::Parser p;
    sen0366::Reading r;
    for (uint32_t mm : {0u, 1u, 999u, 1000u, 5500u, 30480u, 80000u, 123456u}) {
      uint8_t f[11];
      sen0366::makeFrame(mm, f);
      bool got = false;
      for (auto b : f)
        if (p.feed(b, r)) got = true;
      if (!got || !r.ok || r.mm != mm) fails++;
    }
  }
  puts(fails ? "sen0366: FAIL" : "sen0366: pass");
  return fails ? 1 : 0;
}
