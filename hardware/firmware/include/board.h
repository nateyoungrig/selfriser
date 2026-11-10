// Pin map per board. ESP32-C3 SuperMini is the default; -DBOARD_XIAO_C3 for the Seeed XIAO ESP32C3
// (same chip, comes with an external antenna for job-site range). Both boards put the laser and
// motor driver on the same GPIOs, so the wiring tables in hardware/README.md hold for either.
#pragma once
#include <Arduino.h>

constexpr int PIN_SDA = 6;        // VL53L1X        (XIAO D4)
constexpr int PIN_SCL = 7;        //                (XIAO D5)
constexpr int PIN_MOTOR_A1 = 3;   // DRV8833 AIN1   (XIAO D1): the spool motor
constexpr int PIN_MOTOR_A2 = 4;   // DRV8833 AIN2   (XIAO D2)
constexpr int PIN_MOTOR_B1 = 5;   // DRV8833 BIN1   (XIAO D3): second motor on a two-motor tower
constexpr int PIN_MOTOR_B2 = 10;  // DRV8833 BIN2   (XIAO D10)
constexpr int PIN_LASER_RX = 20;  // SEN0366 TX ->  (XIAO D7 / RX)
constexpr int PIN_LASER_TX = 21;  // SEN0366 RX <-  (XIAO D6 / TX)

#ifdef BOARD_XIAO_C3
constexpr int PIN_TOP_LIMIT = 2;  // optional overtravel switch to GND (XIAO D0); GPIO1 isn't broken out
constexpr int PIN_LED = -1;       // no user LED on the XIAO
#else
constexpr int PIN_TOP_LIMIT = 1;  // optional overtravel switch to GND, normally open
constexpr int PIN_LED = 8;        // on-board LED, active low
#endif

inline void ledBegin() {
  if (PIN_LED >= 0) pinMode(PIN_LED, OUTPUT);
}
inline void led(bool on) {
  if (PIN_LED >= 0) digitalWrite(PIN_LED, on ? LOW : HIGH);
}
