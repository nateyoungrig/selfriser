// Host test for the relay rules and the hub's dedupe: see run.sh.
#include "relay.h"
#include <cstdio>
int fails = 0;
#define CHECK(c) do { if (!(c)) { printf("FAIL line %d: %s\n", __LINE__, #c); fails++; } } while (0)
using namespace relay;
int main() {
  // Hub hears 1,2,4 directly; tower 3 is hidden.
  DirectMap hub;
  hub.heard(1, 0, 1000); hub.heard(2, 0, 1000); hub.heard(4, 0, 1000); hub.heard(3, 4, 1000);  // 3 only via 4
  uint16_t direct = hub.direct(1100), missing = hub.missing(1100);
  CHECK(direct == (towerBit(1) | towerBit(2) | towerBit(4)));
  CHECK(missing & towerBit(3));
  CHECK(!(missing & towerBit(1)));
  CHECK(hub.direct(1000 + DIRECT_MS + 1) == 0);  // stale

  // Tower 4 hears the beacon, then tower 3's report: relay. Tower 4 won't relay tower 1 (hub hears it).
  Relayer r4;
  CHECK(!r4.shouldRelay(4, 3, 1100));  // no beacon yet
  r4.onBeacon(missing, direct, 1100);
  CHECK(r4.shouldRelay(4, 3, 1200));
  CHECK(!r4.shouldRelay(4, 1, 1200));
  CHECK(!r4.shouldRelay(4, 4, 1200));
  CHECK(!r4.shouldRelay(4, 3, 1100 + BEACON_FRESH_MS + 1));  // lost the hub itself
  // A tower the hub can't hear directly doesn't volunteer.
  Relayer r5; r5.onBeacon(missing, direct, 1100);
  CHECK(!r5.shouldRelay(5, 3, 1200));

  // Schedule, wait, send.
  uint8_t pkt[20] = {1, 2, 3}, out[64];
  r4.schedule(3, 7, pkt, sizeof(pkt), 1200, 0);
  CHECK(r4.pending() == 1);
  CHECK(r4.due(1200, out) == 0);  // not yet (min wait)
  CHECK(r4.due(1200 + MAX_WAIT_MS, out) == (int)sizeof(pkt));
  CHECK(out[0] == 1 && out[2] == 3);
  CHECK(r4.pending() == 0);

  // Suppression: someone else relayed seq 8 first.
  r4.schedule(3, 8, pkt, sizeof(pkt), 2000, 12345);
  r4.heardRelay(3, 8);
  CHECK(r4.due(2000 + MAX_WAIT_MS, out) == 0);
  // A different seq isn't cancelled.
  r4.schedule(3, 9, pkt, sizeof(pkt), 3000, 1);
  r4.heardRelay(3, 8);
  CHECK(r4.due(3000 + MAX_WAIT_MS, out) > 0);
  // A newer report from the same tower replaces the queued one.
  r4.schedule(3, 10, pkt, sizeof(pkt), 4000, 0);
  r4.schedule(3, 11, pkt, sizeof(pkt), 4001, 0);
  CHECK(r4.pending() == 1);
  // Oversize is refused.
  uint8_t big[100] = {0};
  r4.schedule(5, 1, big, sizeof(big), 5000, 0);
  CHECK(r4.pending() == 1);

  // Hub dedupe: direct and relayed copies of one report pass once.
  Dedupe d;
  CHECK(d.accept(3, 10, 1000));
  CHECK(!d.accept(3, 10, 1005));  // the relayed copy
  CHECK(d.accept(3, 11, 1200));
  CHECK(!d.accept(3, 9, 1210));   // older
  CHECK(d.accept(3, 12, 1400));
  CHECK(!d.accept(3, 0, 1600));    // 0 right after 12 is an old counter value
  CHECK(d.accept(4, 250, 1000));
  CHECK(d.accept(4, 3, 1200));      // counter wrapped 255 -> 0 -> 3: newer
  CHECK(!d.accept(4, 250, 1300));
  CHECK(d.accept(4, 0, 4000));      // silent > 2 s (rebooted): take whatever comes
  CHECK(!d.accept(0, 1, 1000));
  return fails ? (printf("%d failed\n", fails), 1) : (puts("relay: pass"), 0);
}
