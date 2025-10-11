#include <ArduinoJson.h>
#include <LittleFS.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <DNSServer.h>
#include <WiFi.h>

#include "main.h"
#include "Arduino.h"

// --------------------
// Globale Variablen
// --------------------
DNSServer dnsServer;
AsyncWebServer server(80);

uint8_t GPIO_SIGNAL_ENABLE_LAST_STATE;
uint8_t GPIO_SIGNAL_SELECT_LAST_STATE;
uint8_t GPIO_HORN_ENABLE_LAST_STATE;
uint8_t GPIO_HONK_EMERGENCY_LAST_STATE;

unsigned long GPIO_SIGNAL_ENABLE_LAST_CHANGE_TIME;
unsigned long GPIO_SIGNAL_SELECT_LAST_CHANGE_TIME;

unsigned long GPIO_HORN_ENABLE_LAST_CHANGE_TIME;
unsigned long GPIO_HONK_EMERGENCY_LAST_CHANGE_TIME;

HonkPattern emergencyHonkPattern = { FirstSegment::FIRST_HIGH, std::vector<uint32_t>{25, 400, 25, 200, 20, 100, 25, 50, 25, 25, 25, 13, 25, 12, 25, 500} }; // Sollte sich bisschen bouncy anhören.

std::array<std::vector<TrackSegment>, 4> tracks = {
  std::vector<TrackSegment>{ TrackSegment{440.0f, WaveForm::WF_SQUARE, 750, Transition::TR_NONE}, TrackSegment{587.33f, WaveForm::WF_SQUARE, 750, Transition::TR_NONE} },
  std::vector<TrackSegment>{ TrackSegment{440.0f, WaveForm::WF_SQUARE, 750, Transition::TR_NONE}, TrackSegment{587.33f, WaveForm::WF_SQUARE, 750, Transition::TR_NONE} },
  std::vector<TrackSegment>{ TrackSegment{441.0f, WaveForm::WF_SQUARE, 750, Transition::TR_NONE}, TrackSegment{586.33f, WaveForm::WF_SQUARE, 750, Transition::TR_NONE} },
  std::vector<TrackSegment>{ TrackSegment{441.0f, WaveForm::WF_SQUARE, 750, Transition::TR_NONE}, TrackSegment{586.33f, WaveForm::WF_SQUARE, 750, Transition::TR_NONE} }  
};
std::array<std::vector<TrackSegment>, 4> synthHorn = {
  std::vector<TrackSegment>{ TrackSegment{335.0f, WaveForm::WF_SQUARE, 10000, Transition::TR_NONE} },
  std::vector<TrackSegment>{ TrackSegment{335.0f, WaveForm::WF_SQUARE, 10000, Transition::TR_NONE} },
  std::vector<TrackSegment>{ TrackSegment{335.0f, WaveForm::WF_SQUARE, 10000, Transition::TR_NONE} },
  std::vector<TrackSegment>{ TrackSegment{335.0f, WaveForm::WF_SQUARE, 10000, Transition::TR_NONE} }
};

std::array<std::vector<TrackSegment>, 4>* activeTracks = &synthHorn;

volatile bool dacIsPlaying     = false;
volatile bool stopDacRequested = false;

hw_timer_t* timer = nullptr;

int       currentSegmentIndices[4] = {0,0,0,0};
uint32_t  segSamplesLeft[4]        = {0,0,0,0};
uint32_t  segElapsedSamples[4]     = {0,0,0,0};
float     phaseAccumulators[4]     = {0,0,0,0};
float     phaseStep[4]             = {0,0,0,0};
float     gainExp[4]               = {0,0,0,0};

uint32_t  linearFadeSamples        = 1;
float     invLinearFadeSamples     = 1.0f;
float     expAlpha                 = 0.0f;

TaskHandle_t dacTaskHandle = NULL;
TaskHandle_t hornTaskHandle = NULL;


void setup() {
  Serial.begin(115200);
  pinMode(GPIO_HORN, OUTPUT);
  stopRealHorn();

  pinMode(GPIO_SIGNAL_ENABLE, INPUT_PULLDOWN);
  pinMode(GPIO_SIGNAL_SELECT, INPUT_PULLDOWN);

  pinMode(GPIO_HORN_ENABLE, INPUT_PULLUP);
  pinMode(GPIO_HONK_EMERGENCY, INPUT_PULLUP);

  GPIO_SIGNAL_ENABLE_LAST_STATE = digitalRead(GPIO_SIGNAL_ENABLE);
  GPIO_SIGNAL_SELECT_LAST_STATE = digitalRead(GPIO_SIGNAL_SELECT);

  GPIO_HORN_ENABLE_LAST_STATE = digitalRead(GPIO_HORN_ENABLE);
  GPIO_HONK_EMERGENCY_LAST_STATE = digitalRead(GPIO_HONK_EMERGENCY);

  auto now = millis();
  GPIO_SIGNAL_ENABLE_LAST_CHANGE_TIME = now;
  GPIO_SIGNAL_SELECT_LAST_CHANGE_TIME = now;
  GPIO_HORN_ENABLE_LAST_CHANGE_TIME = now;
  GPIO_HONK_EMERGENCY_LAST_CHANGE_TIME = now;

  dac_output_enable(DAC_CHANNEL_1);
  dac_output_enable(DAC_CHANNEL_2);
  initTracks();
  
  startTask(hornTask, &hornTaskHandle, HORN_TASK);

  Serial.println("DAC Synth gestartet!");
  Serial.println("Setup finished!");
}

void loop() {
  // dnsServer.processNextRequest();
  controlAudioOutput();
}

void controlAudioOutput() {
    bool signalEnabledChanged = debouncedInputHasChanged(GPIO_SIGNAL_ENABLE, GPIO_SIGNAL_ENABLE_LAST_CHANGE_TIME, GPIO_SIGNAL_ENABLE_LAST_STATE);
    bool signalEnabled = signalIsEnabled();  
    
    if (signalEnabledChanged && !signalEnabled) {
      stopRealHorn();
      killTask(dacTaskHandle);
      return;
    }
    
    if (!(signalEnabledChanged || signalEnabled)) {
      return;
    }

    updateAcousticSignal();

}

void updateAcousticSignal() {
  bool selectionHasChanged = debouncedInputHasChanged(GPIO_SIGNAL_SELECT, GPIO_SIGNAL_SELECT_LAST_CHANGE_TIME, GPIO_SIGNAL_SELECT_LAST_STATE);
  bool emergencySignalSelectionHasChanged = debouncedInputHasChanged(GPIO_HONK_EMERGENCY, GPIO_HONK_EMERGENCY_LAST_CHANGE_TIME, GPIO_HONK_EMERGENCY_LAST_STATE);
   
  if (selectionHasChanged && !emergencyIsSelected()) {
    honk();
  } else if (emergencyIsSelected() && (selectionHasChanged || emergencySignalSelectionHasChanged)) {
    emergencySignal();
  }
}

bool debouncedInputHasChanged(uint8_t input, unsigned long &lastChange, uint8_t &lastState) {
  if (millis() < lastChange + DEBOUNCE_MS) return false;

  uint8_t reading = digitalRead(input);
  if (reading == lastState) return false;

  lastState = reading;
  lastChange = millis();
  return true;
}

bool signalIsEnabled() {
  return digitalRead(GPIO_SIGNAL_ENABLE) == HIGH;
}

bool emergencyIsSelected() {
  return digitalRead(GPIO_SIGNAL_SELECT) == LOW;
}

bool synthesizeHorn() {
  return digitalRead(GPIO_HORN_ENABLE) == HIGH;
}

bool useHornForEmergencySignal() {
  return digitalRead(GPIO_HONK_EMERGENCY) == LOW;
}

void honk() {
  if (synthesizeHorn()) {
    activeTracks = &synthHorn;
    if (dacTaskHandle == NULL) startTask(dacTask, &dacTaskHandle, DAC_TASK);
    else (resumeTask(dacTaskHandle));
  } else {
    playRealHorn();
  }
}

void emergencySignal() {
  if (useHornForEmergencySignal()) {
    startTask(hornTask, &hornTaskHandle, HORN_TASK);
  } else {
    activeTracks = &tracks;
    startTask(dacTask, &dacTaskHandle, DAC_TASK);

  }
}

void playRealHorn() {
  digitalWrite(GPIO_HORN, LOW);
}

void stopHonk() {
  if (synthesizeHorn()) {
    pauseTask(dacTaskHandle);
  }
  stopRealHorn();
}

void stopRealHorn() {
  digitalWrite(GPIO_HORN, HIGH);
}

void doConfig() {
  String json = readFile("/config/config.json");
  if(json == "") return;
  
  JsonDocument config;
  DeserializationError error = deserializeJson(config, json.c_str());
  
  if(error){
    Serial.print("JSON Parsing Error: ");
    Serial.println(error.c_str());
    return;
  }
  
  const char* ssid = config["wifi"]["ssid"];
  const char* password = config["wifi"]["pw"];
  
  const char* domain = config["domain"];
  
  if (strlen(password) < 8) {
    WiFi.softAP(ssid);
  } else {
    WiFi.softAP(ssid, password);
  }
  
  Serial.println("Access Point started");
  Serial.print("IP Address: ");
  IPAddress ip = WiFi.softAPIP();
  Serial.println(ip);
  Serial.println("SSID: " + String(ssid));
  Serial.println("Passwort: " + String(password));
  
  
  dnsServer.start(53, domain, ip);
}

static inline uint32_t msToSamples(uint32_t ms) {
  // Mindestens 1 Sample, um 0-Dauern zu vermeiden
  uint32_t s = (uint32_t)((uint64_t)ms * SAMPLE_RATE / 1000ULL);
  return s == 0 ? 1u : s;
}

static inline void updatePhaseStep(int trackIdx, float freq) {
  // Bei extrem hohen Frequenzen bleibt der Code stabil; Phase wird unten sauber gewrappt
  phaseStep[trackIdx] = 2.0f * (float)M_PI * freq / (float)SAMPLE_RATE;
}

static inline float generateWave(WaveForm waveForm, float phase) {
  // Liefert -1..+1
  switch (waveForm) {
    case WaveForm::WF_SINE:
      return sinf(phase);
    case WaveForm::WF_SQUARE:
      return sinf(phase) >= 0.0f ? 1.0f : -1.0f;
    case WaveForm::WF_SAW: {
      // 0..2pi -> -1..+1 (ansteigende Säge)
      float x = phase / (float)M_PI;   // 0..2
      return x - 1.0f;                 // -1..+1
    }
    case WaveForm::WF_TRI: {
      // Dreieck aus Phase (0..2pi)
      float t = phase / (2.0f * (float)M_PI);    // 0..1
      float tri = 2.0f * fabsf(2.0f * (t - floorf(t + 0.5f))) - 1.0f; // -1..1
      return -tri; // invertiert für Phasenanpassung zu Sinus
    }
    default:
      return 0.0f;
  }
}

void normalizeTrackLengths(std::array<std::vector<TrackSegment>, 4>& tracks) {
    // 1. Gesamtdauer pro Track berechnen
    std::array<uint16_t, 4> trackDurations = {0,0,0,0};
    for (int i = 0; i < 4; ++i) {
        for (const auto& seg : tracks[i]) {
            trackDurations[i] += seg.duration;
        }
    }

    // 2. Längsten Track finden
    uint16_t maxDuration = 0;
    for (int i = 0; i < 4; ++i) {
        if (trackDurations[i] > maxDuration) {
            maxDuration = trackDurations[i];
        }
    }

    // 3. Jeden Track auffüllen
    for (int i = 0; i < 4; ++i) {
        uint16_t diff = maxDuration - trackDurations[i];
        if (diff > 0) {
            // Stille-Segment einfügen (Frequenz 0)
            tracks[i].push_back(TrackSegment{0.0f, WaveForm::WF_SQUARE, diff, Transition::TR_NONE});
        }
    }
}

void playDacSample() {
  float mix = 0.0f;

  for (int t = 0; t < 4; ++t) {
    if ((*activeTracks)[t].empty() || segSamplesLeft[t] <= 0) continue;

    int segIdx = currentSegmentIndices[t];
    const TrackSegment& seg = (*activeTracks)[t][segIdx];

    // Waveform
    float s = generateWave(seg.waveForm, phaseAccumulators[t]);

    float g = 1.0f;
    switch (seg.transition) {
      case Transition::TR_LINEAR:
        if (segElapsedSamples[t] < linearFadeSamples)
          g = (float)segElapsedSamples[t] * invLinearFadeSamples;
        else
          g = 1.0f;
        break;
      case Transition::TR_EXP:
        // One-pole Richtung 1.0
        gainExp[t] += (1.0f - gainExp[t]) * expAlpha;
        if (gainExp[t] > 1.0f) gainExp[t] = 1.0f;
      g = gainExp[t];
        break;
      case Transition::TR_NONE:
      default:
        g = 1.0f;
        break;
    }

    mix += s * g;

    // Phase advance
    phaseAccumulators[t] += phaseStep[t];
    // Mehrfach-Wrap verhindern (bei sehr hoher freq)
    if (phaseAccumulators[t] >= 2.0f * (float)M_PI) {
      phaseAccumulators[t] = fmodf(phaseAccumulators[t], 2.0f * (float)M_PI);
    }

    segElapsedSamples[t]++;
    segSamplesLeft[t]--;

    // Segmentwechsel
    if (segSamplesLeft[t] == 0) {
      segIdx = (segIdx + 1) % (*activeTracks)[t].size();
      currentSegmentIndices[t] = segIdx;
      segElapsedSamples[t] = 0;
      phaseAccumulators[t] = 0.0f;

      if (!(*activeTracks)[t].empty()) {
        const TrackSegment& nextSeg = (*activeTracks)[t][segIdx];
        segSamplesLeft[t] = msToSamples(nextSeg.duration);
        updatePhaseStep(t, nextSeg.freq);
        gainExp[t] = (nextSeg.transition == Transition::TR_EXP) ? 0.001f : 1.0f;
      }
    }
  }
  
  // Normalize + Output
    mix /= activeTracks->size();
  int val = (int)(mix * 127.0f + 128.0f);
  if (val < 0) val = 0; else if (val > 255) val = 255;

  dac_output_voltage(DAC_CHANNEL_1, (uint8_t)val);
  dac_output_voltage(DAC_CHANNEL_2, (uint8_t)val);
}


void loadHonkEmergencyPattern() {
}

void saveHonkEmergencyPattern() {
}

void loadEmergencyPattern() {
}

void saveEmergencyPattern() {
}

// --- Morse Load/Save ---
void loadMorseMessage() {
  if (LittleFS.exists("/morseMessage.txt")) {
    File f = LittleFS.open("/morseMessage.txt", "r");
    if (!f) {
      Serial.println("Fehler: konnte morseMessage.txt nicht öffnen!");
      return;
    }
    
    // morseMessage = f.readString();
    f.close();
    // Serial.println("morseMessage.txt geladen: " + morseMessage);
  } else {
    Serial.println("morseMessage.txt existiert nicht.");
  }
}

void saveMorseMessage() {
  File f = LittleFS.open("/morseMessage.txt", "w");
  // f.print(morseMessage);
  f.close();
}

// --- Endpoints ---
void setupServer() {
}

void dacTask(void* parameter) {
  normalizeTrackLengths(tracks);
  int64_t nextTick = esp_timer_get_time();
  while (true) {
    playDacSample();

    // Nächster Zeitpunkt
    nextTick += SAMPLE_INTERVAL_US;

    // warten bis dahin
    int64_t now = esp_timer_get_time();
    if (now < nextTick) {
      // busy-wait oder vTaskDelay je nach Präzision
      ets_delay_us((uint32_t)(nextTick - now));
    } else {
      // falls wir hinterherhinken, sofort weiter
      nextTick = now;
    }
  }
}

void hornTask(void* parameter) {
  while (true) {
    if (emergencyHonkPattern.patternChanges.empty()) {
      vTaskDelay(100 / portTICK_PERIOD_MS); // kleine Pause, falls Pattern leer
        continue;
      }

    TickType_t lastWakeTime = xTaskGetTickCount();
    bool firstHigh = (emergencyHonkPattern.first == FirstSegment::FIRST_HIGH);

    for (size_t i = 0; i < emergencyHonkPattern.patternChanges.size(); i++) {
      // honk() oder stopHonk() je nach Index & Startstatus
      ((i % 2 == 0) == firstHigh ? honk : stopHonk)();

      TickType_t delayTicks = emergencyHonkPattern.patternChanges[i] / portTICK_PERIOD_MS;
      if (delayTicks < 1) delayTicks = 1;
        vTaskDelayUntil(&lastWakeTime, delayTicks);
    }
  }
}

void startTask(TaskFunction_t task, TaskHandle_t *handle, const char* taskName) {
  if (*handle != NULL) return;

  xTaskCreatePinnedToCore(
    task, taskName,
    4096, NULL, 2, handle,
    1
  );
}

void pauseTask(TaskHandle_t &handle) {
  if (handle == NULL)  return;
  vTaskSuspend(handle);
}

void resumeTask(TaskHandle_t &handle) {
  if (handle == NULL) return;
  vTaskResume(handle);
}

void killTask(TaskHandle_t &handle) {
  if (handle == NULL) return;
  vTaskDelete(handle);
  handle = NULL;
}

void initTracks() {
  for (int i = 0; i < 4; i++) {
    TrackSegment &seg = (*activeTracks)[i][0];
    currentSegmentIndices[i] = 0;
    segElapsedSamples[i] = 0;
    segSamplesLeft[i] = msToSamples(seg.duration);
    phaseAccumulators[i] = 0.0f;
    updatePhaseStep(i, seg.freq);
    gainExp[i] = (seg.transition == Transition::TR_EXP) ? 0.001f : 1.0f;
  }
}

bool hotSwapRequired(bool dacIsPlaying) {
  return dacIsPlaying && activeTracks == &tracks;
}

void updateDacSettings(String jsonTracks) {
  bool doHotSwap = hotSwapRequired(dacIsPlaying);
  if (doHotSwap) killTask(dacTaskHandle);
  tracks = parseTracksFromJson(jsonTracks);
  if (doHotSwap) startTask(dacTask, &dacTaskHandle, DAC_TASK);
}

WaveForm waveformFromString(const char* wf) {
  if (strcmp(wf, "sine") == 0) return WaveForm::WF_SINE;
  if (strcmp(wf, "square") == 0) return WaveForm::WF_SQUARE;
  if (strcmp(wf, "sawtooth") == 0) return WaveForm::WF_SAW;
  if (strcmp(wf, "triangle") == 0) return WaveForm::WF_TRI;
  return WaveForm::WF_SINE;
}

Transition transitionFromString(const char* tr) {
  if (strcmp(tr, "linear") == 0) return Transition::TR_LINEAR;
  if (strcmp(tr, "exp") == 0) return Transition::TR_EXP;
  // "none" oder unbekannt -> linear als Default
  return Transition::TR_NONE;
}

std::array<std::vector<TrackSegment>, 4> parseTracksFromJson(const String& jsonTracks) {
  std::array<std::vector<TrackSegment>, 4> tracksOut;
  
  // !Wichtig!: ausreichend großes JsonDocument anlegen
  // Dein Beispiel-JSON ist ~600 Bytes groß, also nehmen wir hier 2048, um sicher zu gehen
  JsonDocument doc;
  
  DeserializationError error = deserializeJson(doc, jsonTracks);
  if (error) {
    Serial.print(F("deserializeJson() failed: "));
    Serial.println(error.f_str());
    return tracksOut; // leer zurückgeben
  }
  
  JsonArray tracks = doc["tracks"].as<JsonArray>();
  uint8_t trackIdx = 0;
  for (JsonArray trackArray : tracks) {
    for (JsonObject seg : trackArray) {
      TrackSegment ts;
      ts.freq       = seg["freq"] | 0.0f;
      ts.waveForm   = waveformFromString(seg["waveform"] | "");
      ts.duration   = seg["duration"] | 0;
      ts.transition = transitionFromString(seg["transition"] | "");
      
      tracksOut[trackIdx].push_back(ts);
    }
    trackIdx++;
  }
  
  return tracksOut;
}


String readFile(const char* path) {
  File file = LittleFS.open(path, "r");
  if(!file){
    Serial.println("Datei konnte nicht geöffnet werden!");
    return "";
  }
  
  String content;
  while(file.available()){
    content += char(file.read());
  }
  file.close();
  return content;
}

