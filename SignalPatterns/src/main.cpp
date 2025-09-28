#include <ArduinoJson.h>
#include <LittleFS.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <DNSServer.h>
#include <WiFi.h>

#include "main.h"

// --------------------------------------
// Globale Variablen-Definitionen
// --------------------------------------
DNSServer dnsServer;
AsyncWebServer server(80);

std::array<std::vector<TrackSegment>, 4> tracks;
std::array<std::vector<TrackSegment>, 4> synthHorn = {
  std::vector<TrackSegment>{ TrackSegment{335.0f, WaveForm::WF_SQUARE, 10000, Transition::TR_NONE} },
  std::vector<TrackSegment>{ TrackSegment{335.0f, WaveForm::WF_SQUARE, 10000, Transition::TR_NONE} },
  std::vector<TrackSegment>{ TrackSegment{335.0f, WaveForm::WF_SQUARE, 10000, Transition::TR_NONE} },
  std::vector<TrackSegment>{ TrackSegment{335.0f, WaveForm::WF_SQUARE, 10000, Transition::TR_NONE} }
};

volatile bool dacIsPlaying     = false;
volatile bool stopDacRequested = false;

hw_timer_t* timer = nullptr;

int       masterTrackIndex      = -1;
uint32_t  masterTotalSamples    = 0;
uint32_t  masterSamplesLeft     = 0;

int       currentSegmentIndices[4] = {0,0,0,0};
uint32_t  segSamplesLeft[4]        = {0,0,0,0};
uint32_t  segElapsedSamples[4]     = {0,0,0,0};
float     phaseAccumulators[4]     = {0,0,0,0};
float     phaseStep[4]             = {0,0,0,0};
float     gainExp[4]               = {0,0,0,0};

uint32_t  linearFadeSamples        = 1;
float     invLinearFadeSamples     = 1.0f;
float     expAlpha                 = 0.0f;

// --------------------------------------
// Hilfsfunktionen (nicht im ISR ändern)
// --------------------------------------
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

void determineMasterTrack() {
  uint32_t maxDurationSamples = 0;
  int best = -1;

  for (int i = 0; i < 4; ++i) {
    uint32_t totalMs = 0;
    for (const auto& seg : tracks[i]) totalMs += seg.duration;
    uint32_t totalSamples = msToSamples(totalMs);
    if (totalSamples > maxDurationSamples) {
      maxDurationSamples = totalSamples;
      best = i;
    }
  }

  masterTrackIndex   = best;
  masterTotalSamples = maxDurationSamples;
  masterSamplesLeft  = masterTotalSamples;

  if (masterTotalSamples == 0) masterTrackIndex = -1; // nichts zu spielen
}

void initAudioEngine() {
  // DAC
  dac_output_enable(DAC_CHANNEL_1); // GPIO 25
  dac_output_enable(DAC_CHANNEL_2); // GPIO 26

  // Hüllkurvenkonstanten
  linearFadeSamples     = msToSamples(LINEAR_FADE_MS);
  invLinearFadeSamples  = 1.0f / (float)linearFadeSamples;

  const float tauSamples = (float)msToSamples(EXP_TAU_MS);
  expAlpha = 1.0f - expf(-1.0f / tauSamples); // pro Sample

  // Timer (1 MHz Takt = APB/80, dann Alarm = 1e6 / SR)
  timer = timerBegin(0, 80, true);
  timerAttachInterrupt(timer, []() IRAM_ATTR {
    // ---------------- ISR: Audio pro Sample ----------------
    if (stopDacRequested) {
      dacIsPlaying = false;
      stopDacRequested = false;
      return;
}
    if (!dacIsPlaying || masterTrackIndex == -1) return;

    // Master-Loop runterzählen
    if (masterSamplesLeft > 0) {
      masterSamplesLeft--;
    }
    if (masterSamplesLeft == 0) {
      // Alle Tracks synchron neu starten
      masterSamplesLeft = masterTotalSamples;
      for (int i = 0; i < 4; ++i) {
        currentSegmentIndices[i] = 0;
        segElapsedSamples[i]     = 0;
        if (!tracks[i].empty()) {
          segSamplesLeft[i] = msToSamples(tracks[i][0].duration);
          phaseAccumulators[i] = 0.0f;
          updatePhaseStep(i, tracks[i][0].freq);
          gainExp[i] = (tracks[i][0].transition == Transition::TR_EXP) ? 0.001f : 1.0f;
        } else {
          segSamplesLeft[i] = 0;
          phaseAccumulators[i] = 0.0f;
          gainExp[i] = 1.0f;
        }
      }
    }

    float mix = 0.0f; // bipolar

    // Pro Track: Sample erzeugen
    for (int t = 0; t < 4; ++t) {
      if (tracks[t].empty() || segSamplesLeft[t] == 0) continue;

      // aktuelles Segment
      const int segIdx = currentSegmentIndices[t];
      const TrackSegment& seg = tracks[t][segIdx];

      // Wellenform-Sample
      float s = generateWave(seg.waveForm, phaseAccumulators[t]);

      // Hüllkurve (Gain 0..1)
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

      // Phase voran
      phaseAccumulators[t] += phaseStep[t];
      // Mehrfach-Wrap verhindern (bei sehr hoher freq)
      if (phaseAccumulators[t] >= 2.0f * (float)M_PI) {
        phaseAccumulators[t] = fmodf(phaseAccumulators[t], 2.0f * (float)M_PI);
      }

      // Segment-Zähler
      segElapsedSamples[t]++;
      segSamplesLeft[t]--;

      // Segmentwechsel
      if (segSamplesLeft[t] == 0) {
        const int nextIdx = (segIdx + 1) % tracks[t].size();
        currentSegmentIndices[t] = nextIdx;
        segElapsedSamples[t]     = 0;
        phaseAccumulators[t]     = 0.0f;

        if (!tracks[t].empty()) {
          const TrackSegment& nextSeg = tracks[t][nextIdx];
          segSamplesLeft[t] = msToSamples(nextSeg.duration);
          updatePhaseStep(t, nextSeg.freq);
          gainExp[t] = (nextSeg.transition == Transition::TR_EXP) ? 0.001f : 1.0f;
        }
      }
    }

    // Mischen: auf -1..1 normalisieren (4 Tracks)
    mix *= 0.25f;

    // In 0..255 verschieben + clampen
    int val = (int)(mix * 127.0f + 128.0f);
    if (val < 0) val = 0; else if (val > 255) val = 255;

    dac_output_voltage(DAC_CHANNEL_1, (uint8_t)val); // GPIO 25
    dac_output_voltage(DAC_CHANNEL_2, (uint8_t)val); // GPIO 26
    // ---------------- Ende ISR ----------------
  }, true);

  timerAlarmWrite(timer, 1000000UL / SAMPLE_RATE, true);
  timerAlarmEnable(timer);
}

void playDACLoop() {
  if (dacIsPlaying) return;
  stopDacRequested = false;
  timerAlarmEnable(timer);

  // Master-Track bestimmen und Gesamtdauer in Samples
  determineMasterTrack();
  if (masterTrackIndex == -1) {
    // nichts zu spielen
    return;
  }

  // Alle Tracks initialisieren
  for (int i = 0; i < 4; ++i) {
    currentSegmentIndices[i] = 0;
    segElapsedSamples[i]     = 0;
    if (!tracks[i].empty()) {
      const auto& seg0 = tracks[i][0];
      segSamplesLeft[i]    = msToSamples(seg0.duration);
      phaseAccumulators[i] = 0.0f;
      updatePhaseStep(i, seg0.freq);
      gainExp[i] = (seg0.transition == Transition::TR_EXP) ? 0.001f : 1.0f;
    } else {
      segSamplesLeft[i]    = 0;
      phaseAccumulators[i] = 0.0f;
      gainExp[i]           = 1.0f;
    }
  }

  // Master-Zähler setzen
  masterSamplesLeft = masterTotalSamples;

  dacIsPlaying = true;
}


void stopDACLoop() {
  stopDacRequested = true;
  delay(10); // allow interrupt to process stop request
  timerAlarmDisable(timer);
  dacIsPlaying = false;

  resetDacOutput();
}

void resetDacOutput() {
  dac_output_voltage(DAC_CHANNEL_1, 128);
  dac_output_voltage(DAC_CHANNEL_2, 128);
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


void setup() {
  Serial.begin(115200);
  pinMode(GPIO_HORN, OUTPUT);
  stopRealHonk();

  pinMode(GPIO_SIGNAL_ENABLE, INPUT_PULLDOWN);
  pinMode(GPIO_SIGNAL_SELECT, INPUT_PULLDOWN);

  pinMode(GPIO_HORN_ENABLE, INPUT_PULLUP);
  pinMode(GPIO_HONK_EMERGENCY, INPUT_PULLUP);

  initAudioEngine();

  if (!LittleFS.begin(true)) Serial.println("LittleFS mount failed, trying to format...");
  Serial.println("LittleFS mounted.");

  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

  loadHonkEmergencyPattern();
  loadEmergencyPattern();
  loadMorseMessage();
  setupServer();
}

void updateDacSettings(String jsonTracks) {
  boolean dacWasPlaying = dacIsPlaying;
  if (dacIsPlaying) stopDACLoop();
  tracks = parseTracksFromJson(jsonTracks);
  if (dacWasPlaying) playDACLoop();
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
  StaticJsonDocument<2048> doc;

  DeserializationError error = deserializeJson(doc, jsonTracks);
  if (error) {
    Serial.print(F("deserializeJson() failed: "));
    Serial.println(error.f_str());
    return tracksOut; // leer zurückgeben
  }

  JsonArray tracks = doc["tracks"].as<JsonArray>();
  uint8_t trackIdx = 0;
  for (JsonArray trackArray : doc["tracks"].as<JsonArray>()) {
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

void loadConfig() {
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
  
  
  
void loop() {
  //dnsServer.processNextRequest();
}

boolean signalIsEnabled() {
  return digitalRead(GPIO_SIGNAL_ENABLE) == HIGH;
}

boolean emergencyIsSelected() {
  return digitalRead(GPIO_SIGNAL_SELECT) == LOW;
}

boolean synthesizeHorn() {
  return digitalRead(GPIO_HORN_ENABLE) == HIGH;
}

boolean useHornForEmergencySignal() {
  return digitalRead(GPIO_HONK_EMERGENCY) == LOW;
}

void honk() {
  if (synthesizeHorn()) {
    playDACLoop();
  }
  realHonk();
}

void realHonk() {
  digitalWrite(GPIO_HORN, LOW);
}

void stopHonk() {
  if (synthesizeHorn()) {
    stopDACLoop();
  }
  stopRealHonk();
}

void stopRealHonk() {
  digitalWrite(GPIO_HORN, HIGH);
}
