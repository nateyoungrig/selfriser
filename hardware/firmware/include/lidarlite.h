// Garmin LIDAR-Lite v3 on I2C (address 0x62): 40 m, about +-2.5 cm, readings in whole centimetres.
// It can take a few hundred readings a second, so the tower averages everything inside each 100 ms
// window: that takes most of the jitter out of the 1 cm steps before the usual median filter.
// Writes end with a full STOP before each read, the way Garmin's own Arduino library does it.
#pragma once
#include <Arduino.h>
#include <Wire.h>

namespace lidarlite {

constexpr uint8_t ADDRESS = 0x62;
constexpr uint8_t REG_ACQ_COMMAND = 0x00;
constexpr uint8_t REG_STATUS = 0x01;
constexpr uint8_t REG_DISTANCE = 0x8f;  // 0x0f high byte, 0x10 low; bit 7 = read both in one go
constexpr uint8_t MEASURE_BIAS = 0x04;  // with receiver bias correction (every 100th reading, per Garmin)
constexpr uint8_t MEASURE_FAST = 0x03;  // without

inline bool write(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(ADDRESS);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

inline bool present() {
  Wire.beginTransmission(ADDRESS);
  return Wire.endTransmission() == 0;
}

/** Non-blocking reader: call poll() every loop; it returns true with an averaged distance when a window closes. */
class Reader {
 public:
  bool begin() {
    ok_ = present();
    if (ok_) start();
    return ok_;
  }

  bool poll(uint32_t &avgMm, uint32_t now) {
    if (!ok_) return false;
    if (now - startedMs_ > 50) {  // a reading takes a few ms; this one is stuck
      start();
      return false;
    }
    Wire.beginTransmission(ADDRESS);
    Wire.write(REG_STATUS);
    if (Wire.endTransmission() != 0 || Wire.requestFrom(ADDRESS, (uint8_t)1) != 1) return false;
    if (Wire.read() & 0x01) return false;  // still busy
    Wire.beginTransmission(ADDRESS);
    Wire.write(REG_DISTANCE);
    if (Wire.endTransmission() != 0 || Wire.requestFrom(ADDRESS, (uint8_t)2) != 2) {
      start();
      return false;
    }
    uint16_t cm = (uint16_t)Wire.read() << 8;
    cm |= Wire.read();
    start();
    if (cm > 1 && cm < 4500) {  // 0-1 cm and silly values mean no return
      sumMm_ += (uint32_t)cm * 10;
      count_++;
    }
    if (now - windowMs_ < 100) return false;
    windowMs_ = now;
    if (!count_) return false;
    avgMm = sumMm_ / count_;
    sumMm_ = 0;
    count_ = 0;
    return true;
  }

 private:
  void start() {
    write(REG_ACQ_COMMAND, ++n_ % 100 == 0 ? MEASURE_BIAS : MEASURE_FAST);
    startedMs_ = millis();
  }
  bool ok_ = false;
  uint32_t startedMs_ = 0, windowMs_ = 0, sumMm_ = 0, count_ = 0;
  uint8_t n_ = 0;
};

}  // namespace lidarlite
