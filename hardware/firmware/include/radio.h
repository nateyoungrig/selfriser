// ESP-NOW plumbing shared by the hub and the towers: broadcast only, no pairing.
//
// Long range by default: every packet goes out at Espressif's LR rate (250 kbit/s), which reaches
// several times further than normal 2.4 GHz Wi-Fi and gets through clutter better. We send about
// 20 bytes a few times a second per tower, so the lower rate costs nothing. Only other ESP32s can
// hear LR, and every board in a system must match: build all of them with -DRADIO_STANDARD to
// turn it off. The radio also keeps 802.11b/g/n on, so a Wi-Fi hub can still join the router.
#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

namespace radio {

static const uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

using Handler = void (*)(const uint8_t *data, int len);
static Handler handler = nullptr;

#if ESP_ARDUINO_VERSION_MAJOR >= 3
static void onRecv(const esp_now_recv_info_t *, const uint8_t *data, int len) {
#else
static void onRecv(const uint8_t *, const uint8_t *data, int len) {
#endif
  if (handler) handler(data, len);
}

inline void setChannel(uint8_t ch) {
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);
}

inline uint8_t channel() {
  uint8_t ch = 1;
  wifi_second_chan_t second;
  esp_wifi_get_channel(&ch, &second);
  return ch;
}

/** Call after WiFi.mode(). ch = 0 keeps whatever channel the WiFi connection is on. */
inline bool begin(Handler onPacket, uint8_t ch) {
#ifndef RADIO_STANDARD
  // Receive LR as well as b/g/n (the Wi-Fi hub still needs b/g/n for the router).
  esp_wifi_set_protocol(WIFI_IF_STA, WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N | WIFI_PROTOCOL_LR);
#endif
  if (ch) setChannel(ch);
  if (esp_now_init() != ESP_OK) return false;
#ifndef RADIO_STANDARD
  // Transmit every ESP-NOW frame at the LR rate.
  esp_wifi_config_espnow_rate(WIFI_IF_STA, WIFI_PHY_RATE_LORA_250K);
#endif
  handler = onPacket;
  esp_now_register_recv_cb(onRecv);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = 0;  // follow the current channel
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  return esp_now_add_peer(&peer) == ESP_OK;
}

inline void sendRaw(const uint8_t *bytes, int len) { esp_now_send(BROADCAST, bytes, len); }

template <typename T>
inline void send(const T &msg) {
  esp_now_send(BROADCAST, reinterpret_cast<const uint8_t *>(&msg), sizeof(T));
}

}  // namespace radio
