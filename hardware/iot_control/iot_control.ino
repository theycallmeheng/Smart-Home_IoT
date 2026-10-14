#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include "DHT.h"
#include "secrets.h"

// Giữ chân cũ và thêm D6 cho đèn test thứ ba.
const uint8_t DHT_PIN = D4;
const uint8_t LED_PINS[] = {D1, D5, D6}; // led1=đèn, led2=quạt, led3=điều hòa.
const bool ACTIVE_HIGH = true; // LED test bật bằng HIGH.
const char* LED_TOPICS[] = {"esp8266/led1", "esp8266/led2", "esp8266/led3"};
DHT dht(DHT_PIN, DHT11);
WiFiClient network;
PubSubClient client(network);
unsigned long lastConnect = 0;
unsigned long lastWifiRetry = 0;
unsigned long lastSensor = 0;
unsigned long lastHeartbeat = 0;
int reportedWifiStatus = -1;

bool isOn(uint8_t index) {
  return digitalRead(LED_PINS[index]) == (ACTIVE_HIGH ? HIGH : LOW);
}

bool setOutput(uint8_t index, bool on) {
  digitalWrite(LED_PINS[index], (on == ACTIVE_HIGH) ? HIGH : LOW);
  delay(5);
  return isOn(index) == on;
}

// Mã lệnh được trả nguyên vẹn để backend ghép đúng phản hồi.
void sendResult(const String& result, const String& action,
                const String& commandId = "", const String& message = "") {
  String payload = "{\"protocol\":2,\"result\":\"" + result +
                   "\",\"action\":\"" + action + "\"";
  for (uint8_t index = 0; index < 3; index++) {
    payload += ",\"led" + String(index + 1) + "\":\"" + (isOn(index) ? "ON" : "OFF") + "\"";
  }
  if (commandId.length()) payload += ",\"commandId\":\"" + commandId + "\"";
  if (message.length()) payload += ",\"message\":\"" + message + "\"";
  payload += "}";
  client.publish("esp8266/status", payload.c_str(), false);
}

bool validId(const String& id) {
  if (!id.length()) return true; // Giữ lệnh ON/OFF thủ công từ Mosquitto.
  if (id.length() != 36) return false;
  for (unsigned int index = 0; index < id.length(); index++) {
    char value = id[index];
    if (!isAlphaNumeric(value) && value != '-') return false;
  }
  return true;
}

void callback(char* topic, byte* payload, unsigned int length) {
  if (length > 100) return;
  String content;
  for (unsigned int index = 0; index < length; index++) content += char(payload[index]);
  content.trim();
  String topicName(topic);
  if (topicName == "esp8266/get_status") {
    if (content == "GET") sendResult("SUCCESS", "GET_STATUS");
    return;
  }
  int separator = content.indexOf('|');
  String command = separator < 0 ? content : content.substring(0, separator);
  String commandId = separator < 0 ? "" : content.substring(separator + 1);
  command.trim(); command.toUpperCase();
  if (!validId(commandId) || (command != "ON" && command != "OFF")) {
    sendResult("FAILURE", "INVALID", "", "Invalid command");
    return;
  }
  for (uint8_t index = 0; index < 3; index++) {
    if (topicName == LED_TOPICS[index]) {
      bool success = setOutput(index, command == "ON");
      sendResult(success ? "SUCCESS" : "FAILURE", "LED" + String(index + 1) + "_" + command,
                 commandId, success ? "" : "GPIO verification failed");
      return;
    }
  }
  if (topicName == "esp8266/leds" || topicName == "esp8266/random") {
    bool success = true;
    int selected = topicName == "esp8266/random" && command == "ON" ? random(0, 3) : -1;
    for (uint8_t index = 0; index < 3; index++) {
      bool on = command == "ON" && (selected < 0 || index == selected);
      if (!setOutput(index, on)) success = false;
    }
    sendResult(success ? "SUCCESS" : "FAILURE", topicName == "esp8266/leds" ? "LEDS_" + command : "RANDOM_" + command, commandId);
  }
}

void sendSensors() {
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();
  String payload = "{\"temp\":" + (isnan(temperature) ? String("null") : String(temperature, 1)) +
                   ",\"hum\":" + (isnan(humidity) ? String("null") : String(humidity, 1)) +
                   ",\"light\":" + String(analogRead(A0)) + "}";
  client.publish("esp8266/sensor_data", payload.c_str(), false);
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] IoT firmware: 3 test lights, protocol 2");
  Serial.print("[MQTT] Broker: ");
  Serial.print(MQTT_HOST);
  Serial.print(":");
  Serial.println(MQTT_PORT);
  for (uint8_t index = 0; index < 3; index++) {
    digitalWrite(LED_PINS[index], ACTIVE_HIGH ? LOW : HIGH);
    pinMode(LED_PINS[index], OUTPUT);
  }
  dht.begin();
  randomSeed(analogRead(A0));
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("[WiFi] Connecting; credentials are configured in secrets.h");
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(callback);
  client.setBufferSize(512);
  client.setKeepAlive(15);
  client.setSocketTimeout(2);
}

// Kết nối lại không khóa vòng lặp bằng while/delay dài.
void loop() {
  unsigned long now = millis();
  int wifiStatus = WiFi.status();
  if (wifiStatus != reportedWifiStatus) {
    reportedWifiStatus = wifiStatus;
    Serial.print("[WiFi] Status: ");
    Serial.println(wifiStatus);
    if (wifiStatus == WL_CONNECTED) {
      Serial.print("[WiFi] Connected. ESP IP: ");
      Serial.println(WiFi.localIP());
      Serial.print("[WiFi] Gateway: ");
      Serial.println(WiFi.gatewayIP());
    } else if (wifiStatus == WL_NO_SSID_AVAIL) {
      Serial.println("[WiFi] Network not found. Check WIFI_SSID in secrets.h.");
    } else if (wifiStatus == WL_CONNECT_FAILED) {
      Serial.println("[WiFi] Connection failed. Check network and WIFI_PASSWORD.");
    }
  }
  if (wifiStatus != WL_CONNECTED) {
    if (now - lastWifiRetry >= 10000) {
      lastWifiRetry = now;
      Serial.println("[WiFi] Retrying. ESP and broker PC must be on a reachable network.");
      WiFi.reconnect();
    }
    delay(1);
    return;
  }
  if (!client.connected()) {
    if (now - lastConnect < 3000) { delay(1); return; }
    lastConnect = now;
    String id = "IoT-ESP8266-" + String(ESP.getChipId(), HEX);
    if (client.connect(id.c_str(), MQTT_USER, MQTT_PASSWORD, "esp8266/availability", 0, true, "offline")) {
      for (uint8_t index = 0; index < 3; index++) client.subscribe(LED_TOPICS[index]);
      client.subscribe("esp8266/leds"); client.subscribe("esp8266/random"); client.subscribe("esp8266/get_status");
      client.publish("esp8266/availability", "online", true);
      sendResult("SUCCESS", "GET_STATUS");
      Serial.println("WiFi/MQTT connected");
      Serial.println(WiFi.localIP());
    } else {
      Serial.print("[MQTT] Connection failed, rc=");
      Serial.println(client.state());
      Serial.println("[MQTT] Check broker IP/port, credentials and PC firewall.");
    }
    return;
  }
  client.loop();
  if (now - lastSensor >= 2000) { lastSensor = now; sendSensors(); }
  if (now - lastHeartbeat >= 10000) { lastHeartbeat = now; sendResult("SUCCESS", "GET_STATUS"); }
  delay(1);
}
