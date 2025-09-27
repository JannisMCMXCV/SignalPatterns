#include <Arduino.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <DNSServer.h>
#include <math.h>
#include <vector>

#include "driver/dac.h"
#include "main.h"

#define GPIO_HORN           13

#define GPIO_SIGNAL_ENABLE  34 // HIGH: Enable
#define GPIO_SIGNAL_SELECT  35 // HIGH: DEFAULT; LOW: EMERGENCY 

#define GPIO_HORN_ENABLE    12 // LOW: Enable; enables usage of real Horn (otherwise uses synthezised sound played via DAC)
#define GPIO_HONK_EMERGENCY 14 // LOW: Enable; If enabled, all siganls are created using horn. (sound may be synthesized and played via DAC, depending on other inputs.)


DNSServer dnsServer;
AsyncWebServer server(80);

// --------------------------------------
// Konfiguration
// --------------------------------------
constexpr uint32_t SAMPLE_RATE      = 44100;   // ggf. 32000 für geringere Last
constexpr uint32_t LINEAR_FADE_MS   = 50;      // Dauer des linearen Fade-Ins
constexpr uint32_t EXP_TAU_MS       = 100;     // Zeitkonstante für exp-Fade-In

// --------------------------------------
// Datentypen
// --------------------------------------
enum WaveForm : uint8_t { WF_SINE=0, WF_SQUARE=1, WF_SAW=2, WF_TRI=3 };
enum Transition : uint8_t { TR_LINEAR=0, TR_EXP=1, TR_NONE=2 };

struct TrackSegment {
  float    freq;        // Hz
  uint8_t  waveForm;    // siehe WaveForm
  uint16_t durationMs;  // ms
  uint8_t  transition;  // siehe Transition
};

std::vector<std::vector<TrackSegment>> tracks;
std::vector<std::vector<TrackSegment>> synthHorn = {
    {{335.0f, 1, 10000, 0}},
    {{335.0f, 1, 10000, 0}},
    {{335.0f, 1, 10000, 0}},
    {{335.0f, 1, 10000, 0}}
};

// --------------------------------------
// Globale Zustände
// --------------------------------------
volatile bool dacIsPlaying     = false;
volatile bool stopDacRequested = false;

hw_timer_t* timer = nullptr;

// Master-Loop
int       masterTrackIndex      = -1;
uint32_t  masterTotalSamples    = 0;     // Summe aller Segmentsamples des Master-Tracks
uint32_t  masterSamplesLeft     = 0;     // Zähler für den Loop (zählt runter)

// Pro Track
int       currentSegmentIndices[4]   = {0,0,0,0};
uint32_t  segSamplesLeft[4]          = {0,0,0,0};  // wie lange bis Segmentende (Samples)
uint32_t  segElapsedSamples[4]       = {0,0,0,0};  // seit Segmentstart (Samples)
float     phaseAccumulators[4]       = {0,0,0,0};  // Phase in Radiant
float     phaseStep[4]               = {0,0,0,0};  // 2*pi*freq/SR
float     gainExp[4]                 = {0,0,0,0};  // Zustand für exp-Fade

// Konstanten für Hüllkurven (einmal berechnet)
uint32_t  linearFadeSamples = 1;
float     invLinearFadeSamples = 1.0f;
float     expAlpha = 0.0f;  // 1 - exp(-1/tauSamples)

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

static inline float generateWave(uint8_t waveForm, float phase) {
  // Liefert -1..+1
  switch (waveForm) {
    case WF_SINE:
      return sinf(phase);
    case WF_SQUARE:
      return sinf(phase) >= 0.0f ? 1.0f : -1.0f;
    case WF_SAW: {
      // 0..2pi -> -1..+1 (ansteigende Säge)
      float x = phase / (float)M_PI;   // 0..2
      return x - 1.0f;                 // -1..+1
    }
    case WF_TRI: {
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
    for (const auto& seg : tracks[i]) totalMs += seg.durationMs;
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
    if (!dacIsPlaying || stopDacRequested || masterTrackIndex == -1) return;

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
          segSamplesLeft[i] = msToSamples(tracks[i][0].durationMs);
          phaseAccumulators[i] = 0.0f;
          updatePhaseStep(i, tracks[i][0].freq);
          gainExp[i] = (tracks[i][0].transition == TR_EXP) ? 0.001f : 1.0f;
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
        case TR_LINEAR:
          if (segElapsedSamples[t] < linearFadeSamples)
            g = (float)segElapsedSamples[t] * invLinearFadeSamples;
          else
            g = 1.0f;
          break;
        case TR_EXP:
          // One-pole Richtung 1.0
          gainExp[t] += (1.0f - gainExp[t]) * expAlpha;
          if (gainExp[t] > 1.0f) gainExp[t] = 1.0f;
          g = gainExp[t];
          break;
        case TR_NONE:
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
          segSamplesLeft[t] = msToSamples(nextSeg.durationMs);
          updatePhaseStep(t, nextSeg.freq);
          gainExp[t] = (nextSeg.transition == TR_EXP) ? 0.001f : 1.0f;
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

void playSpeakerLoop() {
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
      segSamplesLeft[i]    = msToSamples(seg0.durationMs);
      phaseAccumulators[i] = 0.0f;
      updatePhaseStep(i, seg0.freq);
      gainExp[i] = (seg0.transition == TR_EXP) ? 0.001f : 1.0f;
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


void stopSpeakerLoop() {
  stopDacRequested = true;
  delay(10); // allow interrupt to process stop request
  timerAlarmDisable(timer);
  dacIsPlaying = false;

  resetDacOutput();
}

void resetDacOutput()
{
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
  boolean dacWasPlaying = false;
  if (dacIsPlaying) {
    dacIsPlaying != dacIsPlaying;
    dacWasPlaying != dacWasPlaying;
  }
  tracks = parseTracksFromJson(jsonTracks);
  if (dacWasPlaying) dacWasPlaying != dacWasPlaying;
}

int waveformFromString(const char* wf) {
  if (strcmp(wf, "sine") == 0) return 0;
  if (strcmp(wf, "square") == 0) return 1;
  if (strcmp(wf, "sawtooth") == 0) return 2;
  if (strcmp(wf, "triangle") == 0) return 3;
  return 0; // Default: sine
}

int transitionFromString(const char* tr) {
  if (strcmp(tr, "linear") == 0) return 0;
  if (strcmp(tr, "exp") == 0) return 1;
  // "none" oder unbekannt -> linear als Default
  return 0;
}

std::vector<std::vector<TrackSegment>> parseTracksFromJson(const String& jsonTracks) {
  std::vector<std::vector<TrackSegment>> tracksOut;

  // ⚡ Wichtig: ausreichend großes JsonDocument anlegen
  // Dein Beispiel-JSON ist ~600 Bytes groß, also nehmen wir hier 2048, um sicher zu gehen
  StaticJsonDocument<2048> doc;

  DeserializationError error = deserializeJson(doc, jsonTracks);
  if (error) {
    Serial.print(F("deserializeJson() failed: "));
    Serial.println(error.f_str());
    return tracksOut; // leer zurückgeben
  }

  JsonArray tracks = doc["tracks"].as<JsonArray>();
  for (JsonArray trackArray : tracks) {
    std::vector<TrackSegment> track;
    for (JsonObject seg : trackArray) {
      TrackSegment ts;
      ts.freq       = seg["freq"] | 0.0f;
      ts.waveForm   = waveformFromString(seg["waveform"] | "");
      ts.duration   = seg["duration"] | 0;
      ts.transition = transitionFromString(seg["transition"] | "");
      track.push_back(ts);
    }
    tracksOut.push_back(track);
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
  if (synthesizeHorn) {
    playDACLoop();
  }
  realHonk();
}

void realHonk() {
  digitalWrite(GPIO_HORN, LOW);
}

void stopHonk() {
  if (synthesizeHorn) {
    stopDACLoop();
  }
  stopRealHonk();
}

void stopRealHonk() {
  digitalWrite(GPIO_HORN, HIGH);
}

void playDACLoop(/* Signature missing! */) {
}

void stopDACLoop() {

}
