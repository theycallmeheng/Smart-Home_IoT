#pragma once
// Sao chép thành secrets.h hoặc chạy npm run setup:hardware.
const char* WIFI_SSID = "your_wifi_name";
const char* WIFI_PASSWORD = "your_wifi_password";
const char* MQTT_HOST = "192.168.1.10"; // IPv4 máy tính chạy Mosquitto, không dùng localhost.
const int MQTT_PORT = 1884;
const char* MQTT_USER = "your_mqtt_username";
const char* MQTT_PASSWORD = "your_mqtt_password";
