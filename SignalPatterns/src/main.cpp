#include <Arduino.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>

AsyncWebServer server(80);

void setup() {
  Serial.begin(115200);
  if(!LittleFS.begin()){
    Serial.println("LittleFS Mount Failed");
    return;
  }

  WiFi.softAP("PATTERN_CONFIG", "19951999");
  Serial.println("Access Point started");
  Serial.print("IP Address: ");
  Serial.println(WiFi.softAPIP());

  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

  server.on("/test", HTTP_GET, [](AsyncWebServerRequest *request){
    request->send(200, "text/plain", "Hello from ESP32!");
  });

  server.begin();
}

void loop() {
  // put your main code here, to run repeatedly:
}

// put function definitions here:
int myFunction(int x, int y) {
  return x + y;
}